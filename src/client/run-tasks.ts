import debug from 'debug';
import { inspect } from 'util';

import {
  BisectOptions,
  Label,
  Task,
  TaskType,
  createAddLabelsTask,
  createCommentTask,
  createRemoveLabelsTask,
} from './tasks';
import { bisectFiddle } from './runner-api';

const d = debug('github-client:probot');

// do some work

function addComment(body: string, context: any): Promise<void> {
  const commentBody = context.issue({ body });
  return context.octokit.issues.createComment(commentBody);
}

async function autobisect(options: BisectOptions): Promise<Task[]> {
  const tasks: Task[] = [];
  try {
    const result = await bisectFiddle(options);

    // FIXME: result should be a tristate, not a bool
    // FIXME: `Result.invalid` means we were unable to run due to system error
    if (result.success) {
      const comment = [
        '🤖 The bisect ✅ succeeded!',
        `* **Good version**: ${result.goodVersion}`,
        `* **Bad version**: ${result.badVersion}`,
      ].join('\n');
      tasks.push(
        createCommentTask(comment),
        createRemoveLabelsTask(Label.bisectNeeded),
      );
    } else {
      const comment = [
        '🤖 The bisect ❌ failed.',
        'Unable find the version that introduced the bug.',
      ].join('\n');
      tasks.push(
        createRemoveLabelsTask(Label.bisectNeeded),
        createAddLabelsTask(Label.bisectFailed),
        createCommentTask(comment),
      );
    }
  } catch (e) {
    d('error', inspect(e));
  }
  return tasks;
}

async function removeLabels(removeMe: Label[], context: any) {
  // there's no "remove set of labels" function,
  // so assign labels = prevLabels - removeMe
  const params = context.issue();
  const response = await context.octokit.issues.listLabelsOnIssue(params);
  const labels = new Set(response.data.map((item: any) => item.name));
  d('removeLabels()', 'existing labels', labels);
  for (const label of removeMe) {
    labels.delete(label);
  }
  d('removeLabels()', 'updated labels', labels);
  return context.octokit.issues.setLabels({ ...params, labels });
}

export async function runTasks(tasks: Task[], context: any) {
  for (;;) {
    const task = tasks.shift();
    if (!task) {
      break;
    }

    d('runTasks()', JSON.stringify(task));
    switch (task.type) {
      case TaskType.addLabels:
        throw new Error(`${task.type} not implemented yet`);
        break;

      case TaskType.bisect:
        tasks.push(...(await autobisect(task.bisect!)));
        break;

      case TaskType.comment:
        await addComment(task.body!, context);
        break;

      case TaskType.removeLabels:
        await removeLabels(task.labels!, context);
        break;
    }
  }
}
