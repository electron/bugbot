import * as semver from 'semver';
import { v4 as mkuuid } from 'uuid';

export class Task {
  public readonly id = mkuuid();
  public readonly log: string[] = [];
  public readonly time_created = Date.now();
  public readonly type: string;
  public bisect_range: string[];
  public client_data: string;
  public error: string;
  public etag: string;
  public gist: string;
  public platform: string;
  public result_bisect: string[];
  public runner: string;
  public time_done: Date;
  public time_started: Date;

  constructor(props: Record<string, any>) {
    for (const [key, val] of Object.entries(props)) {
      this[key] = val;
    }
  }

  public static PackageFields: ReadonlyArray<string> = ['etag', 'log'] as const;

  public static PublicFields: ReadonlyArray<string> = [
    'bisect_range',
    'bot_client_data',
    'error',
    'gist',
    'id',
    'platform',
    'result_bisect',
    'runner',
    'time_created',
    'time_done',
    'time_started',
    'type',
  ] as const;

  public static KnownFields: ReadonlyArray<string> = [
    ...Task.PackageFields,
    ...Task.PublicFields,
  ] as const;

  public static ReadonlyFields: ReadonlyArray<string> = [
    'id',
    'log',
    'time_created',
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

  public static createBisectTask(props: Record<string, any>): Task {
    const required_all = ['gist', 'type'];
    const required_type = new Map([['bisect', ['bisect_range']]]);
    for (const name of [...required_all, ...required_type.get(props.type)]) {
      if (!props[name]) {
        throw new Error(`missing property: ${name}`);
      }
    }

    for (const [key, value] of Object.entries(props)) {
      if (!Task.canInit(key, value)) {
        throw new Error(`invalid property: '${key}', '${value}'`);
      }
    }

    return new Task(props);
  }
}
