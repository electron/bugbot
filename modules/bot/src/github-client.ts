import debug from 'debug';
import { Context, Probot } from 'probot';
import { URL } from 'url';
import { inspect } from 'util';

import {
  Job,
  JobId,
  JobType,
  Result,
} from '@electron/bugbot-shared/build/interfaces';
import { env, envInt } from '@electron/bugbot-shared/build/env-vars';

import BrokerAPI from './broker-client';
import { Labels } from './github-labels';
import { BisectCommand, parseIssueCommand } from './issue-parser';
import { ElectronVersions } from './electron-versions';

const AppName = 'BugBot' as const;
const DebugPrefix = 'GitHubClient' as const;

export class GithubClient {
  private isClosed = false;
  private readonly broker: BrokerAPI;
  private readonly brokerBaseUrl: string;
  private readonly pollIntervalMs: number;
  private readonly robot: Probot;
  private readonly versions = new ElectronVersions();

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
    this.robot.onAny(debugContext);
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
    d('===> payload <===', JSON.stringify(context.payload));

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

    const completedJob = await this.pollAndReturnJob(jobId);
    if (completedJob) {
      await this.handleBisectResult(
        completedJob.id,
        completedJob.last,
        context,
      );
    }
  }

  private async pollAndReturnJob(jobId: JobId) {
    const d = debug(`${DebugPrefix}:pollJobId`);
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

  /**
   * Comments on the issue once a bisect operation is completed
   * @param result The result from a Fiddle bisection
   * @param context Probot context object
   */
  private async handleBisectResult(
    jobId: JobId,
    result: Result,
    context: Context<'issue_comment'>,
  ): Promise<void> {
    const d = debug(`${DebugPrefix}:commentBisectResult`);
    const add_labels = new Set<string>();
    const del_labels = new Set<string>([Labels.BugBot.Running]);
    const paragraphs: string[] = [];
    const log_url = new URL(`/log/${jobId}`, this.brokerBaseUrl);

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
    markdownComment: string,
    context: Context<'issue_comment'>,
  ): Promise<void> {
    const issue = context.issue();

    // FIXME(any): iterate through all pages to get full comment set
    const { data: comments } = await context.octokit.issues.listComments({
      ...issue,
      per_page: 100, // max
    });

    const lastBotComment = comments.reverse().find((comment) => {
      const { user } = comment;
      const botName = env('BUGBOT_GITHUB_LOGIN');
      return user.login === `${botName}[bot]`;
    });

    if (lastBotComment) {
      await context.octokit.issues.updateComment({
        ...issue,
        comment_id: lastBotComment.id,
        body: markdownComment,
      });
    } else {
      await context.octokit.issues.createComment({
        ...issue,
        body: markdownComment,
      });
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
