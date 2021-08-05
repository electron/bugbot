import debug from 'debug';
import fetch from 'node-fetch';
import { PassThrough } from 'stream';

import { URL } from 'url';
import { randomInt } from 'crypto';
import { v4 as uuidv4 } from 'uuid';

import { Runner as FiddleRunner } from 'electron-fiddle-runner';

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

import { Task } from './task';

export class Runner {
  private readonly authToken: string;
  private readonly brokerUrl: string;
  private readonly childTimeoutMs: number;
  private readonly debugPrefix: string;
  private readonly logIntervalMs: number;
  private readonly loop: RotaryLoop;
  private readonly fiddleRunner: FiddleRunner;
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
    fiddleRunner: FiddleRunner;
    logIntervalMs?: number;
    platform?: Platform;
    pollIntervalMs?: number;
    uuid?: string;
  }) {
    this.fiddleRunner = opts.fiddleRunner;
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

  private async runBisect(task: Task): Promise<Partial<Result>> {
    const d = debug(`${this.debugPrefix}:runBisect`);
    const log = (first, ...rest) => {
      task.addLogData([first, ...rest].join(' '));
      d(first, ...rest);
    };

    const { job } = task;
    assertBisectJob(job);
    const { gist, version_range } = job;
    const [v1, v2] = version_range;
    log('bisecting', gist, v1, v2);

    const out = new PassThrough();
    out.on('data', (chunk: string | Buffer) => log(chunk.toString()));

    const result = await this.fiddleRunner.bisect(v1, v2, gist, {
      headless: true,
      out,
      showConfig: true,
      timeout: this.childTimeoutMs,
    });

    // TODO(anyone): sync the naming of status strings and
    // Result properties between bugbot and electron-fiddle-runner
    if (result.status === 'bisect_succeeded') {
      return { version_range: result.range, status: 'success' };
    } else {
      return { version_range: result.range, status: result.status };
    }
  }

  private async runTest(task: Task): Promise<Partial<Result>> {
    const d = debug(`${this.debugPrefix}:runBisect`);
    const log = (first, ...rest) => {
      task.addLogData([first, ...rest].join(' '));
      d(first, ...rest);
    };

    const { job } = task;
    assertTestJob(job);
    const { gist, version } = job;

    const out = new PassThrough();
    out.on('data', (chunk: string | Buffer) => log(chunk.toString()));

    const result = await this.fiddleRunner.run(version, gist, {
      headless: true,
      out,
      showConfig: true,
      timeout: this.childTimeoutMs,
    });

    // TODO(anyone): sync the naming of status strings and
    // Result properties between bugbot and electron-fiddle-runner
    switch (result.status) {
      case 'test_passed':
        return { status: 'success' };

      case 'test_failed':
        return { status: 'failure', error: 'The test ran and failed.' };

      case 'test_error':
        return {
          error: 'The test could not complete due to an error in the test.',
          status: 'test_error',
        };

      case 'system_error':
        return {
          error: 'The test could not be run due to a system error.',
          status: 'system_error',
        };
    }
  }
}
