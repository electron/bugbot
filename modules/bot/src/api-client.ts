import fetch, { Response } from 'node-fetch';
// import { FiddleBisectResult } from '@electron/bugbot-runner/dist/fiddle-bisect-parser';
import { URL } from 'url';
import { FiddleInput } from '@electron/bugbot-shared/lib/issue-parser';

export class APIError extends Error {
  public res: Response;

  constructor(res: Response, message: string) {
    super(message);
    this.res = res;
  }
}

export default class BrokerAPI {
  baseURL: string;

  constructor(props: { baseURL: string }) {
    this.baseURL = props.baseURL;
  }

  async queueBisectJob(fiddle: FiddleInput): Promise<string> {
    const url = new URL('/api/jobs', this.baseURL);

    const res = await fetch(url.toString(), {
      body: JSON.stringify({
        client_data: '',
        first: fiddle.goodVersion,
        gist: fiddle.gistId,
        last: fiddle.badVersion,
        type: 'bisect',
      }),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });

    return await res.text();
  }

  stopJob(jobId: string): void {
    const url = new URL(`/api/jobs/${jobId}`, this.baseURL);
    console.log('stopping job', { url });
  }

  async getJob(jobId: string): Promise<any> {
    const url = new URL(`/api/jobs/${jobId}`, this.baseURL);

    const res = await fetch(url.toString());
    const json = await res.json();
    return json;
  }

  async completeJob(jobId: string): Promise<any> {
    const url = new URL(`/api/jobs/${jobId}`, this.baseURL);
    await fetch(url.toString(), {
      body: JSON.stringify([
        { op: 'replace', path: '/client_data', value: 'complete' },
      ]),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'PATCH',
    });
  }
}
