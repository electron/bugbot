// interfaces used by the client

export interface BisectOptions {
  badVersion: string;
  gistId: string;
  goodVersion: string;
}

export interface Task {
  bisect?: BisectOptions;
  comment?: string;
  labels?: Label[];
  test?: null;
  type: TaskType;
}

export const enum TaskType {
  'addLabels' = 'addLabels',
  'bisect' = 'bisect',
  'comment' = 'comment',
  'removeLabels' = 'addLabels',
}

export const enum Label {
  'bisectFailed' = 'bugbot/bisect-failed',
  'bisectNeeded' = 'bugbot/bisect-needed',
};
