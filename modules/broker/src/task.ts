import { v4 as mkuuid } from 'uuid';

import { isKnownOS } from './utils';

function isKnownType(type: string): boolean {
  return ['bisect', 'test'].includes(type.toLowerCase());
}

// FIXME(@ckerr) could this just be a pojo?
export class Task {
  public readonly id: string;
  public readonly time_created: Date;
  public etag: string | undefined = undefined;
  public gist: string;
  public os: string;
  public time_finished: Date | undefined = undefined;
  public time_started: Date | undefined = undefined;

  constructor(props: Record<string, any>) {
    // fill in default values for any missing required properties
    props = {
      id: mkuuid(),
      time_created: Date.now(),
      ...props,
    };

    // FIXME(@ckerr) validate these properties
    for (const [key, val] of Object.entries(props)) {
      this[key] = val;
    }
  }

  public static createBisectTask(props: Record<string, any>): Task {
    const required = ['gist', 'type'];
    for (const name of required) {
      if (!props[name]) {
        throw new Error(`missing property: ${name}`);
      }
    }

    if (!isKnownType(props.type)) {
      throw new Error(`unrecognized type: ${props.type}`);
    }

    if (props.os && !isKnownOS(props.os)) {
      throw new Error(`unrecognized operating system: ${props.os}`);
    }

    return new Task(props);
  }
}
