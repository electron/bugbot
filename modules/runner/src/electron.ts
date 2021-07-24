import envPaths from 'env-paths';
import debug from 'debug';
import * as path from 'path';
import * as fs from 'fs-extra';
import extract from 'extract-zip';
import fetch from 'node-fetch';

import { download as electronDownload } from '@electron/get';

const fetchOpts: Record<string, unknown> = {};
if (process.env.BUGBOT_GITHUB_PAT) {
  fetchOpts.headers = {
    Authorization: `token ${process.env.BUGBOT_GITHUB_PAT}`,
  };
}

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
      pctDone = pct;
      d(`⏳ downloaded ${pct}%`);
    }
  };
  return await electronDownload(version, {
    downloadOptions: {
      quiet: true,
      getProgressCallback,
    },
  });
}

async function ensureElectron(version: string): Promise<string> {
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
  const zipfile = await ensureElectron(version);

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

async function fetchLastGistCommit(
  gistId: string,
): Promise<Record<string, any>> {
  const d = debug(`${DebugPrefix}:${gistId}:fetchLastGistCommit`);

  // fetch 'version' of the latest commit
  const url = `https://api.github.com/gists/${gistId}/commits?per_page=1`;
  d('url', url.toString());
  const response = await fetch(url, fetchOpts);
  const json = await response.json();
  d('response.ok', response.ok);
  d('response.status', response.status);
  return json[0];
}

export async function prepareGist(gistId: string): Promise<string> {
  const d = debug(`${DebugPrefix}:${gistId}:prepareGist`);

  // We store gists on disk locally, but gists can be modified upstream.
  // So check to make sure we have the right version by getting the version
  // of the latest commit from github
  const lastCommit = await fetchLastGistCommit(gistId);
  const version = lastCommit.version as string;
  const login = lastCommit.user.login as string;
  const gistsDir = path.join(dataRoot, 'gists');
  const gistDir = path.join(gistsDir, `${gistId}-${version}`);
  d('gistDir', gistDir);
  if (fs.existsSync(gistDir)) {
    d('already have gist; no need to download');
  } else {
    d(`saving gist to "${gistDir}"`);
    await fs.emptyDir(gistDir);
    const url = `https://gist.github.com/${login}/${gistId}/archive/${version}.zip`;
    const response = await fetch(url, fetchOpts);

    // save it to a tempfile
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.ensureDir(paths.temp);
    const tempfile = path.join(paths.temp, `runner-${gistId}.zip`);
    d(`Content: downloading gist to "${tempfile}"`);
    await fs.writeFile(tempfile, buffer, { encoding: 'utf8' });

    // unzip it from the tempfile
    d(`unzipping gist`);
    await fs.ensureDir(gistsDir);
    await extract(tempfile, { dir: gistsDir });
    d(`unzipped; removing "${tempfile}"`);
    await fs.remove(tempfile);
  }

  return path.join(gistDir, 'main.js');
}
