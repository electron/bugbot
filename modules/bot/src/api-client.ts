import fetch, { Response } from 'node-fetch';
import { URL } from 'url';
import { v4 as mkuuid } from 'uuid';

// import { FiddleBisectResult } from '@electron/bugbot-runner/dist/fiddle-bisect-parser';
import { FiddleInput } from '@electron/bugbot-shared/lib/issue-parser';
import {
  AnyJob,
  BisectJob,
  JobId,
} from '@electron/bugbot-shared/lib/interfaces';

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

  public async queueBisectJob(fiddle: FiddleInput): Promise<string> {
    const url = new URL('/api/jobs', this.baseURL);

    const bisectJob: BisectJob = {
      bisect_range: [fiddle.goodVersion, fiddle.badVersion],
      gist: fiddle.gistId,
      history: [],
      id: mkuuid(),
      time_added: Date.now(),
      type: 'bisect',
    };

    const res = await fetch(url.toString(), {
      body: JSON.stringify(bisectJob),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });

    return await res.text();
  }

  public stopJob(jobId: JobId): void {
    const url = new URL(`/api/jobs/${jobId}`, this.baseURL);
    console.log('stopping job', { url });
  }

  public async getJob(jobId: JobId): Promise<AnyJob> {
    const url = new URL(`/api/jobs/${jobId}`, this.baseURL);
    const res = await fetch(url.toString());
    return res.json();
  }

  public async completeJob(jobId: JobId): Promise<any> {
    const url = new URL(`/api/jobs/${jobId}`, this.baseURL);
    await fetch(url.toString(), {
      body: JSON.stringify([
        { op: 'replace', path: '/bot_client_data', value: 'complete' },
      ]),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'PATCH',
    });
  }
}
