import debug from 'debug';
import * as os from 'os';
import fetch from 'node-fetch';
import getos from 'getos';
import { inspect } from 'util';

import { URL } from 'url';
import { randomInt } from 'crypto';
import { spawnSync } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { Setup } from './setup';
import { Task } from './task';

import {
  JobId,
  JobType,
  Platform,
  Result,
  RunnerId,
  assertJob,
  assertBisectJob,
  assertTestJob,
} from '@electron/bugbot-shared/build/interfaces';
import { RotaryLoop } from '@electron/bugbot-shared/build/rotary-loop';
import { env, envInt } from '@electron/bugbot-shared/build/env-vars';
import { ElectronVersions } from '@electron/bugbot-shared/build/electron-versions';

export class Runner {
  private osInfo = '';
  private readonly authToken: string;
  private readonly brokerUrl: string;
  private readonly childTimeoutMs: number;
  private readonly debugPrefix: string;
  private readonly fiddleExec: string;
  private readonly logIntervalMs: number;
  private readonly loop: RotaryLoop;
  private readonly setup: Setup;
  private readonly versions = new ElectronVersions();
  public readonly platform: Platform;
  public readonly uuid: RunnerId;

  /**
   * Creates and initializes the runner from environment variables and default
   * values, then starts the runner's execution loop.
   */
  constructor(opts: {
    authToken?: string;
    brokerUrl?: string;
    childTimeoutMs?: number;
    fiddleExec?: string;
    logIntervalMs?: number;
    platform?: Platform;
    pollIntervalMs?: number;
    setup: Setup;
    uuid?: string;
  }) {
    this.setup = opts.setup;
    this.authToken = opts.authToken || env('BUGBOT_AUTH_TOKEN');
    this.brokerUrl = opts.brokerUrl || env('BUGBOT_BROKER_URL');
    this.childTimeoutMs =
      opts.childTimeoutMs || envInt('BUGBOT_CHILD_TIMEOUT_MS', 60_000);
    this.logIntervalMs = opts.logIntervalMs ?? 2_000;
    this.platform = (opts.platform || process.platform) as Platform;
    this.uuid = opts.uuid || uuidv4();
    this.debugPrefix = `runner:${this.uuid}`;
    const pollIntervalMs =
      opts.pollIntervalMs || envInt('BUGBOT_POLL_INTERVAL_MS', 20_000);
    this.loop = new RotaryLoop(this.debugPrefix, pollIntervalMs, this.pollOnce);
    getos((err, result) => (this.osInfo = inspect(result || err)));
  }

  public start = () => this.loop.start();

  public stop = () => this.loop.stop();

  public pollOnce = async (): Promise<void> => {
    let task: Task | undefined;
    const d = debug(`${this.debugPrefix}:pollOnce`);

    while ((task = await this.claimNextTask())) {
      d('next task: %o', task);

      // run the job
      d(`running job.id "${task.job.id}"`);
      let result: Partial<Result>;
      switch (task.job.type) {
        case JobType.bisect:
          result = await this.runBisect(task);
          break;

        case JobType.test:
          result = await this.runTest(task);
          break;
      }

      d(task.job.id, 'sending result');
      await task.sendResult(result);
      d('done');
    }
  };

  private async claimNextTask(): Promise<Task | undefined> {
    const d = debug(`${this.debugPrefix}:claimNextTask`);

    // find a job and claim it.
    let task: Task | undefined;
    const ids = await this.fetchAvailableJobIds();
    d('available jobs: %o', ids);
    while (!task && ids.length > 0) {
      // pick one at random
      const idx = randomInt(0, ids.length);
      const [id] = ids.splice(idx, 1);

      // try to claim it
      d('claiming job %s, jobs remaining %o', id, ids);
      const t = await this.fetchTask(id); // get the etag
      if (await t.claimForRunner()) task = t;
    }

    return task;
  }

  /**
   * Polls the broker for a list of unclaimed job IDs.
   */
  private async fetchAvailableJobIds(): Promise<JobId[]> {
    // Craft the url to the broker
    const jobs_url = new URL('api/jobs', this.brokerUrl);
    // find jobs compatible with this runner...
    jobs_url.searchParams.append('platform', `${this.platform},undefined`);
    // ...is not currently claimed
    jobs_url.searchParams.append('current.runner', 'undefined');
    // ...and which have never been run
    jobs_url.searchParams.append('last.status', 'undefined');
    jobs_url.searchParams.append(
      'type',
      `${JobType.bisect as string},${JobType.test as string}`,
    );

    // Make the request and return its response
    return await fetch(jobs_url, {
      headers: {
        Authorization: `Bearer ${this.authToken}`,
      },
    }).then((res) => res.json());
  }

  private async fetchTask(id: JobId): Promise<Task> {
    const d = debug(`${this.debugPrefix}:fetchTask`);

    const job_url = new URL(`api/jobs/${id}`, this.brokerUrl);
    const resp = await fetch(job_url, {
      headers: {
        Authorization: `Bearer ${this.authToken}`,
      },
    });

    // Extract the etag header & make sure it was defined
    const etag = resp.headers.get('etag');
    if (!etag) {
      throw new Error('missing etag in broker job response');
    }

    const job = await resp.json();
    d('job %o', job);
    assertJob(job);
    return new Task(
      job,
      etag,
      this.uuid,
      this.authToken,
      this.brokerUrl,
      this.logIntervalMs,
    );
  }

  private async runBisect(task: Task) {
    const d = debug(`${this.debugPrefix}:runBisect`);
    const log = (first, ...rest) => {
      task.addLogData([first, ...rest].join(' '));
      d(first, ...rest);
    };

    const { job } = task;
    assertBisectJob(job);
    const { gist, version_range } = job;
    const versions = await this.versions.getVersionsInRange(version_range);

    const displayIndex = (i: number) => '#' + i.toString().padStart(4, ' ');

    const displayResult = (result) => {
      if (!result) return '';
      if (result.status === 0) return '🟢 passed';
      if (result.status === 1) return '🔴 failed';
      return '🟠 error: test did not pass or fail';
      // FIXME: more reasons
    };

    log(
      [
        '📐 Bisect Requested',
        '',
        ` - gist is https://gist.github.com/${gist}`,
        ` - the version range is [${version_range.join('..')}]`,
        ` - there are ${versions.length} versions in this range:`,
        '',
        ...versions.map((ver, i) => `${displayIndex(i)} - ${ver}`),
      ].join('\n'),
    );

    // basically a binary search
    let left = 0;
    let right = versions.length - 1;
    let status;
    const testOrder: (number | undefined)[] = [];
    const results: ({ status?: number; error?: Error } | undefined)[] =
      new Array(versions.length);
    while (left + 1 < right) {
      const mid = Math.round(left + (right - left) / 2);
      const version = versions[mid];
      testOrder.push(mid);
      log(`bisecting, range [${left}..${right}], mid ${mid} (${version})`);

      const result = await this.runFiddle(task, version, gist);
      results[mid] = result;
      log(`${displayResult(result)} ${versions[mid]}\n`);

      if (result.status === 0) {
        left = mid;
        continue;
      } else if (result.status === 1) {
        right = mid;
        continue;
      } else {
        // FIXME: check errors
        status = result.status;
        break;
      }
    }

    log(`🏁 finished bisecting across ${versions.length} versions...`);
    versions.forEach((ver, i) => {
      const n = testOrder.indexOf(i);
      if (n === -1) return;
      log(displayIndex(i), displayResult(results[i]), ver, `(test #${n + 1})`);
    });

    log('\n🏁 Done bisecting');
    const success = results[left].status === 0 && results[right].status === 1;
    if (success) {
      const good = versions[left];
      const bad = versions[right];
      const results = [
        `🟢 passed ${good}`,
        `🔴 failed ${bad}`,
        'Commits between versions:',
        `↔ https://github.com/electron/electron/compare/v${good}...v${bad}`,
      ].join('\n');
      log(results);
    } else {
      // FIXME: log some failure
    }

    const result: Partial<Result> = {};
    if (success) {
      result.status = 'success';
      result.version_range = [versions[left], versions[right]];
    } else {
      // TODO(clavin): ^ better wording
      result.error = `Failed to narrow test down to two versions`;
      result.status = status === 1 ? 'test_error' : 'system_error';
    }
    return result;
  }

  private async runTest(task: Task) {
    const { job } = task;
    assertTestJob(job);
    const { error, status } = await this.runFiddle(task, job.version, job.gist);

    const result: Partial<Result> = {};
    if (error) {
      result.status = 'system_error';
      result.error = `Unable to run Electron Fiddle. ${error.toString()}`;
    } else if (status === 0) {
      result.status = 'success';
    } else if (status === 1) {
      result.status = 'failure';
      result.error = 'The test ran and failed.';
    } else {
      result.status = 'test_error';
      result.error = 'Electron Fiddle was unable to complete the test.';
    }
    return result;
  }

  private async runFiddle(task: Task, version: string, gistId: string) {
    const d = debug(`${this.debugPrefix}:runFiddle`);

    // set up the electron binary and the gist
    let exec = await this.setup.prepareElectron(version);
    const folder = await this.setup.prepareGist(gistId);
    const args = [folder];
    if (process.platform !== 'darwin' && process.platform !== 'win32') {
      args.unshift(exec);
      exec = 'xvfb-run';
    }

    task.addLogData(`🧪 Testing

  - date: ${new Date().toISOString()}
  - electron_version: ${version}  https://github.com/electron/electron/releases/tag/v${version}
  - gist: https://gist.github.com/${gistId}

  - os_arch: ${os.arch()}
  - os_platform: ${process.platform}
  - os_release: ${os.release()}
  - os_version: ${os.version()}
  - getos: ${this.osInfo}

`);
    const opts = {
      env: {},
      timeout: this.childTimeoutMs,
    };
    d('⏳ fiddle starting', inspect({ exec, args, opts }));
    const result = spawnSync(exec, args, opts);
    const { error, pid, signal, status, stderr, stdout } = result;
    d('⌛ fiddle finished', inspect({ error, pid, signal, status }));
    task.addLogData(stdout.toString('utf8'));
    task.addLogData(stderr.toString('utf8'));
    return { error, status };
  }
}
