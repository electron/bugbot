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

// Editing `PLATFORM_LIST` should automatically update the constants after it,
// including the `Platform` type thanks to some type magic :)
const PLATFORM_LIST = ['darwin', 'linux', 'win32'] as const;

export type Platform = typeof PLATFORM_LIST[number];
export const ALL_PLATFORMS: readonly Platform[] = PLATFORM_LIST;
const PlatformPredicate = ow.string.oneOf(ALL_PLATFORMS);

export type RunnerId = string;
const RunnerIdPredicate = ow.string;

type Version = string;
const VersionPredicate = ow.string.is((str) => {
  if (!semver.valid(str)) return `Expected ${str} to be semver`;
  return true;
});

// copied from electron-fiddle
function electronSemVerCompare(a: semver.SemVer, b: semver.SemVer) {
  const l = a.compareMain(b);
  if (l) return l;
  // Electron's approach is nightly -> other prerelease tags -> stable,
  // so force `nightly` to sort before other prerelease tags.
  const [prea] = a.prerelease;
  const [preb] = b.prerelease;
  if (prea === 'nightly' && preb !== 'nightly') return -1;
  if (prea !== 'nightly' && preb === 'nightly') return 1;
  return a.comparePre(b);
}

export type VersionRange = [Version, Version];
const VersionRangePredicate = ow.array
  .ofType(VersionPredicate)
  .length(2)
  .is((versions) => {
    const sems = versions.map((version) => semver.parse(version));
    const [v1, v2] = sems;
    return electronSemVerCompare(v1, v2) < 0
      ? true
      : `expected ${v1.version} to be less than ${v2.version}`;
  });

///

export interface Result {
  error?: string;
  runner: RunnerId;
  status: 'failure' | 'success' | 'system_error' | 'test_error';
  time_begun: number;
  time_ended: number;
  version_range?: VersionRange;
}

const ResultPredicate = ow.object.exactShape({
  error: ow.optional.string,
  runner: RunnerIdPredicate,
  status: ow.string.oneOf(['failure', 'success', 'system_error', 'test_error']),
  time_begun: ow.number.positive,
  time_ended: ow.number.positive,
  version_range: ow.optional.any(VersionRangePredicate),
});

///

export interface Current {
  runner: RunnerId;
  time_begun: number;
}

const CurrentPredicate = ow.object.exactShape({
  runner: RunnerIdPredicate,
  time_begun: ow.number.positive,
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

export enum JobType {
  bisect = 'bisect',
  test = 'test',
}

export interface BisectJob extends BaseJob {
  type: JobType.bisect;
  version_range: VersionRange;
}

export interface TestJob extends BaseJob {
  type: JobType.test;
  version: Version;
}

const BisectJobPredicate = ow.object.exactShape({
  bot_client_data: ow.optional.any(ow.string, ow.number, ow.object),
  current: ow.optional.any(CurrentPredicate),
  gist: GistPredicate,
  history: ow.array.ofType(ResultPredicate),
  id: JobIdPredicate,
  last: ow.optional.any(ResultPredicate),
  platform: ow.optional.any(PlatformPredicate),
  time_added: ow.number.positive,
  type: ow.string.equals(JobType.bisect),
  version_range: VersionRangePredicate,
});

export function assertBisectJob(value: unknown): asserts value is BisectJob {
  ow(value, ow.any(BisectJobPredicate));
}

const TestJobPredicate = ow.object.exactShape({
  bot_client_data: ow.optional.any(ow.string, ow.number, ow.object),
  current: ow.optional.any(CurrentPredicate),
  gist: GistPredicate,
  history: ow.array.ofType(ResultPredicate),
  id: JobIdPredicate,
  last: ow.optional.any(ResultPredicate),
  platform: ow.optional.any(PlatformPredicate),
  time_added: ow.number.positive,
  type: ow.string.equals(JobType.test),
  version: VersionPredicate,
});

export function assertTestJob(value: unknown): asserts value is TestJob {
  ow(value, ow.any(TestJobPredicate));
}

export type Job = BisectJob | TestJob;

export function assertJob(value: unknown): asserts value is Job {
  ow(value, ow.any(BisectJobPredicate, TestJobPredicate));
}
