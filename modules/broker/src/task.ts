import * as semver from 'semver';
import { v4 as mkuuid, validate as is_uuid } from 'uuid';

export class Task {
  public readonly id: string;
  public readonly log: string[] = [];
  public readonly time_created: Date;
  public readonly type: string;
  public bisect_result: string[] | undefined = undefined;
  public client_data: string | undefined = undefined;
  public error: string | undefined = undefined;
  public etag: string | undefined = undefined;
  public first: string | undefined = undefined;
  public gist: string;
  public last: string | undefined = undefined;
  public os: string;
  public runner: string;
  public time_finished: Date | undefined = undefined;
  public time_started: Date | undefined = undefined;

  constructor(props: Record<string, any>) {
    // provide default values for any missing required properties
    if (!is_uuid(props.id)) props.id = mkuuid();
    if (!props.time_created) props.time_created = Date.now();

    for (const [key, val] of Object.entries(props)) {
      this[key] = val;
    }
  }

  public static PackageFields = Object.freeze(new Set(['etag', 'log']));

  public static PublicFields = Object.freeze(
    new Set([
      'client_data',
      'error',
      'first',
      'gist',
      'id',
      'last',
      'os',
      'result_bisect',
      'runner',
      'time_created',
      'time_finished',
      'time_started',
      'type',
    ]),
  );

  private static ReadonlyProps = Object.freeze(
    new Set(['id', 'log', 'time_created', 'type']),
  );

  private static KnownProps = Object.freeze(
    new Set([...Task.PackageFields.values(), ...Task.PublicFields.values()]),
  );

  public publicSubset(): Record<string, any> {
    return Object.fromEntries(
      Object.entries(this).filter(([key]) => Task.PublicFields.has(key)),
    );
  }

  private static PropertyTests = Object.freeze({
    first: (value: string) => semver.valid(value),
    last: (value: string) => semver.valid(value),
    os: (value: string) => ['darwin', 'linux', 'win32'].includes(value),
    type: (value: string) => ['bisect', 'test'].includes(value),
  });

  public static canInit(key: string, value: any): boolean {
    if (!Task.KnownProps.has(key)) return false;
    const test = Task.PropertyTests[key];
    return !test || test(value);
  }

  public static canSet(key: string, value: any): boolean {
    return Task.canInit(key, value) && !Task.ReadonlyProps.has(key);
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
