import debug from 'debug';
import { Probot } from 'probot';

import { getTasksFromPayload } from './payload-tasks';
import { runTasks } from './run-tasks';

const d = debug('github-client:probot');

function processPayload(context: any) {
  d('processPayload()', context.payload.action);
  runTasks(getTasksFromPayload(context.payload), context);
}

export = (probot: Probot): void => {
  probot.on('issues.opened', processPayload);
  probot.on('issues.labeled', processPayload);

  // leaving these here because we may need them?
  // robot.on('issue_comment.created', (context) => {
  // robot.on('issue_comment.edited', (context) => {
  // robot.on('issues.edited', (context) => {
  // robot.on('issues.unlabeled', (context) => {
  // full list @ https://github.com/octokit/webhooks.js/#webhook-events
};
