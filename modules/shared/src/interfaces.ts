export type BisectRange = [string, string];

export type JobId = string;

export type RunnerId = string;

export interface BaseJob {
  bot_client_data?: string;
  gist: string;
  id: string;
  platform?: 'darwin' | 'linux' | 'win32';
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

export interface Result {
  bisect_range?: BisectRange;
  error?: string;
  runner: string;
  status: 'failure' | 'success' | 'system_error' | 'test_error';
  time_begun: number;
  time_ended: number;
}

export interface Current {
  runner: string;
  time_begun: number;
}
