import debug from 'debug';
import { inspect } from 'util';

import { BisectOptions, Label, Task, TaskType } from './interfaces';
import { bisectFiddle } from './runner-api';

const d = debug('github-client:probot');

// helpers

function createCommentTask(comment: string): Task {
  return { comment, type: TaskType.comment };
}

function createAddLabelsTask(...labels: Label[]): Task {
  return { labels, type: TaskType.addLabels };
}

function createRemoveLabelsTask(...labels: Label[]): Task {
  return { labels, type: TaskType.removeLabels };
}

function addComment(body: string, context: any): Promise<void> {
  const commentBody = context.issue({ body });
  return context.octokit.issues.createComment(commentBody);
}

// do some work

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

export async function runTasks(tasks: Task[], context: any) {
  for (;;) {
    const task = tasks.shift();
    switch (task?.type) {
      case TaskType.addLabels:
        throw new Error('not implemented yet');
        break;

      case TaskType.bisect:
        tasks.push(...(await autobisect(task.bisect!)));
        break;

      case TaskType.comment:
        await addComment(task.comment!, context);
        break;

      case TaskType.removeLabels:
        throw new Error('not implemented yet');
        break;

      default:
        d('unhandled:', task);
        break;
    }
  }
}
