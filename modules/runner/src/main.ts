import { execFile } from 'child_process';
import debug from 'debug';
import got from 'got';
import { URL } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { env } from '@electron/bugbot-shared/lib/env-vars';
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
  time_started?: number;
  time_finished?: number;
}

interface BisectJob extends BaseJob {
  type: 'bisect';
  range: string[],
  result_bisect?: [string, string];
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

class Runner {
  private readonly uuid: string;
  private readonly fiddleExecPath: string;
  private readonly brokerUrl: string;
  private readonly platform: string;
  private readonly pollTimeoutMs: number;

  /**
   * Creates and initializes the runner from environment variables and default
   * values, then starts the runner's execution loop.
   */
  static start(): Promise<never> {
    // Determine the OS filter from the current running platform
    const { platform } = process;
    if (!['darwin', 'linux', 'win32'].includes(platform)) {
      d(`Unsupported platform '${platform}'; exiting.`);
      return null;
    }

    // Create the runner
    const runner: Runner = Object.create(Runner.prototype, {
      brokerUrl: {
        value: env('BUGBOT_BROKER_URL'),
      },
      fiddleExecPath: {
        value: env('FIDDLE_EXEC_PATH'),
      },
      platform: {
        value: platform,
      },
      pollTimeoutMs: {
        value: 20 * 1000, // 20 seconds
      },
      uuid: {
        value: uuidv4(),
      },
    });

    // Begin running the poll loop
    return runner.pollLoop();
  }

  async pollLoop(): Promise<never> {
    // Wrap the loop in a try-catch to log errors and make the runner resilient
    try {
      // Check for any claimable jobs
      const claimableJobs = await this.fetchUnclaimedJobs();

      // If there are no unclaimed jobs then sleep and try again
      if (claimableJobs.length === 0) {
        await timeout(this.pollTimeoutMs);
        return this.pollLoop();
      }

      // Otherwise, claim the first job available
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
          const result = await this.runBisect(job.range, job.gist);

          // Report the result back to the job
          if (result.success) {
            etag = await this.patchJobAndUpdateEtag(job.id, etag, [
              {
                op: 'add',
                path: '/time_finished',
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
                path: '/time_finished',
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
          {
            op: 'remove',
            path: '/runner',
            value: this.uuid,
          },
          {
            op: 'remove',
            path: '/time_started',
            value: Date.now(),
          },
        ]);
        throw err;
      }
    } catch (err) {
      d('error while polling broker: %O', err);
    }

    // Sleep and then try again
    await timeout(this.pollTimeoutMs);
    return this.pollLoop();
  }

  /**
   * Polls the broker for a list of unclaimed job IDs.
   */
  private async fetchUnclaimedJobs(): Promise<string[]> {
    // Craft the url to the broker
    const jobs_url = new URL('api/jobs', this.brokerUrl);
    jobs_url.searchParams.append('os', this.platform);
    jobs_url.searchParams.append('runner', 'undefined');

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

// Start the runner and catch any errors that bubble up
Runner.start().catch((err) => {
  d('encountered an error: %O', err);
  console.error('execution stopped due to a critical error');
  process.exit(1);
});
