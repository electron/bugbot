import debug from 'debug';
import fetch from 'node-fetch';
import stringArgv from 'string-argv';
import which from 'which';
import { URL } from 'url';
import { inspect } from 'util';
import { randomInt } from 'crypto';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';

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

import { parseFiddleBisectOutput } from './fiddle-bisect-parser';
import { Task } from './task';

export class Runner {
  public readonly platform: Platform;
  public readonly uuid: RunnerId;
  private readonly debugPrefix: string;

  private readonly authToken: string;
  private readonly brokerUrl: string;
  private readonly childTimeoutMs: number;
  private readonly fiddleExec: string;
  private readonly fiddleArgv: string[];
  private readonly logIntervalMs: number;
  private readonly loop: RotaryLoop;

  /**
   * Creates and initializes the runner from environment variables and default
   * values, then starts the runner's execution loop.
   */
  constructor(
    opts: {
      authToken?: string;
      brokerUrl?: string;
      childTimeoutMs?: number;
      fiddleExec?: string;
      logIntervalMs?: number;
      platform?: Platform;
      pollIntervalMs?: number;
      uuid?: string;
    } = {},
  ) {
    this.authToken = opts.authToken || env('BUGBOT_AUTH_TOKEN');
    this.brokerUrl = opts.brokerUrl || env('BUGBOT_BROKER_URL');
    this.childTimeoutMs =
      opts.childTimeoutMs || envInt('BUGBOT_CHILD_TIMEOUT_MS', 5 * 60_000);
    this.fiddleArgv = stringArgv(
      opts.fiddleExec ||
        process.env.BUGBOT_FIDDLE_EXEC ||
        which.sync('electron-fiddle'),
    );
    this.fiddleExec = this.fiddleArgv.shift();
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
      d(task.job.id, 'running job');
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

    d('task %o', task);
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

    const { job } = task;
    assertBisectJob(job);

    const { code, error, out } = await this.runFiddle(task, [
      ...this.fiddleArgv,
      ...[JobType.bisect, job.version_range[0], job.version_range[1]],
      ...['--fiddle', job.gist],
      '--full',
      '--log-config',
    ]);

    const result: Partial<Result> = {};
    try {
      const res = parseFiddleBisectOutput(out);
      if (res.success) {
        result.status = 'success';
        result.version_range = [res.goodVersion, res.badVersion];
      } else {
        // TODO(clavin): ^ better wording
        result.error = `Failed to narrow test down to two versions: ${error}`;
        result.status = code === 1 ? 'test_error' : 'system_error';
      }
    } catch (parseErr: unknown) {
      d('fiddle bisect parse error: %O', parseErr);
      result.status = 'system_error';
      result.error = parseErr.toString();
    }
    return result;
  }

  private async runTest(task: Task) {
    const { job } = task;
    assertTestJob(job);
    const { code, error } = await this.runFiddle(task, [
      ...this.fiddleArgv,
      JobType.test,
      ...['--version', job.version],
      ...['--fiddle', job.gist],
      '--log-config',
    ]);

    const result: Partial<Result> = {};
    if (error) {
      result.status = 'system_error';
      result.error = `Unable to run Electron Fiddle. ${error}`;
    } else if (code === 0) {
      result.status = 'success';
    } else if (code === 1) {
      result.status = 'failure';
      result.error = 'The test ran and failed.';
    } else {
      result.status = 'test_error';
      result.error = 'Electron Fiddle was unable to complete the test.';
    }
    return result;
  }

  private async runFiddle(
    task: Task,
    args: string[],
  ): Promise<{ code?: number; error?: string; out: string }> {
    return new Promise((resolve) => {
      const d = debug(`${this.debugPrefix}:runFiddle`);
      const ret = { code: null, out: '', error: null };

      const { childTimeoutMs, fiddleExec } = this;
      const opts = { timeout: childTimeoutMs };

      const prefix = `[${new Date().toLocaleTimeString()}] Runner:`;
      const startupLog = [
        `${prefix} runner id '${this.uuid}' (platform: '${this.platform}')`,
        `${prefix} spawning '${fiddleExec}' ${args.join(' ')}`,
        `${prefix}   ... with opts ${inspect(opts)}`,
      ] as const;
      task.addLogData(startupLog.join('\n'));

      d(`${fiddleExec} ${args.join(' ')}`);
      d('opts: %o', opts);
      const child = spawn(fiddleExec, args, opts);

      // Save stdout locally so we can parse the result.
      // Report both stdout + stderr to the broker via addLogData().
      const stdout: string[] = [];
      const onData = (dat: string | Buffer) => task.addLogData(dat.toString());
      const onStdout = (dat: string | Buffer) => stdout.push(dat.toString());
      child.stderr.on('data', onData);
      child.stdout.on('data', onData);
      child.stdout.on('data', onStdout);

      child.on('error', (err) => (ret.error = err.toString()));

      child.on('close', (code) => {
        d('got exit code from child process close event', code);
        const out = stdout.join('');
        const match = /Electron Fiddle is exiting with code (\d+)/.exec(out);
        if (match) {
          code = Number.parseInt(match[1]);
          d(`got exit code "${code}" from log message "${match[0]}"`);
        }
        ret.code = code;
        ret.out = out;
        d('resolve %O', ret);
        resolve(ret);
      });
    });
  }
}
