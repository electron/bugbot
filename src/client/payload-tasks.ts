import debug from 'debug';

import {
  Label,
  Task,
  createBisectTask,
  createCommentTask,
  createTestTask,
} from './tasks';
import {
  getBisectOptionsFromBody,
  getTestOptionsFromBody,
} from '../util/issue-parser';

const d = debug('github-client:payload-tasks');

function maybeBisect(payload: any): Task[] {
  const tasks: Task[] = [];

  const opts = getBisectOptionsFromBody(payload.issue.body);
  if (!opts) {
    d('Not enough info for a bisect run');
  } else {
    const str = JSON.stringify(opts, null, 2);
    tasks.push(
      createCommentTask(`🤖 Bisection info found: ${str}`),
      createBisectTask(opts),
    );
  }

  return tasks;
}

function maybeTest(payload: any): Task[] {
  const tasks: Task[] = [];

  const opts = getTestOptionsFromBody(payload.issue.body);
  if (!opts) {
    d('Not enough info for a test run');
  } else {
    const str = JSON.stringify(opts, null, 2);
    tasks.push(
      createCommentTask(`🤖 Bisection info found: ${str}`),
      createTestTask(opts),
    );
  }

  return tasks;
}

function processLabels(payload: any): Task[] {
  const tasks: Task[] = [];
  const names = new Set(payload.issue.labels.map((label: any) => label.name));
  d('processLabels()', 'found labels', [...names]);

  if (names.has(Label.bisectNeeded)) {
    tasks.push(...maybeBisect(payload));
  }
  if (names.has(Label.testNeeded)) {
    tasks.push(...maybeTest(payload));
  }

  return tasks;
}

function removeDuplicates(tasks: Task[]): Task[] {
  const map: Map<string, Task> = new Map(
    tasks.map((task) => [JSON.stringify(task), task]),
  );
  return [...map.values()];
}

function processIssueOpened(payload: any): Task[] {
  const tasks: Task[] = [];

  tasks.push(...processLabels(payload));
  tasks.push(...maybeBisect(payload));
  tasks.push(...maybeTest(payload));

  return removeDuplicates(tasks);
}

// Takes no action on its own.
// Decides what action to take next.
export function getTasksFromPayload(payload: any): Task[] {
  switch (payload.action) {
    case 'labeled':
      return processLabels(payload);
    case 'opened':
      return processIssueOpened(payload);
    default:
      d('unhandled payload');
      return [];
  }
}
