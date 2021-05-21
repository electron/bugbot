import { v4 as mkuuid } from 'uuid';

function currentTimeT() {
  return Math.floor(Date.now() / 1000);
}

// FIXME(@ckerr) still thinking this one through.
// With current requirements, this could probably just be a POJO
export class Task {
  public readonly id: string;
  public os: string;
  public gist: string;
  public time_created: Date;
  public time_started: Date | undefined = undefined;
  public time_finished: Date | undefined = undefined;

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

    console.debug(`new task's id is ${this.id}`);
  }
}
