import debug from 'debug';
import { Context, Probot } from 'probot';
import { URL } from 'url';
import { inspect } from 'util';

import { JobId, Result } from '@electron/bugbot-shared/lib/interfaces';
import { env, envInt } from '@electron/bugbot-shared/lib/env-vars';

import BrokerAPI from './broker-client';
import { Labels } from './github-labels';
import { FiddleInput, parseIssueBody } from './issue-parser';

const AppName = 'BugBot' as const;

const actions = {
  BISECT: 'bisect',
  STOP: 'stop',
};

export class GithubClient {
  private readonly broker: BrokerAPI;
  private readonly brokerBaseUrl: string;
  private readonly pollIntervalMs: number;
  private readonly robot: Probot;
  private isClosed = false;

  constructor(opts: {
    authToken: string;
    brokerBaseUrl: string;
    pollIntervalMs: number;
    robot: Probot;
  }) {
    const d = debug('GithubClient:constructor');

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
    const d = debug('GithubClient:listenToRobot');

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

  private static isMaintainer(login: string): Promise<boolean> {
    // TODO(erickzhao): add allowlist here
    const maintainers = ['ckerr', 'clavin', 'erickzhao'];
    return Promise.resolve(maintainers.includes(login));
  }

  public async onIssueComment(
    context: Context<'issue_comment'>,
  ): Promise<void> {
    const d = debug('GithubClient:onIssueCommentCreated');
    d('===> payload <===', JSON.stringify(context.payload));

    const { login } = context.payload.comment.user;
    if (!(await GithubClient.isMaintainer(login))) {
      d('not a maintainer; doing nothing');
      return;
    }

    d('calling parseManualCommand');
    return this.parseManualCommand(context);
  }

  /**
   * Takes action based on a comment left on an issue
   * @param context Probot context object
   */
  private async parseManualCommand(
    context: Context<'issue_comment'>,
  ): Promise<void> {
    const d = debug('GitHubClient:parseManualCommand');

    const { payload } = context;
    const args = payload.comment.body.split(' ');
    const [command, action] = args;
    d('command', command, 'action', action);

    if (command !== '/test') {
      d(`unexpected command "${command}"; returning`);
      return;
    }

    /*
     * FIXME: this draft implementation needs to be completed
     * const id = 'some-guid';
     * let currentJob;
     * try {
     *   currentJob = await this.broker.getJob(id);
     * } catch (e) {
     *    // no-op
     * }
     * if (action === actions.STOP && currentJob && !currentJob.time_finished) {
     *   this.broker.stopJob(id);
     * } else if (action === actions.BISECT && !currentJob) {
     */

    if (action === actions.BISECT) {
      d('Running /test bisect');
      // Get issue input and fire a bisect job
      const { body } = payload.issue;
      let input: FiddleInput;

      try {
        d(`body: "${body}"`);
        input = parseIssueBody(body);
        d(`parseIssueBody returned ${JSON.stringify(input)}`);
      } catch (e) {
        d('Unable to parse issue body for bisect', e);
        return;
      }

      const jobId = await this.broker.queueBisectJob(input);
      d(`Queued bisect job ${jobId}`);

      // FIXME: this state info, such as the timer, needs to be a
      // class property so that '/test stop' could stop the polling.
      // Poll until the job is complete
      const timer = setInterval(async () => {
        if (this.isClosed) return clearInterval(timer);
        d(`polling job ${jobId}...`);
        const job = await this.broker.getJob(jobId);
        if (!job.last) {
          d('job still pending...', JSON.stringify(job));
          return;
        }
        d(`job ${jobId} complete`);
        await this.commentBisectResult(jobId, job.last, context);
        await this.broker.completeJob(jobId);
        return clearInterval(timer);
      }, this.pollIntervalMs);
    }
  }

  /**
   * Comments on the issue once a bisect operation is completed
   * @param result The result from a Fiddle bisection
   * @param context Probot context object
   */
  private async commentBisectResult(
    jobId: JobId,
    result: Result,
    context: Context<'issue_comment'>,
  ): Promise<void> {
    const d = debug('GitHubClient:commentBisectResult');
    const add_labels = new Set<string>();
    const del_labels = new Set<string>([Labels.BugBot.Running]);
    const paragraphs: string[] = [];
    const log_url = new URL(`/log/${jobId}`, this.brokerBaseUrl);

    switch (result.status) {
      case 'success': {
        const [a, b] = result.bisect_range;
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
    const promises: Promise<any>[] = [];
    const issue = context.issue();
    const body = paragraphs.join('\n\n');
    d('adding comment', body);
    promises.push(context.octokit.issues.createComment({ ...issue, body }));

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
}

export default (robot: Probot): void => {
  new GithubClient({
    authToken: env('BUGBOT_AUTH_TOKEN'),
    brokerBaseUrl: env('BUGBOT_BROKER_URL'),
    robot,
    pollIntervalMs: envInt('BUGBOT_POLL_INTERVAL_MS', 20_000),
  });
};
