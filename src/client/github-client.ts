import debug from 'debug';
import { Probot } from 'probot';
import { inspect } from 'util';
import { parseIssueBody } from '../util/issue-parser';
import { bisectFiddle } from './runner-api';

export = (robot: Probot): void => {
  const d = debug('github-client:probot');
  d('hello world');

  robot.onAny((context) => {
    d('any', inspect(context.payload));
  });
  robot.on('issue_comment', (context) => {
    d('issue_comment', inspect(context.payload));
  });
  robot.on('issues.opened', async (context) => {
    // TODO: refactor this into its own function
    try {
      const fiddleInput = parseIssueBody(context.payload.issue.body);

      // this comment is for debugging purposes to make sure the input was passed in properly
      const debugComment = context.issue({
        body: `🤖 I've detected that you want to bisect a Fiddle with the following input:\n ${JSON.stringify(
          fiddleInput,
          null,
          2,
        )}`,
      });
      await context.octokit.issues.createComment(debugComment);

      const result = await bisectFiddle(fiddleInput);
      // TODO: take action based on this

      const botResponse = result.success
        ? [
            '🤖 The bisect ✅ succeeded!',
            `* **Good version**: ${result.goodVersion}`,
            `* **Bad version**: ${result.badVersion}`,
            // TODO: diff url?
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
    d('issue_comment.created', inspect(context.payload));
  });
  robot.on('issue_comment.edited', (context) => {
    d('issue_comment.deleted', inspect(context.payload));
  });
};
