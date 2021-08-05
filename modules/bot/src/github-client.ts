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

interface BotCommentInfo {
  body: string;
  id: number; // comment id
  time: number; // epoch msec
}

export class GithubClient {
  private isClosed = false;
  private readonly broker: BrokerAPI;
  private readonly brokerBaseUrl: string;
  private readonly pollIntervalMs: number;
  private readonly robot: Probot;
  private readonly versions = new ElectronVersions();

  // issue id # -> bugbot's comment in that issue for the current task
  private readonly currentComment = new Map<number, BotCommentInfo>();

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
    const { issue } = context.payload;

    for (const line of context.payload.comment.body.split('\n')) {
      const cmd = await parseIssueCommand(issue.body, line, this.versions);

      // TODO(any): add 'stop' command
      if (cmd?.type === JobType.bisect) {
        promises.push(this.runBisectJob(cmd, context));
      } else if (cmd?.type === JobType.test) {
        promises.push(this.runTestMatrix(cmd, context));
      }
    }

    await Promise.all(promises);

    this.currentComment.delete(issue.id);
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

    const completedJob = (await this.pollJobUntilDone(jobId)) as BisectJob;
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

    // while the jobs are running, periodically update the comment
    const COMMENT_INTERVAL_MSEC = 5_000 as const;
    const updateComment = () =>
      this.setIssueMatrixComment(matrix, context, command.gistId);
    const interval = setInterval(updateComment, COMMENT_INTERVAL_MSEC);
    await updateComment();

    // poll jobs until they're all settled
    const updateMatrix = (j: TestJob) => (matrix[j.platform][j.version] = j);
    await Promise.all(ids.map((id) => this.pollJobUntilDone(id, updateMatrix)));

    // jobs done; patch the comment one last time to ensure everything is shown
    d(`All ${ids.length} test jobs complete! Updating the comment`);
    clearInterval(interval);
    await updateComment();
  }

  private async pollJobUntilDone(
    jobId: JobId,
    // callback to be invoked after each poll loop completes
    onJobPolled: undefined | ((job: Job) => void) = undefined,
  ) {
    const ms = this.pollIntervalMs;
    const d = debug([DebugPrefix, 'pollJobUntilDone', jobId].join(':'));
    d(`Polling job every ${this.pollIntervalMs}ms`);

    while (!this.isClosed) {
      d('polling job...');
      const job = await this.broker.getJob(jobId);
      onJobPolled?.(job);
      if (job.last) {
        d('complete 🚀');
        return job;
      }
      d('polled and still pending 🐌', JSON.stringify(job));
      await new Promise((r) => setTimeout(r, ms, ms));
    }
  }

  private async setIssueMatrixComment(
    matrix: Matrix,
    context: Context<'issue_comment'>,
    gist: string,
  ) {
    const d = debug(`${DebugPrefix}:setIssueMatrixComment`);
    const link = `Testing https://gist.github.com/${gist}`;
    const table = generateTable(matrix, this.brokerBaseUrl);
    const footer = `*I am a bot. [Learn more about what I can do!](https://github.com/electron/bugbot#readme)*`;
    const body = [link, table, footer].join('\n\n');
    d(`issueId ${context.payload.issue.id} body:\n${body}`);
    await this.setIssueComment(body, context);
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

  private async setIssueComment(
    body: string,
    context: Context<'issue_comment'>,
  ): Promise<void> {
    const d = debug(`${DebugPrefix}:setIssueComment`);
    const issueId = context.payload.issue.id;
    d(`setting issue #${issueId} bot comment:\n%s`, body);

    let comment = this.currentComment.get(issueId);

    // maybe do nothing
    if (body === comment?.body) {
      d('new body matches previous body; not updating');
      return;
    }

    // maybe patch an existing comment
    if (comment) {
      try {
        d(`patching existing comment ${comment.id}`);
        const opts = context.issue({ body, comment_id: comment.id });
        await context.octokit.issues.updateComment(opts);
        comment.body = body;
        comment.time = Date.now();
        d('patch done');
        return;
      } catch (error) {
        d('patching existing comment failed; posting a new one instead', error);
      }
    }

    // post a new comment
    try {
      d('no comment to update; posting a new one');
      const opts = context.issue({ body });
      const response = await context.octokit.issues.createComment(opts);
      comment = { body, id: response.data.id, time: Date.now() };
      d('new comment created; id is', comment.id);
      this.currentComment.set(issueId, comment);
    } catch (error) {
      d('unable to post new comment', error);
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
