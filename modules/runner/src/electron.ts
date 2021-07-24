import * as fs from 'fs-extra';
import * as path from 'path';
import debug from 'debug';
import envPaths from 'env-paths';
import extract from 'extract-zip';
import simpleGit from 'simple-git';

import { download as electronDownload } from '@electron/get';

async function readFile(filename: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filename, 'utf8');
  } catch {
    return undefined;
  }
}

const paths = envPaths('bugbot', { suffix: '' });
const dataRoot = paths.data;

const DebugPrefix = 'runner:electron' as const;

// Electron versions

const zipDir = path.join(dataRoot, 'electron', 'zips');

const getZipName = (version: string) =>
  `electron-v${version}-${process.platform}-${process.arch}.zip`;

async function downloadElectron(version: string): Promise<string> {
  const d = debug(`${DebugPrefix}:${version}:downloadElectron`);
  let pctDone = 0;
  const getProgressCallback = (progress: { percent: number }) => {
    const pct = Math.round(progress.percent * 100);
    if (pctDone + 10 <= pct) {
      d(`${pct >= 100 ? '🏁' : '⏳'} downloaded ${pct}%`);
      pctDone = pct;
    }
  };
  return await electronDownload(version, {
    downloadOptions: {
      quiet: true,
      getProgressCallback,
    },
  });
}

export async function ensureElectronIsDownloaded(
  version: string,
): Promise<string> {
  const d = debug(`${DebugPrefix}:${version}:ensureElectron`);
  const zipName = getZipName(version);
  const zipFile = path.join(zipDir, zipName);
  if (fs.existsSync(zipFile)) {
    d(`"${zipFile}" exists; no need to download`);
  } else {
    d(`"${zipFile}" does not exist; downloading now`);
    const tempFile = await downloadElectron(version);
    await fs.ensureDir(zipDir);
    await fs.move(tempFile, zipFile);
    d(`"${zipFile}" downloaded`);
  }
  return zipFile;
}

function execSubpath(): string {
  switch (process.platform) {
    case 'darwin':
      return 'Electron.app/Contents/MacOS/Electron';
    case 'win32':
      return 'electron.exe';
    default:
      return 'electron';
  }
}

export async function prepareElectron(version: string) {
  const d = debug(`${DebugPrefix}:${version}:prepareElectron`);
  const zipfile = await ensureElectronIsDownloaded(version);

  const currentDir = path.join(dataRoot, 'electron', 'current');
  const currentVersionFile = path.join(currentDir, 'version');
  const currentVersion = await readFile(currentVersionFile);
  d(`the current electron version is "${currentVersion}"`);

  if (currentVersion === version) {
    d(`already installed`);
  } else {
    d(`unzipping from "${zipfile}" to "${currentDir}"`);
    await fs.emptyDir(currentDir);
    await extract(zipfile, { dir: currentDir });
  }

  const exec = path.join(currentDir, execSubpath());
  d(`executable is at "${exec}"`);
  return exec;
}

// gists

export async function prepareGist(gistId: string): Promise<string> {
  const d = debug(`${DebugPrefix}:${gistId}:prepareGist`);

  const gistDir = path.join(dataRoot, 'gists', gistId);
  const git = simpleGit();

  if (!fs.existsSync(gistDir)) {
    d(`cloning gist into "${gistDir}"`);
    await git.clone(`https://gist.github.com/${gistId}.git`, gistDir);
  } else {
    d(`'git pull origin master' in "${gistDir}"`);
    await git.cwd(gistDir).pull('origin', 'master', { '--no-rebase': null });
  }

  return path.join(gistDir, 'main.js');
}
