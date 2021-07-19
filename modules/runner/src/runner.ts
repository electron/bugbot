import debug from 'debug';
import fetch from 'node-fetch';
import stringArgv from 'string-argv';
import which from 'which';
import { Operation as PatchOp } from 'fast-json-patch';
import { URL } from 'url';
import { inspect } from 'util';
import { randomInt } from 'crypto';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';

import {
  Current,
  Job,
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

class Task {
  private logTimer: ReturnType<typeof setTimeout>;
  private readonly logBuffer: string[] = [];
  public readonly timeBegun = Date.now();
  private readonly debugPrefix: string;

  constructor(
    public readonly job: Job,
    public etag: string,
    public runner: string,
    private readonly authToken: string,
    private readonly brokerUrl: string,
    private readonly logIntervalMs: number,
  ) {
    this.debugPrefix = `runner:${this.runner}`;
  }

  private async sendLogDataBuffer(url: URL) {
    const d = debug(`${this.debugPrefix}:sendLogDataBuffer`);
    delete this.logTimer;

    const lines = this.logBuffer.splice(0);
    const body = lines.join('\n');
    d(`sending ${lines.length} lines`, body);
    const resp = await fetch(url, {
      body,
      headers: {
        Authorization: `Bearer ${this.authToken}`,
        'Content-Type': 'text/plain; charset=utf-8',
      },
      method: 'PUT',
    });
    d(`resp.status ${resp.status}`);
  }

  public addLogData(data: string) {
    // save the URL to safeguard against this.jobId being cleared at end-of-job
    const log_url = new URL(`api/jobs/${this.job.id}/log`, this.brokerUrl);
    this.logBuffer.push(data);
    if (!this.logTimer) {
      this.logTimer = setTimeout(
        () => void this.sendLogDataBuffer(log_url),
        this.logIntervalMs,
      );
    }
  }

  /**
   * @returns {boolean} success / failure (response.ok)
   */
  private async sendPatch(patches: Readonly<PatchOp>[]): Promise<boolean> {
    const d = debug(`${this.debugPrefix}:sendPatch`);
    d('task: %O', this);
    d('patches: %O', patches);

    // Send the patch
    const job_url = new URL(`api/jobs/${this.job.id}`, this.brokerUrl);
    const response = await fetch(job_url, {
      body: JSON.stringify(patches),
      headers: {
        Authorization: `Bearer ${this.authToken}`,
        'Content-Type': 'application/json',
        ETag: this.etag,
      },
      method: 'PATCH',
    });
    d('broker response:', response.status, response.statusText);
    const { headers, ok } = response;

    // if we got an etag, keep it
    if (ok && headers.has('etag')) this.etag = headers.get('etag');

    return ok;
  }

  /**
   * @returns {boolean} success / failure (response.ok)
   */
  public sendResult(resultIn: Partial<Result>): Promise<boolean> {
    const result: Partial<Result> = {
      runner: this.runner,
      status: 'system_error',
      time_begun: this.timeBegun,
      time_ended: Date.now(),
      ...resultIn,
    };
    return this.sendPatch([
      { op: 'add', path: '/history/-', value: result },
      { op: 'replace', path: '/last', value: result },
      { op: 'remove', path: '/current' },
    ]);
  }

  /**
   * @returns {boolean} success / failure (response.ok)
   */
  public claimForRunner(): Promise<boolean> {
    const current: Current = {
      runner: this.runner,
      time_begun: this.timeBegun,
    };
    return this.sendPatch([
      { op: 'replace', path: '/current', value: current },
    ]);
  }
}

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

  public pollOnce = async () => {
    const d = debug(`${this.debugPrefix}:pollOnce`);

    // find a job and claim it.
    let jobId: JobId;
    let task: Task;
    const ids = await this.fetchAvailableJobIds();
    d('available jobs: %o', ids);
    while (!jobId && ids.length > 0) {
      // pick one at random
      const idx = randomInt(0, ids.length);
      const [id] = ids.splice(idx, 1);

      // try to claim it
      d('claiming job %s, jobs remaining %o', id, ids);
      task = await this.fetchTask(id); // get the etag
      if (await task.claimForRunner()) jobId = id;
    }
    d('jobId %s task %o', jobId, task);
    if (!jobId) return;

    // run the job
    d(jobId, 'running job');
    let result: Partial<Result>;
    switch (task.job.type) {
      case JobType.bisect:
        result = await this.runBisect(task);
        break;

      case JobType.test:
        result = await this.runTest(task);
        break;
    }

    d(jobId, 'sending result');
    await task.sendResult(result);
    d('done');
  };

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
    d('job %O', job);
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

      d('exec: %s', fiddleExec);
      d('args: %o', args);
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
        ret.code = code;
        ret.out = stdout.join('');
        d('resolve %O', ret);
        resolve(ret);
      });
    });
  }
}
