import fetch, { Response } from 'node-fetch';
import { FiddleBisectResult } from '@electron/bugbot-runner/dist/fiddle-bisect-parser';
import { URL } from 'url';
import { FiddleInput } from '@electron/bugbot-shared/lib/issue-parser';

/**
 * This is the base URL where the bot interacts with the broker API
 * This is read from the environment variable named `API_BASE_URL`.
 */
const { API_BASE_URL } = process.env;

if (!API_BASE_URL) {
  // Just to make it more visible
  console.error('[!!!] WARNING: `API_BASE_URL` env variable is not set!');
}

export class APIError extends Error {
  public res: Response;

  constructor(res: Response, message: string) {
    super(message);
    this.res = res;
  }
}

/**
 * Makes a request to the runner to bisect a fiddle.
 */
export async function bisectFiddle(
  fiddle: FiddleInput,
): Promise<FiddleBisectResult | null> {
  // Determine the url to send the request to

  if (!API_BASE_URL) {
    return null;
  }

  const url = new URL('fiddle/bisect', API_BASE_URL);

  return await fetch(url.toString(), {
    body: JSON.stringify(fiddle),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  })
    .then((res) => {
      // Ensure that we got a successful response
      if (!res.ok) {
        throw new APIError(res, 'failed to bisect fiddle');
      }

      return res;
    })
    .then((res) => res.json());
}

/**
 * Checks if the runner already has a test running for this issue
 * @returns If the current issue already has a test running
 */
export function hasRunningTest(issue: string): boolean {
  console.log('hasRunningTest', { issue });
  return false;
}

export function stopTest(issue: string): void {
  console.log('stopTest', { issue });
}

export function startTest(): void {
  console.log('startTest');
}

export function getCompleteJob(issue: string): any {
  console.log('getCompleteJob', { issue });
  return {};
}

export function markAsComplete(): void {
  console.log('markAsComplete');
}
