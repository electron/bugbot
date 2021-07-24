import debug from 'debug';
import envPaths from 'env-paths';
import plimit from 'p-limit';

import { ElectronVersions } from '@electron/bugbot-shared/build/electron-versions';

import { ElectronSetup, Setup } from './setup';
import { Runner } from './runner';

const d = debug('runner');

async function prefetch(setup: Setup) {
  const ev = new ElectronVersions();
  const versions = await ev.getVersions();
  const limit = plimit(5);
  await Promise.allSettled(
    versions.map((version) => limit(() => setup.ensureDownloaded(version))),
  );
}

async function main() {
  const paths = envPaths('bugbot', { suffix: '' });
  const setup = new ElectronSetup(paths.data);

  if (process.argv.some((arg) => arg === '--prefetch'))
    return void prefetch(setup);

  try {
    const runner = new Runner({ setup });
    await runner.start();
  } catch (err) {
    d('encountered an error: %O', err);
    console.error('execution stopped due to a critical error', err);
    process.exit(1);
  }
}

void main();
