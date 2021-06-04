import debug = require('debug');

/**
 * Gets a variable from the environment (`process.env`).
 * Exits the process if the requested variable isn't found.
 */
export function env(name: string, fallback: string = undefined): string {
  const d = debug('env-vars:env');

  const value = process.env[name];
  if (value !== undefined) {
    d(`process.env.${name} found.`);
    return value;
  }

  if (fallback !== undefined) {
    d(`process.env.${name} not found. using fallback value.`);
    return fallback;
  }

  console.error(`process.env.${name} not found. exiting.`);
  process.exit(1);
  return '' as never; // notreached; make linter happy
}

/**
 * Gets an integer variable from the environment (`process.env`).
 * Exits the process if the requested variable isn't found.
 */
export function envInt(name: string, fallback: number = undefined): number {
  const d = debug('env-vars:envInt');

  const value = Number.parseInt(process.env[name], 10);
  if (Number.isInteger(value)) {
    d(`'process.env.${name}' found.`);
    return value;
  }

  if (Number.isInteger(fallback)) {
    d(`process.env.${name} not found. using fallback value.`);
    return fallback;
  }

  console.error(`process.env.${name} not found. exiting.`);
  process.exit(1);
  return '' as never; // notreached; make linter happy
}
