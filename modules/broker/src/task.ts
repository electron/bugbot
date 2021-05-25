import { v4 as mkuuid } from 'uuid';

import { isKnownOS } from './utils';

function currentTimeT() {
  return Math.floor(Date.now() / 1000);
}

// FIXME(@ckerr) still thinking this one through.
// With current requirements, this could probably just be a POJO
export class Task {
  public readonly id: string;
  public gist: string;
  public os: string;
  public time_created: Date;
  public time_finished: Date | undefined = undefined;
  public time_started: Date | undefined = undefined;

  constructor(props = {}) {
    const defaultProps = {
      id: mkuuid(),
      time_created: currentTimeT(),
    };

    // FIXME(@ckerr) validate these properties
    props = { ...defaultProps, ...props };
    for (const [key, val] of Object.entries(props)) {
      this[key] = val;
    }
  }

  public static createBisectTask(props: Record<string, any>): Task {
    const required = ['gist'];
    for (const name of required) {
      if (!props[name]) {
        throw new Error(`missing property: ${name}`);
      }
    }

    if (props.os && !isKnownOS(props.os)) {
      throw new Error(`unrecognized operating system: ${props.os}`);
    }
    return new Task(props);
  }
}
