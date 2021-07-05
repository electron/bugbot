import debug from 'debug';
import fetch from 'node-fetch';
import stringArgv from 'string-argv';
import which from 'which';
import { Operation as PatchOp } from 'fast-json-patch';
import { URL } from 'url';
import { inspect } from 'util';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';

import {
  AnyJob,
  BisectRange,
  Current,
  JobId,
  Platform,
  Result,
  RunnerId,
} from '@electron/bugbot-shared/build/interfaces';
import { env, envInt } from '@electron/bugbot-shared/build/env-vars';

import { parseFiddleBisectOutput } from './fiddle-bisect-parser';

const d = debug('runner');

export class Runner {
  public readonly platform: Platform;
  public readonly uuid: RunnerId;

  private readonly authToken: string;
  private readonly brokerUrl: string;
  private readonly childTimeoutMs: number;
  private readonly fiddleExec: string;
  private readonly fiddleArgv: string[];
  private readonly pollIntervalMs: number;
  private readonly logIntervalMs: number;
  private logBuffer: string[] = [];
  private logTimer: ReturnType<typeof setTimeout>;
  private etag: string;
  private interval: ReturnType<typeof setInterval>;
  private jobId: JobId;
  private timeBegun: number;

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
    this.pollIntervalMs =
      opts.pollIntervalMs || envInt('BUGBOT_POLL_INTERVAL_MS', 20_000);
    this.uuid = opts.uuid || uuidv4();
  }

  public start(): void {
    this.stop();
    d('runner:start', `interval is ${this.pollIntervalMs}`);
    this.interval = setInterval(() => this.pollSafely(), this.pollIntervalMs);
    this.pollSafely();
  }

  public stop(): void {
    clearInterval(this.interval);
    this.interval = undefined;
    d('runner:stop', 'interval cleared');
  }

  public pollSafely(): void {
    this.poll().catch((err) => d('error while polling broker:', inspect(err)));
  }

  public async poll(): Promise<void> {
    // find the first available job
    const jobId = (await this.fetchAvailableJobs()).shift();
    if (!jobId) {
      return;
    }

    // TODO(clavin): would adding jitter (e.g. claim first OR second randomly)
    // help reduce any possible contention?
    const [job, initialEtag] = await this.fetchJobAndEtag(jobId);
    this.etag = initialEtag;
    this.jobId = job.id;
    this.timeBegun = Date.now();

    // Claim the job
    const current: Current = {
      runner: this.uuid,
      time_begun: this.timeBegun,
    };
    await this.patchJob([{ op: 'replace', path: '/current', value: current }]);

    switch (job.type) {
      case 'bisect':
        await this.runBisect(job.bisect_range, job.gist);
        break;
      default:
        d('unexpected job $O', job);
        break;
    }

    // cleanup
    delete this.etag;
    delete this.jobId;
    delete this.timeBegun;
    d('runner:poll done');
  }

  /**
   * Polls the broker for a list of unclaimed job IDs.
   */
  private async fetchAvailableJobs(): Promise<JobId[]> {
    // Craft the url to the broker
    const jobs_url = new URL('api/jobs', this.brokerUrl);
    // find jobs compatible with this runner...
    jobs_url.searchParams.append('platform', `${this.platform},undefined`);
    // ...is not currently claimed
    jobs_url.searchParams.append('current.runner', 'undefined');
    // ...and which have never been run
    jobs_url.searchParams.append('last.status', 'undefined');
    // FIXME: currently only support bisect but we should support others too
    jobs_url.searchParams.append('type', 'bisect');

    // Make the request and return its response
    return await fetch(jobs_url, {
      headers: {
        Authorization: `Bearer ${this.authToken}`,
      },
    }).then((res) => res.json());
  }

  private async fetchJobAndEtag(id: string): Promise<[AnyJob, string]> {
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

    const body = await resp.text();
    return [JSON.parse(body), etag];
  }

  private async patchJob(patches: Readonly<PatchOp>[]): Promise<void> {
    d('patches: %O', patches);

    // Send the patch
    const job_url = new URL(`api/jobs/${this.jobId}`, this.brokerUrl);
    const resp = await fetch(job_url, {
      body: JSON.stringify(patches),
      headers: {
        Authorization: `Bearer ${this.authToken}`,
        'Content-Type': 'application/json',
        ETag: this.etag,
      },
      method: 'PATCH',
    });

    // Extract the etag header & make sure it was defined
    const etag = resp.headers.get('etag');
    if (!etag) {
      throw new Error('missing etag in broker job response');
    }

    this.etag = etag;
  }

  private async sendLogDataBuffer(url: URL) {
    delete this.logTimer;

    const lines = this.logBuffer.splice(0);
    const body = lines.join('\n');
    d(`sendLogDataBuffer sending ${lines.length} lines`, body);
    const resp = await fetch(url, {
      body,
      headers: {
        Authorization: `Bearer ${this.authToken}`,
        'Content-Type': 'text/plain; charset=utf-8',
      },
      method: 'PUT',
    });
    d(`sendLogDataBuffer resp.status ${resp.status}`);
  }

  private addLogData(data: string) {
    // save the URL to safeguard against this.jobId being cleared at end-of-job
    const log_url = new URL(`api/jobs/${this.jobId}/log`, this.brokerUrl);
    this.logBuffer.push(data);
    if (!this.logTimer) {
      this.logTimer = setTimeout(
        () => this.sendLogDataBuffer(log_url),
        this.logIntervalMs,
      );
    }
  }

  private patchResult(result: Partial<Result>): Promise<void> {
    const defaults: Result = {
      runner: this.uuid,
      status: 'system_error',
      time_begun: this.timeBegun,
      time_ended: Date.now(),
    };
    result = Object.assign(defaults, result);
    return this.patchJob([
      { op: 'add', path: '/history/-', value: result },
      { op: 'replace', path: '/last', value: result },
      { op: 'remove', path: '/current' },
    ]);
  }

  private runBisect(range: BisectRange, gistId: string): Promise<void> {
    const { childTimeoutMs, fiddleExec, fiddleArgv } = this;

    return new Promise<void>((resolve) => {
      const args = [
        ...fiddleArgv,
        'bisect',
        range[0],
        range[1],
        '--fiddle',
        gistId,
      ];
      const opts = { timeout: childTimeoutMs };
      const child = spawn(fiddleExec, args, opts);

      const prefix = `[${new Date().toLocaleTimeString()}] Runner:`;
      this.addLogData(
        [
          `${prefix} runner id '${this.uuid}' (platform: '${this.platform}')`,
          `${prefix} spawning '${fiddleExec}' ${args.join(' ')}`,
          `${prefix}   ... with opts ${inspect(opts)}`,
        ].join('\n'),
      );

      // Save stdout locally so we can parse the result.
      // Report both stdout + stderr to the broker via addLogData().
      const stdout: string[] = [];
      const onData = (dat: string | Buffer) => this.addLogData(dat.toString());
      const onStdout = (dat: string | Buffer) => stdout.push(dat.toString());
      child.stderr.on('data', onData);
      child.stdout.on('data', onData);
      child.stdout.on('data', onStdout);

      child.on('error', (err) => {
        void this.patchResult({
          error: err.toString(),
          status: 'system_error',
        });
      });
      child.on('close', (exitCode) => {
        const result: Partial<Result> = {};
        try {
          const output = stdout.map((buf) => buf.toString()).join('');
          const res = parseFiddleBisectOutput(output);
          if (res.success) {
            result.status = 'success';
            result.bisect_range = [res.goodVersion, res.badVersion];
          } else {
            // TODO(clavin): ^ better wording
            result.error = 'Failed to narrow test down to two versions';
            result.status = exitCode === 1 ? 'test_error' : 'system_error';
          }
        } catch (parseErr: unknown) {
          d('fiddle bisect parse error: %O', parseErr);
          result.status = 'system_error';
          result.error = parseErr.toString();
        } finally {
          void this.patchResult(result).then(() => resolve());
        }
      });
    });
  }
}
