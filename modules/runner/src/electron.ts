import * as fs from 'fs-extra';
import * as path from 'path';
import debug from 'debug';
import envPaths from 'env-paths';
import extract from 'extract-zip';
import simpleGit from 'simple-git';
import { download as electronDownload } from '@electron/get';

// ${path}/bugbot/electron/current/    - a single unzipped 'current' install
// ${path}/bugbot/electron/zips/*.zip  - downloaded, zipped versions of electron
// ${path}/bugbot/gists/*              - downloaded gists

const paths = envPaths('bugbot', { suffix: '' });
const dataRoot = paths.data;

const DebugPrefix = 'runner:electron' as const;

/// Electron

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

export async function ensureDownloaded(version: string): Promise<string> {
  const d = debug(`${DebugPrefix}:${version}:ensureElectron`);

  const zipFile = path.join(zipDir, getZipName(version));
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

export async function prepareElectron(version: string): Promise<string> {
  const d = debug(`${DebugPrefix}:${version}:prepareElectron`);

  // see if the current version (if any) is already `version`
  const currentDir = path.join(dataRoot, 'electron', 'current');
  const versionFile = path.join(currentDir, 'version');
  try {
    const currentVersion = fs.readFileSync(versionFile, 'utf8');
    if (currentVersion === version) {
      d(`already installed`);
      return;
    }
  } catch {
    // no current version
  }

  const zipFile = await ensureDownloaded(version);
  d(`installing from "${zipFile}"`);
  await fs.emptyDir(currentDir);
  await extract(zipFile, { dir: currentDir });

  // return the full path to the electron executable
  const exec = path.join(currentDir, execSubpath());
  d(`executable is at "${exec}"`);
  return exec;
}

// Gists

export async function prepareGist(gistId: string): Promise<string> {
  const d = debug(`${DebugPrefix}:${gistId}:prepareGist`);

  const gistDir = path.join(dataRoot, 'gists', gistId);
  if (!fs.existsSync(gistDir)) {
    d(`cloning gist into "${gistDir}"`);
    const git = simpleGit();
    await git.clone(`https://gist.github.com/${gistId}.git`, gistDir);
  } else {
    d(`'git pull origin master' in "${gistDir}"`);
    const git = simpleGit(gistDir);
    await git.pull('origin', 'master', { '--no-rebase': null });
  }

  // return the full path to the gist's main.js
  return path.join(gistDir, 'main.js');
}
