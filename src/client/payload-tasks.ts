import debug from 'debug';

import { Label, Task, TaskType } from './interfaces';
import { parseIssueBody } from '../util/issue-parser';

const d = debug('github-client:payload-tasks');

// FIXME: processIssueOpened should also check labels...
// FIXME: ...and under current impl that would create two bisect tasks

function maybeAddBisection(tasks: Task[], payload: any) {
  try {
    const bisect = parseIssueBody(payload.issue.body);
    const str = JSON.stringify(bisect, null, 2);
    tasks.push(
      {
        comment: `🤖 Bisection info found: ${str}`,
        type: TaskType.comment,
      },
      {
        bisect: parseIssueBody(payload.issue.body),
        type: TaskType.bisect,
      },
    );
  } catch (error) {
    d('Not enough info for a bisect run');
  }
}

function processLabels(payload: any): Task[] {
  const tasks: Task[] = [];

  const test = (label: any) => label.name === Label.bisectNeeded;
  if (payload.issue.labels.some(test)) {
    maybeAddBisection(tasks, payload);
  }

  return tasks;
}

function processIssueOpened(payload: any): Task[] {
  const tasks: Task[] = [];

  maybeAddBisection(tasks, payload);

  return tasks;
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
