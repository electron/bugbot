export interface Result {
  bisect_range?: [string, string];
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
