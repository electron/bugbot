import { Platform, TestJob } from '@electron/bugbot-shared/src/interfaces';
import { debug } from 'debug';
import { URL } from 'url';
import table from 'markdown-table';

// FIXME(any): better typing here
export interface Matrix {
  linux?: any;
  darwin?: any;
  win32?: any;
}

function cellLabel(job: TestJob) {
  switch (job.last?.status) {
    case 'success':
      return 'Passed&ensp;🟢';
    case 'failure':
      return 'Failed&ensp;🔴';
    case 'system_error':
      return 'Error&ensp;🟠';
    case 'test_error':
      return 'Test Error&ensp;🔵';
    default:
      return 'Pending&ensp;🟡';
  }
}

function platformDisplayName(platform: Platform) {
  switch (platform) {
    case 'darwin':
      return 'macOS';
    case 'linux':
      return 'Linux';
    case 'win32':
      return 'Windows';
  }
}

function generateCell(job: TestJob, brokerBaseUrl: string) {
  const logUrl = new URL(`/log/${job.id}`, brokerBaseUrl);
  return `[${cellLabel(job)}](${logUrl.toString()})`;
}

function versionMarkdown(version: string) {
  return `[${version}](https://github.com/electron/electron/releases/tag/v${version})`;
}

export function generateTable(jobMatrix: Matrix, brokerBaseUrl: string) {
  const d = debug('bot:generateTable');
  d('input matrix %O', jobMatrix);

  const platforms = Object.keys(jobMatrix) as Platform[];
  // this assumes that each platform tests the same version list
  const versions = Object.keys(jobMatrix[platforms[0]]);

  const tableInput: string[][] = [];

  // header row
  const header = ['Electron', ...platforms.map((p) => platformDisplayName(p))];
  tableInput.push(header);

  // each row is a version with its results per platform
  for (const version of versions) {
    const versionRow = [versionMarkdown(version)];

    for (const plat of platforms) {
      const result = jobMatrix[plat][version] as TestJob;
      versionRow.push(generateCell(result, brokerBaseUrl));
    }

    tableInput.push(versionRow);
  }

  const align = ['l', ...new Array(platforms.length).fill('r')];
  const tableOutput = table(tableInput, { align });
  d(tableOutput);
  return tableOutput;
}
