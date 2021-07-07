import debug from 'debug';

const DebugPrefix = `broker:Task`;

import {
  Job,
  RunnerId,
  assertJob,
} from '@electron/bugbot-shared/build/interfaces';

class LogSection {
  public readonly runner: RunnerId;
  public readonly lines: string[] = [];

  constructor(runner: RunnerId) {
    this.runner = runner;
  }
}

export class Task {
  public etag: string;
  public readonly job: Job;
  public readonly log: LogSection[] = [];

  private logNewSection(): void {
    this.log.push(new LogSection(this.job.current?.runner));
  }

  public logText(data: string): void {
    const d = debug(`${DebugPrefix}:addLog`);
    const { log } = this;

    if (
      log.length === 0 ||
      log[log.length - 1].runner !== this.job.current?.runner
    ) {
      this.logNewSection();
    }

    d('appending to log:', data);
    const lines = data.split(/\r?\n/).filter((line) => line?.length > 0);
    log[log.length - 1].lines.push(...lines);
  }

  public getRawLog(): string {
    return this.log.map((section) => section.lines.join('\n')).join();
  }

  constructor(job: unknown) {
    assertJob(job);
    this.job = job;
  }
}
