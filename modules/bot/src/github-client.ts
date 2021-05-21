import debug from 'debug';
import { Probot } from 'probot';
import { inspect } from 'util';
import { FiddleBisectResult } from '@electron/bugbot-runner/dist/fiddle-bisect-parser';
import { parseIssueBody } from '@electron/bugbot-shared/lib/issue-parser';
import {
  bisectFiddle,
  checkComplete,
  hasRunningTest,
  markAsComplete,
  stopTest,
} from './runner-api';

const actions = {
  BISECT: 'bisect',
  STOP: 'stop',
};

async function commentResults(result: FiddleBisectResult, context: any) {
  const resultComment = context.issue({
    body: `🤖 Results from bisecting: \n ${JSON.stringify(result, null, 2)}`,
  });

  await context.octokit.issues.createComment(resultComment);
}

// TODO: figure out how to properly import this type
function parseComment(context: any) {
  const { payload } = context;
  const args = payload.comment.body.split(' ');
  const [command, action] = args;

  if (command !== '/test') {
    return;
  }

  const issueId = payload.issue.id;
  const hasTest = hasRunningTest(issueId);

  if (action === actions.STOP && hasTest) {
    stopTest(issueId);
  } else if (action === actions.BISECT && !hasTest) {
    const INTERVAL = 5 * 1000;

    const timer = setInterval(async () => {
      const isComplete = checkComplete(issueId);
      if (isComplete) {
        await commentResults(
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

export = (robot: Probot): void => {
  const d = debug('github-client:probot');
  d('hello world');

  // robot.onAny((context) => {
  //   d('any', inspect(context.payload));
  // });
  // robot.on('issue_comment', (context) => {
  //   d('issue_comment', inspect(context.payload));
  // });
  robot.on('issues.opened', async (context) => {
    // TODO: refactor this into its own function
    try {
      const fiddleInput = parseIssueBody(context.payload.issue.body);

      const result = await bisectFiddle(fiddleInput);
      // TODO: take action based on this

      const botResponse = result.success
        ? [
            '🤖 The bisect ✅ succeeded!',
            `* **Good version**: ${result.goodVersion}`,
            `* **Bad version**: ${result.badVersion}`,
            `Diff URL: https://github.com/electron/electron/compare/${result.goodVersion}..${result.badVersion}`,
          ].join('\n')
        : '🤖 The bisect ❌ failed. This Fiddle did not narrow down to two versions in the specified range.';
      const resultComment = context.issue({
        body: botResponse,
      });
      await context.octokit.issues.createComment(resultComment);
    } catch (e) {
      d('error', inspect(e));
    }
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
      parseComment(context);
    }
  });
  robot.on('issue_comment.edited', (context) => {
    d('issue_comment.deleted', inspect(context.payload));
  });
};
