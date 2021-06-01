import debug from 'debug';
import got from 'got';
import which from 'which';
import { inspect } from 'util';
import { URL } from 'url';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { Operation as PatchOp } from 'fast-json-patch';

import {
  AnyJob,
  BisectRange,
  Current,
  JobId,
  Platform,
  Result,
  RunnerId,
} from '@electron/bugbot-shared/lib/interfaces';

import { parseFiddleBisectOutput } from './fiddle-bisect-parser';

const d = debug('runner');

export class Runner {
  public readonly platform: Platform;
  public readonly uuid: RunnerId;

  private readonly brokerUrl: string;
  private readonly childTimeoutMs: number;
  private readonly fiddleExecPath: string;
  private readonly pollTimeoutMs: number;
  private etag: string;
  private interval: ReturnType<typeof setInterval>;
  private jobId: JobId;
  private timeBegun: number;

  /**
   * Creates and initializes the runner from environment variables and default
   * values, then starts the runner's execution loop.
   */
  constructor(opts: Record<string, any> = {}) {
    const fiddleExec = 'electron-fiddle' as const;
    const {
      brokerUrl = process.env.BUGBOT_BROKER_URL,
      childTimeoutMs = 5 * 60 * 1000, // 5 minutes
      fiddleExecPath = process.env.FIDDLE_EXEC_PATH || which.sync(fiddleExec),
      platform = process.platform,
      pollTimeoutMs = process.env.BUGBOT_POLL_INTERVAL_MS || 20 * 1000, // 20 seconds
      uuid = uuidv4(),
    } = opts;
    Object.assign(this, {
      brokerUrl,
      childTimeoutMs,
      fiddleExecPath,
      platform,
      pollTimeoutMs,
      uuid,
    });

    for (const name of ['brokerUrl', 'fiddleExecPath']) {
      if (!this[name]) throw new Error(`missing option: 'Runner.${name}'`);
    }
  }

  public start(): void {
    this.stop();
    d('runner:start', `interval is ${this.pollTimeoutMs}`);
    this.interval = setInterval(this.pollSafely.bind(this), this.pollTimeoutMs);
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
    return await got(jobs_url).json();
  }

  private async fetchJobAndEtag(id: string): Promise<[AnyJob, string]> {
    const job_url = new URL(`api/jobs/${id}`, this.brokerUrl);
    const resp = await got(job_url);

    // Extract the etag header & make sure it was defined
    const { etag } = resp.headers;
    if (!etag) {
      throw new Error('missing etag in broker job response');
    }

    return [JSON.parse(resp.body), etag];
  }

  private async patchJob(patches: Readonly<PatchOp>[]): Promise<void> {
    d('patches: %O', patches);

    // Send the patch
    const job_url = new URL(`api/jobs/${this.jobId}`, this.brokerUrl);
    const resp = await got(job_url, {
      headers: { etag: this.etag },
      json: patches,
      method: 'PATCH',
    });

    // Extract the etag header & make sure it was defined
    const { etag } = resp.headers;
    if (!etag) {
      throw new Error('missing etag in broker job response');
    }

    this.etag = etag;
  }

  private async putLog(data: any) {
    const body = data.toString();
    d('appendLog', body);
    const log_url = new URL(`api/jobs/${this.jobId}/log`, this.brokerUrl);
    const resp = await got(log_url, {
      body,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
      method: 'PUT',
    });
    d(`appendLog resp.status ${resp.statusCode}`);
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
    const putLog = this.putLog.bind(this);
    const patchResult = this.patchResult.bind(this);
    const { childTimeoutMs, fiddleExecPath } = this;

    return new Promise<void>((resolve) => {
      const args = ['bisect', range[0], range[1], '--fiddle', gistId];
      const opts = { timeout: childTimeoutMs };
      const child = spawn(fiddleExecPath, args, opts);

      const prefix = `[${new Date().toLocaleTimeString()}] Runner:`;
      putLog(
        [
          `${prefix} runner id '${this.uuid}' (platform: '${this.platform}')`,
          `${prefix} spawning '${fiddleExecPath}' ${args.join(' ')}`,
          `${prefix}   ... with opts ${inspect(opts)}`,
        ].join('\n')
      );

      // TODO(any): could debounce/buffer this data before calling putLog()
      const stdout: any[] = [];
      child.stderr.on('data', (data) => putLog(data));
      child.stdout.on('data', (data) => putLog(data));
      child.stdout.on('data', (data) => stdout.push(data));
      child.on('error', (err) => {
        patchResult({
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
        } catch (parseErr) {
          d('fiddle bisect parse error: %O', parseErr);
          result.status = 'system_error';
          result.error = parseErr.toString();
        } finally {
          patchResult(result).then(() => resolve());
        }
      });
    });
  }
}
