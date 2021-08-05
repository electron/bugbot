import debug from 'debug';
import fetch from 'node-fetch';
import { Operation as PatchOp } from 'fast-json-patch';
import { URL } from 'url';

import { Current, Job, Result } from '@electron/bugbot-shared/build/interfaces';

export class Task {
  private logTimer: ReturnType<typeof setTimeout>;
  private readonly logBuffer: string[] = [];
  public readonly timeBegun = Date.now();
  private readonly debugPrefix: string;

  constructor(
    public readonly job: Job,
    public etag: string,
    public runner: string,
    private readonly authToken: string,
    private readonly brokerUrl: string,
    private readonly logIntervalMs: number,
  ) {
    this.debugPrefix = `runner:${this.runner}`;
  }

  private async sendLogDataBuffer(url: URL) {
    const d = debug(`${this.debugPrefix}:sendLogDataBuffer`);
    delete this.logTimer;

    const lines = this.logBuffer.splice(0);
    const body = lines.join('\n');
    d(`sending ${lines.length} lines`, body);
    const resp = await fetch(url, {
      body,
      headers: {
        Authorization: `Bearer ${this.authToken}`,
        'Content-Type': 'text/plain; charset=utf-8',
      },
      method: 'PUT',
    });
    d(`resp.status ${resp.status}`);
  }

  public addLogData(data: string) {
    // save the URL to safeguard against this.jobId being cleared at end-of-job
    const log_url = new URL(`api/jobs/${this.job.id}/log`, this.brokerUrl);
    this.logBuffer.push(data);
    if (!this.logTimer) {
      this.logTimer = setTimeout(
        () => void this.sendLogDataBuffer(log_url),
        this.logIntervalMs,
      );
    }
  }

  /**
   * @returns {boolean} success / failure (response.ok)
   */
  private async sendPatch(patches: Readonly<PatchOp>[]): Promise<boolean> {
    const d = debug(`${this.debugPrefix}:sendPatch`);
    d('job: %o', this.job);
    d('patches:');
    for (const patch of patches) d('%o', patch);

    // Send the patch
    const job_url = new URL(`api/jobs/${this.job.id}`, this.brokerUrl);
    const response = await fetch(job_url, {
      body: JSON.stringify(patches),
      headers: {
        Authorization: `Bearer ${this.authToken}`,
        'Content-Type': 'application/json',
        ETag: this.etag,
      },
      method: 'PATCH',
    });
    d('broker response:', response.status, response.statusText);
    const { headers, ok } = response;

    // if we got an etag, keep it
    if (ok && headers.has('etag')) this.etag = headers.get('etag');

    return ok;
  }

  /**
   * @returns {boolean} success / failure (response.ok)
   */
  public sendResult(resultIn: Partial<Result>): Promise<boolean> {
    const result: Partial<Result> = {
      runner: this.runner,
      status: 'system_error',
      time_begun: this.timeBegun,
      time_ended: Date.now(),
      ...resultIn,
    };
    return this.sendPatch([
      { op: 'add', path: '/history/-', value: result },
      { op: 'replace', path: '/last', value: result },
      { op: 'remove', path: '/current' },
    ]);
  }

  /**
   * @returns {boolean} success / failure (response.ok)
   */
  public claimForRunner(): Promise<boolean> {
    const current: Current = {
      runner: this.runner,
      time_begun: this.timeBegun,
    };
    return this.sendPatch([
      { op: 'replace', path: '/current', value: current },
    ]);
  }
}
