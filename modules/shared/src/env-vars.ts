import debug = require('debug');

/**
 * Gets a variable from the environment (`process.env`).
 * Exits the process if the requested variable isn't found.
 */
export function env(name: string, fallback: string = undefined): string {
  const d = debug('env-vars:env');

  const value = process.env[name];
  if (value !== undefined) {
    d(`env var '${name}' found: '${value}'`);
    return value;
  }

  if (fallback !== undefined) {
    d(`env var '${name}' not found: using fallback '${fallback}'`);
    return fallback;
  }

  console.error(`env var '${name}' not found. exiting.`);
  process.exit(1);
  return undefined; // notreached; make linter happy
}

/**
 * Gets an integer variable from the environment (`process.env`).
 * Exits the process if the requested variable isn't found.
 */
export function envInt(name: string, fallback: number = undefined): number {
  const d = debug('env-vars:envInt');

  const value = Number.parseInt(process.env[name], 10);
  if (Number.isInteger(value)) {
    d(`env var '${name}' integer found: '${value}'`);
    return value;
  }

  if (Number.isInteger(fallback)) {
    d(`env var '${name}' not found: using fallback '${fallback}'`);
    return fallback;
  }

  console.error(`env var '${name}' not found. exiting.`);
  process.exit(1);
  return undefined; // notreached; make linter happy
}
