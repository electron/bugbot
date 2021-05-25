import { execFile } from 'child_process';
import debug from 'debug';
import got from 'got';
import { URL } from 'url';
import { v4 as uuidv4 } from 'uuid';
import {
  FiddleBisectResult,
  parseFiddleBisectOutput,
} from './fiddle-bisect-parser';
import { env } from '@electron/bugbot-shared/lib/env-vars';

const d = debug('runner');

/* eslint-disable no-use-before-define */
// ^ I think the file reads a little better in the same order as execution; the
//   execution is simply broken into separate functions.

type IncomingJob = {
  id: string;
  os: string;
  gist: string;
  runner?: string;
} & (
  | {
      type: 'bisect';
      first: string;
      last: string;
    }
  | {
      type: 'test';
      version: string;
    }
);

interface RunnerContext {
  uuid: string;
  fiddleExecPath: string;
  brokerUrl: string;
  osFilter: string;
  pollTimeoutMs: number;
}

async function pollingBroker(ctx: RunnerContext): Promise<never> {
  // Catch and log errors when polling the broker
  try {
    // Craft the url to the broker
    const jobs_url = new URL('api/jobs', ctx.brokerUrl);
    jobs_url.searchParams.append('os', ctx.fiddleExecPath);

    // Make the request
    const jobs: IncomingJob[] = await got(jobs_url).json();

    // Transition to the Recieved Jobs state
    return receivedJobs(ctx, jobs);
  } catch (err) {
    d('error while polling broker: %O', err);

    // Transition to the Timeout state on errors for resilience
    // TODO(clavin): capped exponential backoff + jitter?
    return timeout(ctx);
  }
}

function timeout(ctx: RunnerContext): Promise<never> {
  // We need to wrap `setTimeout` in a Promise
  return new Promise((resolve) => {
    setTimeout(() => {
      // Resolve by transitioning to the Polling Broker state
      resolve(pollingBroker(ctx));
    }, ctx.pollTimeoutMs);
  });
}

function receivedJobs(ctx: RunnerContext, jobs: IncomingJob[]): Promise<never> {
  // Filter out claimed jobs
  const unclaimedJobs = jobs.filter((job) => !('runner' in job));

  // Check if there were any unclaimed jobs
  if (unclaimedJobs.length === 0) {
    // Transition to the Timeout state
    return timeout(ctx);
  }

  // Claim the first job
  // TODO(clavin): would adding some jitter (like "randomly claim first or second job") help reduce
  // possible contention?
  return claimingJob(ctx, unclaimedJobs[0]);
}

async function claimingJob(
  ctx: RunnerContext,
  job: IncomingJob,
): Promise<never> {
  // Catch and log errors when claiming the job
  try {
    // Tell the broker we claim this job
    const claim_url = new URL(`api/jobs/${job.id}`, ctx.brokerUrl);
    await got(claim_url, {
      json: [
        {
          op: 'add',
          path: '/runner',
          value: ctx.uuid,
        },
        {
          op: 'add',
          path: '/time_started',
          value: Date.now() / 1000,
        },
      ],
      method: 'PATCH',
    });

    // If we got here then assume the claim was successful
    return executingJob(ctx, job);
  } catch (err) {
    d('error while claiming job: %O', err);

    // Transition to the Timeout state for resilience
    return timeout(ctx);
  }
}

function executingJob(ctx: RunnerContext, job: IncomingJob): Promise<never> {
  // Route to the proper execution state
  if (job.type === 'bisect') {
    return executingBisect(ctx, job);
  }
  // } else if (job.type === 'test') {
  //   return executingTest(ctx, job);
  // }

  // TODO(clavin): resilience
  throw new Error(
    `encountered unknown job type "${(job as IncomingJob).type}"`,
  );
}

function executingBisect(
  ctx: RunnerContext,
  job: IncomingJob & { type: 'bisect' },
): Promise<never> {
  // Alias some of the job arguments
  const goodVersion = job.first;
  const badVersion = job.last;
  const gistId = job.gist;

  // Call fiddle and instruct it to bisect with the supplied parameters
  return new Promise((resolve, reject) => {
    execFile(
      ctx.fiddleExecPath,
      ['bisect', goodVersion, badVersion, '--fiddle', gistId] as string[],
      (err, stdout, stderr) => {
        // Ensure there was no error
        if (err === null) {
          try {
            // Try to parse the output as well
            const result = parseFiddleBisectOutput(stdout);

            // Transition to the Bisect Finished state if it worked
            resolve(bisectFinished(ctx, job, result));
          } catch (parseErr) {
            // TODO(clavin): resilience
            reject(parseErr);
          }
        } else {
          // TODO(clavin): resilience
          d(`failed fiddle stdout:\n${stdout}`);
          d(`failed fiddle stderr:\n${stderr}`);
          reject(err);
        }
      },
    );
  });
}

async function bisectFinished(
  ctx: RunnerContext,
  job: IncomingJob & { type: 'bisect' },
  result: FiddleBisectResult,
): Promise<never> {
  // Notify the broker of our result
  const update_url = new URL(`api/jobs/${job.id}`, ctx.brokerUrl);
  await got(update_url, {
    json: [
      {
        op: 'remove',
        path: '/runner',
      },
      {
        op: 'add',
        path: '/time_finished',
        value: Date.now() / 1000,
      },
      {
        op: 'add',
        path: '/result_bisect',
        value: result.success ? [result.goodVersion, result.badVersion] : [],
      },
    ],
    method: 'PATCH',
  });

  // If we got this far that means the update was successful

  // Transition to the Timeout state
  return timeout(ctx);
}

// async function executingTest(ctx: RunnerContext, job: IncomingJob & { type: 'test' }): Promise<never> {
//   //
// }

// async function testFinished(ctx: RunnerContext, job: IncomingJob & { type: 'test' }): Promise<never> {
//   // TODO
// }

function runner(): Promise<never> {
  // Determine the OS filter from the current running platform
  let osFilter = '';
  switch (process.platform) {
    case 'darwin':
      osFilter = 'mac';
      break;
    case 'linux':
      osFilter = 'linux';
      break;
    case 'win32':
      osFilter = 'windows';
      break;
    default:
      d('Cannot detect the current operating system, exiting.');
      return;
  }

  // Create the runner context
  const ctx: RunnerContext = {
    brokerUrl: env('BUGBOT_BROKER_URL'),
    fiddleExecPath: env('FIDDLE_EXEC_PATH'),
    osFilter,
    pollTimeoutMs: 20 * 1000, // 20 seconds
    uuid: uuidv4(),
  };

  // Begin the machine in the Polling Broker state
  pollingBroker(ctx);
}

// Run the runner as an asynchronous loop, handling any errors that arise
runner().catch((err) => {
  d('encountered an error: %O', err);
  process.exit(1);
});
