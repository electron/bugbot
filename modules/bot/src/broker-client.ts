import debug from 'debug';
import fetch from 'node-fetch';
import { URL } from 'url';
import { v4 as mkuuid } from 'uuid';

// import { FiddleBisectResult } from '@electron/bugbot-runner/build/fiddle-bisect-parser';
import {
  BisectJob,
  Job,
  JobId,
  JobType,
  TestJob,
} from '@electron/bugbot-shared/build/interfaces';

import { BisectCommand, TestCommand } from './issue-parser';

const DebugPrefix = 'bot:BrokerAPI';

export default class BrokerAPI {
  private readonly authToken: string;
  private readonly baseURL: string;

  constructor(props: { authToken: string; baseURL: string }) {
    this.authToken = props.authToken;
    this.baseURL = props.baseURL;
  }

  public async queueBisectJob(command: BisectCommand): Promise<string> {
    const d = debug(`${DebugPrefix}:queueBisectJob`);

    const url = new URL('/api/jobs', this.baseURL);
    d('url', url.toString());

    const bisectJob: BisectJob = {
      gist: command.gistId,
      history: [],
      id: mkuuid(),
      time_added: Date.now(),
      type: JobType.bisect,
      version_range: [command.goodVersion, command.badVersion],
    };

    const body = JSON.stringify(bisectJob);
    d('body', body);
    const response = await fetch(url.toString(), {
      body,
      headers: {
        Authorization: `Bearer ${this.authToken}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });

    const { status, statusText } = response;
    d('status', status, 'statusText', statusText);
    const jobId = await response.text();
    d('jobId', jobId);
    return jobId;
  }

  public async queueTestJob(command: TestCommand): Promise<string> {
    const d = debug(`${DebugPrefix}:queueTestJob`);

    const url = new URL('/api/jobs', this.baseURL);
    d('queueing test command via %s', url.toString());

    // FIXME(any): We should add a separate type here so that we can
    // pass in a single version and platform to this function
    const testJob: TestJob = {
      gist: command.gistId,
      history: [],
      id: mkuuid(),
      time_added: Date.now(),
      type: JobType.test,
      version: command.versions[0],
      platform: command.platforms[0],
    };

    const body = JSON.stringify(testJob);
    d('body', body);
    const response = await fetch(url.toString(), {
      body,
      headers: {
        Authorization: `Bearer ${this.authToken}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });

    const { status, statusText } = response;
    d('status', status, 'statusText', statusText);
    const jobId = await response.text();
    d('jobId', jobId);
    return jobId;
  }

  public stopJob(jobId: JobId) {
    const url = new URL(`/api/jobs/${jobId}`, this.baseURL);
    console.log('stopping job', { url });
  }

  public async getJob(jobId: JobId): Promise<Job> {
    const d = debug(`${DebugPrefix}:getJob`);

    const url = new URL(`/api/jobs/${jobId}`, this.baseURL);
    d('url', url.toString());

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.authToken}`,
      },
    });

    const { status, statusText } = response;
    d('status', status, 'statusText', statusText);

    return response.json();
  }
}
