import * as debug from 'debug';
import { Probot } from 'probot';
import { inspect } from 'util';

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
    d('issue_comment.created', inspect(context.payload));
  });
  robot.on('issue_comment.edited', (context) => {
    d('issue_comment.deleted', inspect(context.payload));
  });
};
