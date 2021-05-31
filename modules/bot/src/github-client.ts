import debug from 'debug';
import { Probot } from 'probot';
import { inspect } from 'util';
import { FiddleBisectResult } from '@electron/bugbot-runner/dist/fiddle-bisect-parser';
import { parseIssueBody } from '@electron/bugbot-shared/lib/issue-parser';
import BrokerAPI from './api-client';

const actions = {
  BISECT: 'bisect',
  STOP: 'stop',
};

/**
 * Comments on the issue once a bisect operation is completed
 * @param result The result from a Fiddle bisection
 * @param context Probot context object
 */
async function commentBisectResult(result: FiddleBisectResult, context: any) {
  const resultComment = context.issue({
    body: `🤖 Results from bisecting: \n ${JSON.stringify(result, null, 2)}`,
  });

  await context.octokit.issues.createComment(resultComment);
}

/**
 * Takes action based on a comment left on an issue
 * @param context Probot context object
 */
export async function parseManualCommand(context: any): Promise<void> {
  const d = debug('github-client:parseManualCommand');
  const api = new BrokerAPI({
    baseURL: 'http://localhost:9099',
  });

  const { payload } = context;
  const args = payload.comment.body.split(' ');
  const [command, action] = args;

  if (command !== '/test') {
    return;
  }

  const { body } = payload.issue;
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
    const input = parseIssueBody(body);
    const jobId = await api.queueBisectJob(input);
    d(`Queued bisect job ${jobId}`);

    // Poll every INTERVAL to see if the job is complete
    const INTERVAL = 10 * 1000;
    const timer = setInterval(async () => {
      d(`polling job ${jobId}...`);
      const job = await api.getJob(jobId);
      if (!job.last) {
        d('job still pending...', { job });
        return;
      }
      d(`job ${jobId} complete`);
      clearInterval(timer);
      switch (job.last.status) {
        case 'success':
          await commentBisectResult(
            {
              badVersion: job.last.bisect_range[0],
              goodVersion: job.last.bisect_range[1],
              success: true,
            },
            context,
          );
          await api.completeJob(jobId);
          break;

        default: {
          //FIXME: handle error results
          d(`unhandled status: ${job.last.status}`);
        }
      }
    }, INTERVAL);
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
