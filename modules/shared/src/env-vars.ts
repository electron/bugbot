import debug = require('debug');

const d = debug('env-vars');

/**
 * Gets a variable from the environment (`process.env`), showing a debug warning
 * if the requested variable wasn't found.
 */
export function env(name: string): string {
  if (Object.prototype.hasOwnProperty.call(process.env, name)) {
    return process.env[name];
  }

  d(`Could not find environment variable "${name}"`);
  process.exit(1);

  // This line is never reached and only here to appease the linter
  return '' as never;
}
