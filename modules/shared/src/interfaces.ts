export type BisectRange = [string, string];

export type JobId = string;

export type Platform = 'darwin' | 'linux' | 'win32';

export type RunnerId = string;

export interface Result {
  bisect_range?: BisectRange;
  error?: string;
  runner: RunnerId;
  status: 'failure' | 'success' | 'system_error' | 'test_error';
  time_begun: number;
  time_ended: number;
}

export interface Current {
  runner: RunnerId;
  time_begun: number;
}

export interface BaseJob {
  bot_client_data?: unknown;
  current?: Current;
  gist: string;
  history: Result[];
  id: JobId;
  last?: Result;
  platform?: Platform;
  time_added: number;
}

export interface BisectJob extends BaseJob {
  type: 'bisect';
  bisect_range: BisectRange;
}

export interface TestJob extends BaseJob {
  type: 'test';
  version: string;
}

export type AnyJob = BisectJob | TestJob;
