import * as semver from 'semver';
import { v4 as mkuuid, validate as is_uuid } from 'uuid';

export class Task {
  public readonly id: string;
  public readonly log: string[] = [];
  public readonly time_created: Date;
  public readonly type: string;
  public bisect_result: string[];
  public client_data: string;
  public error: string;
  public etag: string;
  public first: string;
  public gist: string;
  public last: string;
  public os: string;
  public result_bisect: string[];
  public runner: string;
  public time_done: Date;
  public time_started: Date;

  constructor(props: Record<string, any>) {
    // provide default values for any missing required properties
    if (!is_uuid(props.id)) props.id = mkuuid();
    if (!props.time_created) props.time_created = Date.now();

    for (const [key, val] of Object.entries(props)) {
      this[key] = val;
    }
  }

  public static PackageFields: ReadonlyArray<string> = ['etag', 'log'] as const;

  public static PublicFields: ReadonlyArray<string> = [
    'client_data',
    'error',
    'first',
    'gist',
    'id',
    'last',
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
    first: (value: string) => semver.valid(value),
    last: (value: string) => semver.valid(value),
    os: (value: string) => ['darwin', 'linux', 'win32'].includes(value),
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
    const required_type = new Map([['bisect', ['first', 'last']]]);
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
