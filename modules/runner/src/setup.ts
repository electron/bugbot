import * as fs from 'fs-extra';
import * as path from 'path';
import debug from 'debug';
import extract from 'extract-zip';
import simpleGit from 'simple-git';
import { download as electronDownload } from '@electron/get';

export interface Setup {
  ensureDownloaded(version: string): Promise<string>;
  prepareElectron(version: string): Promise<string>;
  prepareGist(gistId: string): Promise<string>;
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

function getZipName(version: string) {
  return `electron-v${version}-${process.platform}-${process.arch}.zip`;
}

// ${root}/electron/current/    - a single unzipped 'current' install
// ${root}/electron/zips/*.zip  - downloaded, zipped versions of electron
// ${root}/gists/*              - downloaded gists

export class ElectronSetup implements Setup {
  private readonly DebugPrefix = 'runner:electron' as const;
  private readonly zipDir: string;

  constructor(private readonly root: string) {
    this.zipDir = path.join(this.root, 'electron', 'zips');
  }

  private async downloadElectron(version: string): Promise<string> {
    const d = debug(`${this.DebugPrefix}:${version}:downloadElectron`);
    let pctDone = 0;
    const getProgressCallback = ({ percent }) => {
      const pct = Math.round(percent * 100);
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

  public async ensureDownloaded(version: string): Promise<string> {
    const d = debug(`${this.DebugPrefix}:${version}:ensureElectron`);

    const zipFile = path.join(this.zipDir, getZipName(version));
    if (fs.existsSync(zipFile)) {
      d(`"${zipFile}" exists; no need to download`);
    } else {
      d(`"${zipFile}" does not exist; downloading now`);
      const tempFile = await this.downloadElectron(version);
      await fs.ensureDir(this.zipDir);
      await fs.move(tempFile, zipFile);
      d(`"${zipFile}" downloaded`);
    }

    return zipFile;
  }

  public async prepareElectron(version: string): Promise<string> {
    const d = debug(`${this.DebugPrefix}:${version}:prepareElectron`);

    // see if the current version (if any) is already `version`
    const currentDir = path.join(this.root, 'electron', 'current');
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

    const zipFile = await this.ensureDownloaded(version);
    d(`installing from "${zipFile}"`);
    await fs.emptyDir(currentDir);
    await extract(zipFile, { dir: currentDir });

    // return the full path to the electron executable
    const exec = path.join(currentDir, execSubpath());
    d(`executable is at "${exec}"`);
    return exec;
  }

  public async prepareGist(gistId: string): Promise<string> {
    const d = debug(`${this.DebugPrefix}:${gistId}:prepareGist`);

    const gistDir = path.join(this.root, 'gists', gistId);
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
}
