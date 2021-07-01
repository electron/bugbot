import debug from 'debug';
import { Context, Probot } from 'probot';
import { URL } from 'url';
import { inspect } from 'util';

import { JobId, Result } from '@electron/bugbot-shared/build/interfaces';
import { env, envInt } from '@electron/bugbot-shared/build/env-vars';
import {
  FiddleInput,
  parseIssueBody,
} from '@electron/bugbot-shared/build/issue-parser';

import BrokerAPI from './api-client';
import { Labels } from './github-labels';

const AppName = 'BugBot' as const;

const actions = {
  BISECT: 'bisect',
  STOP: 'stop',
};

const settings = {
  authToken: env('BUGBOT_AUTH_TOKEN'),
  brokerBaseUrl: env('BUGBOT_BROKER_URL'),
  pollIntervalMs: envInt('BUGBOT_POLL_INTERVAL_MS', 20_000),
} as const;

/**
 * Comments on the issue once a bisect operation is completed
 * @param result The result from a Fiddle bisection
 * @param context Probot context object
 */
async function commentBisectResult(
  jobId: JobId,
  result: Result,
  context: Context,
) {
  const d = debug('github-client:commentBisectResult');
  const add_labels = new Set<string>();
  const del_labels = new Set<string>([Labels.BugBot.Running]);
  const paragraphs: string[] = [];
  const log_url = new URL(`/log/${jobId}`, settings.brokerBaseUrl);

  switch (result.status) {
    case 'success': {
      const [a, b] = result.bisect_range;
      paragraphs.push(
        `It looks like this bug was introduced between ${a} and ${b}`,
        `Commits between those versions: https://github.com/electron/electron/compare/v${a}...v${b}`,
        `For more information, see ${log_url}`,
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
        `For more information, see ${log_url}`,
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

/**
 * Takes action based on a comment left on an issue
 * @param context Probot context object
 */
export async function parseManualCommand(context: Context): Promise<void> {
  const d = debug('github-client:parseManualCommand');
  const api = new BrokerAPI({
    authToken: settings.authToken,
    baseURL: settings.brokerBaseUrl,
  });

  const { payload } = context;
  const args = payload.comment.body.split(' ');
  const [command, action] = args;

  if (command !== '/test') {
    return;
  }

  const id = 'some-guid';

  let currentJob;

  try {
    currentJob = await api.getJob(id);
  } catch (e) {
    // no-op
  }

  if (action === actions.STOP && currentJob && !currentJob.time_finished) {
    api.stopJob(id);
  } else if (action === actions.BISECT && !currentJob) {
    d('Running /test bisect');
    // Get issue input and fire a bisect job
    const { body } = payload.issue;
    let input: FiddleInput;

    try {
      input = parseIssueBody(body);
    } catch (e) {
      d('Unable to parse issue body for bisect', e);
      return;
    }

    const jobId = await api.queueBisectJob(input);

    d(`Queued bisect job ${jobId}`);

    // Poll until the job is complete
    const timer = setInterval(async () => {
      d(`polling job ${jobId}...`);
      const job = await api.getJob(jobId);
      if (!job.last) {
        d('job still pending...', { job });
        return;
      }
      d(`job ${jobId} complete`);
      clearInterval(timer);
      await commentBisectResult(jobId, job.last, context);
      await api.completeJob(jobId);
    }, settings.pollIntervalMs);
  }
}

export default (robot: Probot): void => {
  const d = debug('github-client:probot');
  d('hello world');

  robot.onAny((context) => {
    d('any', inspect(context.payload));
  });
  robot.on('issue_comment', (context) => {
    d('issue_comment', inspect(context.payload));
  });
  robot.on('issues.opened', (context) => {
    d('issues.opened', inspect(context.payload));
  });
  robot.on('issues.labeled', (context) => {
    d('issues.labeled', inspect(context.payload));
  });
  robot.on('issues.unlabeled', (context) => {
    d('issues.unlabeled', inspect(context.payload));
  });
  robot.on('issues.edited', (context) => {
    d('issues.edited', inspect(context.payload));
  });
  robot.on('issue_comment.created', (context) => {
    // TODO(erickzhao): add allowlist here
    const isMaintainer = true;

    if (
      context.payload.comment.user.id === context.payload.sender.id &&
      isMaintainer
    ) {
      parseManualCommand(context);
    }
  });
  robot.on('issue_comment.edited', (context) => {
    d('issue_comment.edited', inspect(context.payload));
  });
};
