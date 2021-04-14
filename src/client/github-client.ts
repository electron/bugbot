import debug from 'debug';
import { Probot } from 'probot';
import { inspect } from 'util';
import { parseIssueBody } from '../util/issue-parser';

export = (robot: Probot): void => {
  const d = debug('github-client:probot');
  d('hello world');

  robot.onAny((context) => {
    d('any', inspect(context.payload));
  });
  robot.on('issue_comment', (context) => {
    d('issue_comment', inspect(context.payload));
  });
  robot.on('issues.opened', (context) => {
    try {
      const fiddleInput = parseIssueBody(context.payload.issue.body);
      const comment = context.issue({
        body: `I've detected that you want to run Fiddle with the following input:\n ${JSON.stringify(
          fiddleInput,
          null,
          2,
        )}`,
      });
      context.octokit.issues.createComment(comment);
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
