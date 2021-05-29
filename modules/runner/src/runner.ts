import debug from 'debug';
import got from 'got';
import which from 'which';
import { URL } from 'url';
import { execFile } from 'child_process';
import { v4 as uuidv4 } from 'uuid';

import {
  FiddleBisectResult,
  parseFiddleBisectOutput,
} from './fiddle-bisect-parser';

const d = debug('runner');

interface BaseJob {
  client_data?: string;
  gist: string;
  id: string;
  os?: 'darwin' | 'linux' | 'win32';
  error?: string;
  runner?: string;
  time_created: number;
  time_done?: number;
  time_started?: number;
}

interface BisectJob extends BaseJob {
  type: 'bisect';
  first: string;
  last: string;
  result_bisect?: [string, string];
}

interface TestJob extends BaseJob {
  type: 'test';
  version: string;
}

type AnyJob = BisectJob | TestJob;

type JsonPatch = unknown;

export class Runner {
  public readonly platform: string;
  public readonly uuid: string;

  private readonly bisectTimeoutMs: number;
  private readonly brokerUrl: string;
  private readonly fiddleExecPath: string;
  private readonly pollTimeoutMs: number;
  private interval: ReturnType<typeof setInterval> | undefined = undefined;

  /**
   * Creates and initializes the runner from environment variables and default
   * values, then starts the runner's execution loop.
   */
  constructor(opts: Record<string, any> = {}) {
    const {
      bisectTimeoutMs = 5 * 60 * 1000, // 5 minutes
      brokerUrl = process.env.BUGBOT_BROKER_URL,
      fiddleExecPath = process.env.FIDDLE_EXEC_PATH || which.sync('electron-fiddle'),
      platform = process.platform,
      pollTimeoutMs = 20 * 1000, // 20 seconds
      uuid = uuidv4(),
    } = opts;
    Object.assign(this, {
      bisectTimeoutMs,
      brokerUrl,
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
    this.interval = setInterval(this.pollSafely.bind(this), this.pollTimeoutMs);
  }

  public stop(): void {
    clearInterval(this.interval);
    this.interval = undefined;
  }

  private pollSafely(): void {
    this.poll().catch((err) => d('error while polling broker: %O', err));
  }

  public async poll(): Promise<void> {
    // Check for any claimable jobs
    const claimableJobs = await this.fetchUnclaimedJobs();
    if (claimableJobs.length === 0) {
      return;
    }

    // claim the first job available
    const [jobId] = claimableJobs;
    // TODO(clavin): would adding jitter (e.g. claim first OR second randomly)
    // help reduce any possible contention?
    let etag = '';
    const [job, initalEtag] = await this.fetchJobAndEtag(jobId);
    etag = initalEtag;

    // Claim the job
    etag = await this.patchJobAndUpdateEtag(job.id, etag, [
      {
        op: 'add',
        path: '/runner',
        value: this.uuid,
      },
      {
        op: 'add',
        path: '/time_started',
        value: Date.now(),
      },
    ]);

    // Another layer of catching errors to also unclaim the job if we error
    try {
      // Then determine how to run the job and return results
      if (job.type === 'bisect') {
        // Run the bisect
        const result = await this.runBisect(job.first, job.last, job.gist);

        // Report the result back to the job
        if (result.success) {
          etag = await this.patchJobAndUpdateEtag(job.id, etag, [
            {
              op: 'add',
              path: '/time_done',
              value: Date.now(),
            },
            {
              op: 'add',
              path: '/result_bisect',
              value: [result.goodVersion, result.badVersion],
            },
          ]);
        } else {
          etag = await this.patchJobAndUpdateEtag(job.id, etag, [
            {
              op: 'add',
              path: '/time_done',
              value: Date.now(),
            },
            {
              op: 'add',
              path: '/error',
              value: 'Failed to narrow test down to two versions',
              // TODO(clavin): ^ better wording
            },
          ]);
        }

        // } else if (job.type === 'test') {
        // TODO
      } else {
        throw new Error(`unexpected job type: "${(job as AnyJob).type}"`);
      }
    } catch (err) {
      // Unclaim the job and rethrow
      await this.patchJobAndUpdateEtag(job.id, etag, [
        { op: 'remove', path: '/runner' },
        { op: 'remove', path: '/time_started' },
        { op: 'replace', path: '/error', value: err.toString() },
      ]);
      throw err;
    }
  }

  /**
   * Polls the broker for a list of unclaimed job IDs.
   */
  private async fetchUnclaimedJobs(): Promise<string[]> {
    // Craft the url to the broker
    const jobs_url = new URL('api/jobs', this.brokerUrl);
    jobs_url.searchParams.append('platform', this.platform);
    jobs_url.searchParams.append('runner', 'undefined');
    jobs_url.searchParams.append('time_done', 'undefined');

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

  private async patchJobAndUpdateEtag(
    id: string,
    etag: string,
    patches: JsonPatch[],
  ): Promise<string> {
    // Send the patch
    const job_url = new URL(`api/jobs/${id}`, this.brokerUrl);
    const resp = await got(job_url, {
      headers: { etag },
      json: patches,
      method: 'PATCH',
    });

    // Extract the etag header & make sure it was defined
    const newEtag = resp.headers.etag;
    if (!newEtag) {
      throw new Error('missing etag in broker job response');
    }

    return newEtag;
  }

  private runBisect(
    goodVersion: string,
    badVersion: string,
    gistId: string,
  ): Promise<FiddleBisectResult> {
    // Call fiddle and instruct it to bisect with the supplied parameters
    return new Promise((resolve, reject) => {
      const args = [
        'bisect',
        goodVersion,
        badVersion,
        '--nightlies',
        '--betas',
        '--obsolete',
        '--fiddle',
        gistId,
      ] as const;

      d(`running [${this.fiddleExecPath} ${args.join(' ')}]`);
      execFile(
        this.fiddleExecPath,
        args,
        { timeout: this.bisectTimeoutMs },
        (err, stdout, stderr) => {
          // Ensure there was no error
          if (err === null) {
            try {
              // Try to parse the output as well
              resolve(parseFiddleBisectOutput(stdout));
            } catch (parseErr) {
              d('fiddle bisect parse error: %O', parseErr);
              reject(parseErr);
            }
          } else {
            d(`failed fiddle bisect stdout:\n${stdout}`);
            d(`failed fiddle bisect stderr:\n${stderr}`);
            reject(err);
          }
        },
      );
    });
  }
}
