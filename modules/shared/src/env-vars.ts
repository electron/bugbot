import debug = require('debug');

/**
 * Gets a variable from the environment (`process.env`), showing a debug warning
 * if the requested variable wasn't found.
 */
export function env(name: string, opts: { default?: string } = {}): string {
  const d = debug('env-vars:env');

  if (Object.prototype.hasOwnProperty.call(process.env, name)) {
    d(`env var '${name}' found: '${process.env[name]}'`);
    return process.env[name];
  }

  if (opts?.default) {
    d(`env var '${name}' not found; defaulting to '${opts.default}'`);
    return opts.default;
  }

  const msg = `env var '${name}' not found. exiting.`;
  console.log(msg);
  d(msg);
  process.exit(1);

  return undefined; // notreached; make linter happy
}

export function envInt(name: string, opts: { default?: string } = {}): number {
  const d = debug('env-vars:envInt');

  const number = Number.parseInt(env(name, opts), 10);
  if (!Number.isNaN(number)) {
    return number;
  }

  const msg = `env var "${name}' value is not a number. exiting.`;
  console.log(msg);
  d(msg);
  process.exit(1);

  return undefined; // notreached; make linter happy
}
