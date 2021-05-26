import debug from 'debug';
import { Probot } from 'probot';
import { inspect } from 'util';
import { FiddleBisectResult } from '@electron/bugbot-runner/dist/fiddle-bisect-parser';
import { parseIssueBody } from '@electron/bugbot-shared/lib/issue-parser';
import {
  bisectFiddle,
  getCompleteJob,
  hasRunningTest,
  markAsComplete,
  stopTest,
} from './runner-api';

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
  const { payload } = context;
  const args = payload.comment.body.split(' ');
  const [command, action] = args;

  if (command !== '/test') {
    return;
  }

  const { id, body } = payload.issue;
  const hasTest = hasRunningTest(id);

  if (action === actions.STOP && hasTest) {
    stopTest(id);
  } else if (action === actions.BISECT && !hasTest) {
    // Get issue input and fire a bisect job
    const input = parseIssueBody(body);
    await bisectFiddle(input);

    const INTERVAL = 5 * 1000;

    // Poll every INTERVAL to see if the job is complete
    const timer = setInterval(() => {
      const jobResults = getCompleteJob(id);
      if (jobResults) {
        // TODO(erickzhao): add logic here
        commentBisectResult(
          {
            badVersion: 'v12.0.7',
            goodVersion: 'v12.0.9',
            success: true,
          },
          context,
        );
        markAsComplete();
        clearInterval(timer);
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
    // TODO: add allowlist here
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
