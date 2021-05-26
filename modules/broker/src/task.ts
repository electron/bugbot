import * as semver from 'semver';
import { v4 as mkuuid, validate as is_uuid } from 'uuid';

export class Task {
  public readonly id: string;
  public readonly log: string;
  public readonly log_data: string[] = [];
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

  constructor(props: Record<string, string | number>) {
    // provide default values for any missing required properties
    if (!is_uuid(props.id)) props.id = mkuuid();
    if (!props.log) props.log = `/log/${props.id}`;
    if (!props.time_created) props.time_created = Date.now();

    for (const [key, val] of Object.entries(props)) {
      this[key] = val;
    }
  }

  public static PackageFields = Object.freeze(new Set(['etag', 'log_data']));

  public static PublicFields = Object.freeze(
    new Set([
      'bisect_result',
      'client_data',
      'error',
      'first',
      'gist',
      'id',
      'last',
      'log',
      'os',
      'runner',
      'time_created',
      'time_finished',
      'time_started',
      'type',
    ]),
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
    os: (value: string) => ['linux', 'macos', 'windows'].includes(value),
    type: (value: string) => ['bisect', 'test'].includes(value),
  });

  public static createBisectTask(props: Record<string, string>): Task {
    const required_all = ['gist', 'type'];
    const required_type = new Map([['bisect', ['first', 'last']]]);
    for (const name of [...required_all, ...required_type.get(props.type)]) {
      if (!props[name]) {
        throw new Error(`missing property: ${name}`);
      }
    }

    for (const [key, value] of Object.entries(props)) {
      if (!Task.KnownProps.has(key)) {
        throw new Error(`unknown property: '${key}'`);
      }

      const test = Task.PropertyTests[key];
      if (test && !test(value)) {
        throw new Error(`invalid value for '${key}': '${value}'`);
      }
    }

    return new Task(props);
  }
}
