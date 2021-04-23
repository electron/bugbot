import fetch, { Response } from 'node-fetch';
import { FiddleBisectResult } from 'src/server/fiddle-bisect-parser';
import { URL } from 'url';
import { FiddleInput } from '../util/issue-parser';

/**
 * This is the base URL where the runner is hosted. The API will then ping the /fiddle/bisect path.
 * This is read from the environment variable named `FIDDLE_RUNNER_BASE_URL`.
 */
const { FIDDLE_RUNNER_BASE_URL } = process.env;
if (!FIDDLE_RUNNER_BASE_URL) {
  // Just to make it more visible
  console.error('[!!!] WARNING: `FIDDLE_RUNNER_BASE_URL` env variable is not set!');
}

export class RunnerError extends Error {
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
): Promise<FiddleBisectResult> {
  // Determine the url to send the request to
  const url = new URL('fiddle/bisect', FIDDLE_RUNNER_BASE_URL);

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
        throw new RunnerError(res, 'failed to bisect fiddle');
      }

      return res;
    })
    .then((res) => res.json());
}
