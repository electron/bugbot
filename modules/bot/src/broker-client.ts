import fetch, { Response } from 'node-fetch';
import { URL } from 'url';
import { v4 as mkuuid } from 'uuid';

// import { FiddleBisectResult } from '@electron/bugbot-runner/build/fiddle-bisect-parser';
import {
  BisectJob,
  Job,
  JobId,
  JobType,
} from '@electron/bugbot-shared/build/interfaces';

import { FiddleInput } from './issue-parser';

export class APIError extends Error {
  public res: Response;

  constructor(res: Response, message: string) {
    super(message);
    this.res = res;
  }
}

export default class BrokerAPI {
  private readonly authToken: string;
  private readonly baseURL: string;

  constructor(props: { authToken: string; baseURL: string }) {
    this.authToken = props.authToken;
    this.baseURL = props.baseURL;
  }

  public async queueBisectJob(fiddle: FiddleInput): Promise<string> {
    const url = new URL('/api/jobs', this.baseURL);

    const bisectJob: BisectJob = {
      gist: fiddle.gistId,
      history: [],
      id: mkuuid(),
      time_added: Date.now(),
      type: JobType.bisect,
      version_range: [fiddle.goodVersion, fiddle.badVersion],
    };

    const res = await fetch(url.toString(), {
      body: JSON.stringify(bisectJob),
      headers: {
        Authorization: `Bearer ${this.authToken}`,
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

  public async getJob(jobId: JobId): Promise<Job> {
    const url = new URL(`/api/jobs/${jobId}`, this.baseURL);
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.authToken}`,
      },
    });
    return res.json();
  }

  public async completeJob(jobId: JobId): Promise<void> {
    const url = new URL(`/api/jobs/${jobId}`, this.baseURL);
    await fetch(url.toString(), {
      body: JSON.stringify([
        { op: 'replace', path: '/bot_client_data', value: 'complete' },
      ]),
      headers: {
        Authorization: `Bearer ${this.authToken}`,
        'Content-Type': 'application/json',
      },
      method: 'PATCH',
    });
  }
}
