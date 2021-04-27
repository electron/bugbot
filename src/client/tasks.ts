export interface BisectOptions {
  badVersion: string;
  gistId: string;
  goodVersion: string;
}

export interface Task {
  bisect?: BisectOptions;
  body?: string;
  labels?: Label[];
  test?: null;
  type: TaskType;
}

export const enum TaskType {
  'addLabels' = 'addLabels',
  'bisect' = 'bisect',
  'comment' = 'comment',
  'removeLabels' = 'removeLabels',
}

export const enum Label {
  'bisectDone' = 'bugbot/bisect-done',
  'bisectFailed' = 'bugbot/bisect-failed',
  'bisectNeeded' = 'bugbot/bisect-needed',
}

export function createBisectTask(bisect: BisectOptions) {
  return { bisect, type: TaskType.bisect };
}

export function createCommentTask(body: string): Task {
  return { body, type: TaskType.comment };
}

export function createAddLabelsTask(...labels: Label[]): Task {
  return { labels, type: TaskType.addLabels };
}

export function createRemoveLabelsTask(...labels: Label[]): Task {
  return { labels, type: TaskType.removeLabels };
}
