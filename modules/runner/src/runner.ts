import debug from 'debug';
import got from 'got';
import which from 'which';
import { URL } from 'url';
import { execFile } from 'child_process';
import { v4 as uuidv4 } from 'uuid';

import { Result } from '@electron/bugbot-shared/lib/interfaces';

import {
  FiddleBisectResult,
  parseFiddleBisectOutput,
} from './fiddle-bisect-parser';

const d = debug('runner');

interface BaseJob {
  bot_client_data?: string;
  gist: string;
  id: string;
  platform?: 'darwin' | 'linux' | 'win32';
  time_added: number;
}

interface BisectJob extends BaseJob {
  type: 'bisect';
  bisect_range: [string, string];
}

interface TestJob extends BaseJob {
  type: 'test';
  version: string;
}

type AnyJob = BisectJob | TestJob;

type JsonPatch = unknown;

/**
 * Returns a promise that resolves after the specified timeout.
 */
function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(), ms);
  });
}

export class Runner {
  public readonly platform: string;
  public readonly uuid: string;

  private readonly fiddleExecPath: string;
  private readonly brokerUrl: string;
  private readonly pollTimeoutMs: number;
  private time_begun: number;
  private interval: ReturnType<typeof setInterval>;

  /**
   * Creates and initializes the runner from environment variables and default
   * values, then starts the runner's execution loop.
   */
  constructor(opts: Record<string, any> = {}) {
    const fiddleExec = 'electron-fiddle' as const;
    const {
      bisectTimeoutMs = 5 * 60 * 1000, // 5 minutes
      brokerUrl = process.env.BUGBOT_BROKER_URL,
      fiddleExecPath = process.env.FIDDLE_EXEC_PATH || which.sync(fiddleExec),
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

  public pollSafely(): void {
    this.poll().catch((err) => d('error while polling broker: %O', err));
  }

  public async poll(): Promise<void> {
    // Check for any claimable jobs
    const claimableJobs = await this.fetchUnclaimedJobs();

    // If there are no unclaimed jobs then sleep and try again
    if (claimableJobs.length === 0) {
      return;
    }

    // Otherwise, claim the first job available
    const [jobId] = claimableJobs;
    // TODO(clavin): would adding jitter (e.g. claim first OR second randomly)
    // help reduce any possible contention?
    let etag = '';
    const [job, initalEtag] = await this.fetchJobAndEtag(jobId);
    etag = initalEtag;

    // Claim the job
    this.time_begun = Date.now();
    const current = {
      runner: this.uuid,
      time_begun: this.time_begun,
    };
    etag = await this.patchJobAndUpdateEtag(job.id, etag, [
      {
        op: 'replace',
        path: '/current',
        value: current,
      },
    ]);

    // Another layer of catching errors to also unclaim the job if we error
    try {
      // Then determine how to run the job and return results
      if (job.type === 'bisect') {
        // Run the bisect
        const res = await this.runBisect(job.bisect_range, job.gist);

        // Report the result back to the job
        const result: Result = {
          runner: this.uuid,
          status: 'success',
          time_begun: this.time_begun,
          time_ended: Date.now(),
        };

        if (res.success) {
          result.bisect_range = [res.goodVersion, res.badVersion];
        } else {
          // TODO: distinguish between system_error (need maintainer attn)
          // and test_error (implies user should revise test code).
          // Examples:
          // - child_process timeout: test_error
          // - invalid gist id: test_error
          // - failure to launch electron-fiddle: system error
          result.status = 'system_error';
          // TODO(clavin): ^ better wording
          result.error = 'Failed to narrow test down to two versions';
        }

        etag = await this.patchJobAndUpdateEtag(job.id, etag, [
          {
            op: 'add',
            path: '/history/-',
            value: result,
          },
          {
            op: 'replace',
            path: '/last',
            value: result,
          },
          {
            op: 'remove',
            path: '/current',
          },
        ]);

        // } else if (job.type === 'test') {
        // TODO
      } else {
        throw new Error(`unexpected job type: "${(job as AnyJob).type}"`);
      }
    } catch (err) {
      // Unclaim the job and rethrow
      // FIXME: should append to history here and set
      // system_error or test_error based on err type
      await this.patchJobAndUpdateEtag(job.id, etag, [
        {
          op: 'remove',
          path: '/current',
          value: Date.now(),
        },
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
    // find jobs compatible with this runner...
    jobs_url.searchParams.append('platform', `${this.platform},undefined`);
    // ...is not currently claimed
    jobs_url.searchParams.append('current.runner', 'undefined');
    // ...and which have never been run
    jobs_url.searchParams.append('last.status', 'undefined');

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
    range: string[],
    gistId: string,
  ): Promise<FiddleBisectResult> {
    const [goodVersion, badVersion] = range;
    // Call fiddle and instruct it to bisect with the supplied parameters
    return new Promise((resolve, reject) => {
      execFile(
        this.fiddleExecPath,
        ['bisect', goodVersion, badVersion, '--fiddle', gistId] as string[],
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
