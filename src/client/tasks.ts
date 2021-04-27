type GistId = string;

export interface BisectOptions {
  badVersion: string;
  gistId: GistId;
  goodVersion: string;
}

export interface TestOptions {
  badVersion: string;
  gistId: GistId;
}

export const enum Label {
  'bisectDone' = 'bugbot/bisect-done',
  'bisectFailed' = 'bugbot/bisect-failed',
  'bisectNeeded' = 'bugbot/bisect-needed',
  'testDone' = 'bugbot/test-done',
  'testFailed' = 'bugbot/test-failed',
  'testNeeded' = 'bugbot/test-needed',
}

export interface Task {
  bisect?: BisectOptions;
  body?: string;
  labels?: Label[];
  test?: TestOptions;
  type: TaskType;
}

export const enum TaskType {
  'addLabels' = 'addLabels',
  'bisect' = 'bisect',
  'comment' = 'comment',
  'removeLabels' = 'removeLabels',
  'test' = 'test',
}

export function createAddLabelsTask(...labels: Label[]): Task {
  return { labels, type: TaskType.addLabels };
}

export function createBisectTask(bisect: BisectOptions) {
  return { bisect, type: TaskType.bisect };
}

export function createCommentTask(body: string): Task {
  return { body, type: TaskType.comment };
}

export function createRemoveLabelsTask(...labels: Label[]): Task {
  return { labels, type: TaskType.removeLabels };
}

export function createTestTask(test: TestOptions): Task {
  return { test, type: TaskType.test };
}
