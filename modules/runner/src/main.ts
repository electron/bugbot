import debug from 'debug';
import plimit from 'p-limit';

import {
  ElectronVersions,
  Installer,
  Runner as FiddleRunner,
} from 'fiddle-core';

import { Runner } from './runner';

const d = debug('runner');

async function prefetch() {
  const installer = new Installer();
  const ev = await ElectronVersions.create();
  const { versions } = ev;
  const limit = plimit(5);
  await Promise.allSettled(
    versions.map((version) =>
      limit(() => installer.ensureDownloaded(version.version)),
    ),
  );
}

async function main() {
  if (process.argv.some((arg) => arg === '--prefetch')) return void prefetch();

  try {
    const fiddleRunner = await FiddleRunner.create({});
    const bugbotRunner = new Runner({ fiddleRunner });
    await bugbotRunner.start();
  } catch (err) {
    d('encountered an error: %O', err);
    console.error('execution stopped due to a critical error', err);
    process.exit(1);
  }
}

void main();
