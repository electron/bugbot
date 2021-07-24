import debug from 'debug';
import { Runner } from './runner';
import { ensureElectronIsDownloaded } from './electron';
import { ElectronVersions } from '@electron/bugbot-shared/build/electron-versions';

const d = debug('runner');

async function prefetch() {
  const ev = new ElectronVersions();
  for (const version of await ev.getVersions()) {
    try {
      await ensureElectronIsDownloaded(version);
    } catch (err) {
      console.warn(err);
    }
  }
}

async function main() {
  if (process.argv.some((arg) => arg === '--prefetch')) return void prefetch();

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
