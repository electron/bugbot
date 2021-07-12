import ow from 'ow';
import * as uuid from 'uuid';
import * as semver from 'semver';

///

type GistId = string;
const GistPredicate = ow.string.validate((str) => ({
  validator: [...str].every((ch) => /[0-9a-fA-F]/.test(ch)),
  message: `Expected hexidecimal string; got ${str}`,
}));

export type JobId = string;
const JobIdPredicate = ow.string.validate((str) => ({
  validator: uuid.validate(str),
  message: `Expected value to be a UUID, got ${str}`,
}));

export type Platform = 'darwin' | 'linux' | 'win32';
const PlatformPredicate = ow.string.oneOf(['darwin', 'linux', 'win32']);

export type RunnerId = string;
const RunnerIdPredicate = ow.string;

type Version = string;
const VersionPredicate = ow.string.validate((str) => ({
  validator: Boolean(semver.valid(str)),
  message: `Expected value to be semver; got ${str}`,
}));

export type BisectRange = [Version, Version];
const BisectRangePredicate = ow.array.length(2).ofType(VersionPredicate);

///

export interface Result {
  bisect_range?: BisectRange;
  error?: string;
  runner: RunnerId;
  status: 'failure' | 'success' | 'system_error' | 'test_error';
  time_begun: number;
  time_ended: number;
}

const ResultPredicate = ow.object.exactShape({
  bisect_range: ow.optional.any(BisectRangePredicate),
  error: ow.optional.string,
  runner: RunnerIdPredicate,
  status: ow.string.oneOf(['failure', 'success', 'system_error', 'test_error']),
  time_begun: ow.number,
  time_ended: ow.number,
});

///

export interface Current {
  runner: RunnerId;
  time_begun: number;
}

const CurrentPredicate = ow.object.exactShape({
  runner: RunnerIdPredicate,
  time_begun: ow.number,
});

/// Jobs

interface BaseJob {
  bot_client_data?: unknown;
  current?: Current;
  gist: GistId;
  history: Result[];
  id: JobId;
  last?: Result;
  platform?: Platform;
  time_added: number;
}

export interface BisectJob extends BaseJob {
  bisect_range: BisectRange;
  type: 'bisect';
}

export interface TestJob extends BaseJob {
  type: 'test';
  version: Version;
}

const BisectJobPredicate = ow.object.exactShape({
  bisect_range: BisectRangePredicate,
  bot_client_data: ow.optional.any(ow.string, ow.number, ow.object),
  current: ow.optional.any(CurrentPredicate),
  gist: GistPredicate,
  history: ow.array.ofType(ResultPredicate),
  id: JobIdPredicate,
  last: ow.optional.any(ResultPredicate),
  platform: ow.optional.any(PlatformPredicate),
  time_added: ow.number,
  type: ow.string.equals('bisect'),
});

const TestJobPredicate = ow.object.exactShape({
  bot_client_data: ow.optional.any(ow.string, ow.number, ow.object),
  current: ow.optional.any(CurrentPredicate),
  gist: GistPredicate,
  history: ow.array.ofType(ResultPredicate),
  id: JobIdPredicate,
  last: ow.optional.any(ResultPredicate),
  platform: ow.optional.any(PlatformPredicate),
  time_added: ow.number,
  type: ow.string.equals('test'),
  version: VersionPredicate,
});

export type Job = BisectJob | TestJob;

export function assertJob(value: unknown): asserts value is Job {
  ow(value, ow.any(BisectJobPredicate, TestJobPredicate));
}
