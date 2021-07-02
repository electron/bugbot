import * as semver from 'semver';
import debug from 'debug';
import { v4 as mkuuid } from 'uuid';

import {
  JobId,
  Current,
  Result,
  RunnerId,
} from '@electron/bugbot-shared/lib/interfaces';

class LogSection {
  public readonly runner: RunnerId;
  public readonly lines: string[] = [];

  constructor(runner: RunnerId) {
    this.runner = runner;
  }
}

export class Task {
  public readonly history: Result[] = [];
  public readonly id: JobId = mkuuid();
  public readonly log: LogSection[] = [];
  public readonly time_added = Date.now();
  public readonly type: string;
  public bisect_range: [string, string];
  public client_data: string;
  public current: Current;
  public error: string;
  public etag: string;
  public gist: string;
  public last: any;
  public platform: string;

  constructor(props: Record<string, any>) {
    for (const [key, val] of Object.entries(props)) {
      this[key] = val;
    }
  }

  public static PackageFields: ReadonlyArray<string> = ['etag', 'log'] as const;

  public static PublicFields: ReadonlyArray<string> = [
    'bisect_range',
    'bot_client_data',
    'current',
    'error',
    'gist',
    'history',
    'id',
    'last',
    'platform',
    'time_added',
    'type',
  ] as const;

  public static KnownFields: ReadonlyArray<string> = [
    ...Task.PackageFields,
    ...Task.PublicFields,
  ] as const;

  public static ReadonlyFields: ReadonlyArray<string> = [
    'id',
    'log',
    'time_added',
    'type',
  ] as const;

  public publicSubset(): Record<string, any> {
    return Object.fromEntries(
      Object.entries(this).filter(([key]) => Task.PublicFields.includes(key)),
    );
  }

  private static PropertyTests = Object.freeze({
    bisect_range: (value: string[]) =>
      Array.isArray(value) &&
      value.length === 2 &&
      value.every((v) => semver.valid(v)),
    platform: (value: string) => ['darwin', 'linux', 'win32'].includes(value),
    type: (value: string) => ['bisect', 'test'].includes(value),
  });

  public static canInit(key: string, value: any): boolean {
    if (!Task.KnownFields.includes(key)) return false;
    const test = Task.PropertyTests[key];
    return !test || test(value);
  }

  public static canSet(key: string, value: any): boolean {
    return Task.canInit(key, value) && !Task.ReadonlyFields.includes(key);
  }

  private logNewSection(): void {
    this.log.push(new LogSection(this.current?.runner));
  }

  public logText(data: string): void {
    const d = debug('task:addLog');
    const { log } = this;

    if (
      log.length === 0 ||
      log[log.length - 1].runner !== this.current?.runner
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

  public static createBisectTask(props: Record<string, any>): Task {
    const required_all = ['gist', 'type'];
    const required_per_type = new Map([
      ['bisect', ['bisect_range']],
      ['test', ['version']],
    ]);
    for (const name of [
      ...required_all,
      ...required_per_type.get(props.type),
    ]) {
      if (!props[name]) {
        throw new Error(`missing property: ${name}`);
      }
    }

    for (const [key, value] of Object.entries(props)) {
      if (!Task.canInit(key, value)) {
        throw new Error(
          `invalid property: '${key}', '${JSON.stringify(value)}'`,
        );
      }
    }

    return new Task(props);
  }
}
