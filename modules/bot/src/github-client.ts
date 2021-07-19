import debug from 'debug';
import { Context, Probot } from 'probot';
import { URL } from 'url';
import { inspect } from 'util';

import {
  BisectJob,
  Job,
  JobId,
  JobType,
  TestJob,
} from '@electron/bugbot-shared/build/interfaces';
import { env, envInt } from '@electron/bugbot-shared/build/env-vars';

import BrokerAPI from './broker-client';
import { Labels } from './github-labels';
import { BisectCommand, parseIssueCommand, TestCommand } from './issue-parser';
import { ElectronVersions } from './electron-versions';
import { generateTable, Matrix } from './table-generator';

const AppName = 'BugBot' as const;
const DebugPrefix = 'bot:GitHubClient' as const;

export class GithubClient {
  private isClosed = false;
  private readonly broker: BrokerAPI;
  private readonly brokerBaseUrl: string;
  private readonly pollIntervalMs: number;
  private readonly robot: Probot;
  private readonly versions = new ElectronVersions();

  // issue id -> bot comment id
  private readonly botCommentIds = new Map<number, number>();

  constructor(opts: {
    authToken: string;
    brokerBaseUrl: string;
    pollIntervalMs: number;
    robot: Probot;
  }) {
    const d = debug(`${DebugPrefix}:constructor`);

    Object.assign(this, opts);
    d('brokerBaseUrl', this.brokerBaseUrl);
    this.broker = new BrokerAPI({
      authToken: opts.authToken,
      baseURL: opts.brokerBaseUrl,
    });

    this.listenToRobot();
  }

  public close() {
    this.isClosed = true;
  }

  private listenToRobot() {
    const d = debug(`${DebugPrefix}:listenToRobot`);

    const debugContext = (context) => d(context.name, inspect(context.payload));
    this.robot.on('issue_comment', debugContext);
    this.robot.on('issues.opened', debugContext);
    this.robot.on('issues.labeled', debugContext);
    this.robot.on('issues.unlabeled', debugContext);
    this.robot.on('issues.edited', debugContext);

    this.robot.on('issue_comment.created', (ctx) => this.onIssueComment(ctx));
    this.robot.on('issue_comment.edited', (ctx) => this.onIssueComment(ctx));
  }

  // from https://github.com/electron/trop/blob/master/src/utils.ts
  private async isAuthorizedUser(
    context: Context<'issue_comment'>,
    username: string,
  ) {
    const { data } = await context.octokit.repos.getCollaboratorPermissionLevel(
      context.repo({
        username,
      }),
    );

    return ['admin', 'write'].includes(data.permission);
  }

  public async onIssueComment(
    context: Context<'issue_comment'>,
  ): Promise<void> {
    const d = debug(`${DebugPrefix}:onIssueComment`);

    const { login } = context.payload.comment.user;
    if (!(await this.isAuthorizedUser(context, login))) {
      d(`"${login}" is not a maintainer — doing nothing`);
      return;
    }

    d('calling handleManualCommand');
    return this.handleManualCommand(context);
  }

  /**
   * Takes action based on a comment left on an issue
   * @param context Probot context object
   */
  private async handleManualCommand(context: Context<'issue_comment'>) {
    const promises: Promise<void>[] = [];

    for (const line of context.payload.comment.body.split('\n')) {
      const cmd = await parseIssueCommand(
        context.payload.issue.body,
        line,
        this.versions,
      );

      // TODO(any): add 'stop' command
      if (cmd?.type === JobType.bisect) {
        promises.push(this.runBisectJob(cmd, context));
      } else if (cmd?.type === JobType.test) {
        promises.push(this.runTestMatrix(cmd, context));
      }
    }

    await Promise.all(promises);
  }

  private async runBisectJob(
    bisectCmd: BisectCommand,
    context: Context<'issue_comment'>,
  ) {
    const d = debug(`${DebugPrefix}:runBisectJob`);

    d(`Updating GitHub issue id ${context.payload.issue.id}`);
    const promises: Promise<unknown>[] = [];
    promises.push(this.setIssueComment('Queuing bisect job...', context));
    promises.push(
      context.octokit.issues.addLabels({
        ...context.issue(),
        labels: [Labels.BugBot.Running],
      }),
    );
    await Promise.all(promises);

    const jobId = await this.broker.queueBisectJob(bisectCmd);
    d(`Queued bisect job ${jobId}`);

    const completedJob = (await this.pollAndReturnJob(jobId)) as BisectJob;
    if (completedJob) {
      await this.handleBisectResult(completedJob, context);
    }
  }

  private async runTestMatrix(
    command: TestCommand,
    context: Context<'issue_comment'>,
  ) {
    const d = debug(`${DebugPrefix}:runTestMatrix`);
    d(
      'Running test matrix for platforms %o and versions %o',
      command.platforms,
      command.versions,
    );

    await this.setIssueComment('Queuing bisect job...', context);

    // queue all jobs for matrix
    const matrix: Matrix = {};
    const queueJobPromises: Promise<string>[] = [];

    for (const p of command.platforms) {
      matrix[p] = {};
      for (const v of command.versions) {
        // this is important because we need the version keys
        // to always be present for the table generator code
        matrix[p][v] = undefined;

        queueJobPromises.push(
          this.broker.queueTestJob({
            gistId: command.gistId,
            platforms: [p],
            type: 'test',
            versions: [v],
          }),
        );
      }
    }

    const ids = await Promise.all(queueJobPromises);

    d(`All ${ids.length} jobs queued: %o`, ids);

    const awaitOneJob = async (id: JobId) => {
      const job = (await this.pollAndReturnJob(id)) as TestJob;
      matrix[job.platform][job.version] = job;
      d('%O', matrix);
      await this.handleTestResult(job, matrix, context);
    };

    await Promise.all(ids.map((id) => awaitOneJob(id)));
    d(`All ${ids.length} test jobs complete!`);
  }

  private async pollAndReturnJob(jobId: JobId) {
    const d = debug(`${DebugPrefix}:pollAndReturnJob`);
    // FIXME: this state info, such as the timer, needs to be a
    // class property so that '/test stop' could stop the polling.
    // Poll until the job is complete
    d(`Polling job '${jobId}' every ${this.pollIntervalMs}ms`);

    return new Promise<Job | void>((resolve, reject) => {
      const pollBroker = async () => {
        if (this.isClosed) {
          return resolve();
        }

        d(`${jobId}: polling job...`);
        const job = await this.broker.getJob(jobId);
        if (!job.last) {
          d(`${jobId}: polled and still pending 🐌`, JSON.stringify(job));
          setTimeout(pollBroker, this.pollIntervalMs);
        } else {
          d(`${jobId}: complete 🚀 `);
          try {
            await this.broker.completeJob(jobId);
            return resolve(job);
          } catch (e) {
            return reject(e);
          }
        }
      };

      setTimeout(pollBroker, this.pollIntervalMs);
    });
  }

  private async handleTestResult(
    job: TestJob,
    matrix: Matrix,
    context: Context<'issue_comment'>,
  ) {
    const d = debug(`${DebugPrefix}:handleTestResult`);
    d({ job });
    const table = generateTable(matrix, this.brokerBaseUrl);
    await this.setIssueComment(table, context);
  }

  /**
   * Comments on the issue once a bisect operation is completed
   * @param result The result from a Fiddle bisection
   * @param context Probot context object
   */
  private async handleBisectResult(
    job: BisectJob,
    context: Context<'issue_comment'>,
  ): Promise<void> {
    const d = debug(`${DebugPrefix}:handleBisectResult`);
    const add_labels = new Set<string>();
    const del_labels = new Set<string>([Labels.BugBot.Running]);
    const paragraphs: string[] = [];
    const log_url = new URL(`/log/${job.id}`, this.brokerBaseUrl);

    const result = job.last;

    switch (result.status) {
      case 'success': {
        const [a, b] = result.version_range as [string, string];
        paragraphs.push(
          `It looks like this bug was introduced between ${a} and ${b}`,
          `Commits between those versions: https://github.com/electron/electron/compare/v${a}...v${b}`,
          `For more information, see ${log_url.toString()}`,
        );
        add_labels.add(Labels.Bug.Regression);
        // FIXME(any): get the majors in [a..b] and add version labels e.g. 13-x-y
        break;
      }

      // FIXME(any): need to distinguish between these two cases &
      // give appropriate response
      case 'system_error':
      case 'test_error': {
        paragraphs.push(
          // FIXME(any): oh hmm we will need a permanent web address to have clickable links.
          // Maybe we'll need to keep bugbot.electronjs.org around.
          // FIXME(any): add the link here.
          `${AppName} was unable to complete this bisection. Check the table’s links for more information.`,
          'A maintainer in @wg-releases will need to look into this. When any issues are resolved, BugBot can be restarted by replacing the bugbot/maintainer-needed label with bugbot/test-needed.',
          `For more information, see ${log_url.toString()}`,
        );
        add_labels.add(Labels.BugBot.MaintainerNeeded);
        break;
      }

      default:
        d(`unhandled status: ${result.status}`);
        break;
    }

    // add commment
    const promises: Promise<unknown>[] = [];
    const issue = context.issue();
    const body = paragraphs.join('\n\n');
    d('adding comment', body);
    promises.push(this.setIssueComment(body, context));

    // maybe remove labels
    for (const name of del_labels.values()) {
      d('removing label', name);
      promises.push(context.octokit.issues.removeLabel({ ...issue, name }));
    }

    // maybe add labels
    if (add_labels.size > 0) {
      const labels = [...add_labels.values()];
      d('adding labels %O', labels);
      promises.push(context.octokit.issues.addLabels({ ...issue, labels }));
    }

    await Promise.all(promises);
  }

  private async findIssueCommentId(context: Context<'issue_comment'>) {
    const d = debug(`${DebugPrefix}:findIssueCommentId`);
    const issueId = context.payload.issue.id;

    // is the comment id cached?
    if (this.botCommentIds.has(issueId)) {
      const commentId = this.botCommentIds.get(issueId);
      d(`found cached id ${commentId} for issue ${issueId}`);
      return commentId;
    }

    // not cached; try to look it up
    // FIXME(anyone): iterate past the first 100 comments if needed
    d(`scraping issue ${issueId} for the bot comment`);
    const issue = context.issue();
    const { data: comments } = await context.octokit.issues.listComments({
      ...issue,
      per_page: 100, // max
    });

    const lastBotComment = comments.reverse().find((comment) => {
      const botName = env('BUGBOT_GITHUB_LOGIN');
      return comment.user.login === `${botName}[bot]`;
    });
    const commentId = lastBotComment?.id;
    d(`scraping issue ${issueId} result: ${commentId}`);
    return commentId;
  }

  private async setIssueComment(
    body: string,
    context: Context<'issue_comment'>,
  ): Promise<void> {
    const d = debug(`${DebugPrefix}:setIssueComment`);
    const issue = context.issue();
    const issueId = context.payload.issue.id;
    const commentId = await this.findIssueCommentId(context);
    if (commentId) {
      d(`updating issue ${issueId} comment ${commentId}: %s`, body);
      await context.octokit.issues.updateComment({
        ...issue,
        body,
        comment_id: commentId,
      });
    } else {
      d(`creating new comment in issue ${issueId}:\n%s`, body);
      const response = await context.octokit.issues.createComment({
        ...issue,
        body,
      });
      this.botCommentIds.set(issueId, response.data.id);
    }
  }
}

export default (robot: Probot): void => {
  new GithubClient({
    authToken: env('BUGBOT_AUTH_TOKEN'),
    brokerBaseUrl: env('BUGBOT_BROKER_URL'),
    robot,
    pollIntervalMs: envInt('BUGBOT_POLL_INTERVAL_MS', 20_000),
  });
};
