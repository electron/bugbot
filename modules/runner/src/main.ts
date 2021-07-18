import debug from 'debug';
import { Runner } from './runner';

const d = debug('runner');

async function main() {
  try {
    const runner = new Runner();
    await runner.start();
  } catch (err) {
    d('encountered an error: %O', err);
    console.error('execution stopped due to a critical error', err);
    process.exit(1);
  }
}

void main();
