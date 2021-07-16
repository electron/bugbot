import { TestJob } from '@electron/bugbot-shared/src/interfaces';
import { debug } from 'debug';
import table from 'markdown-table';

// FIXME(any): better typing here
export interface Matrix {
  linux?: any;
  darwin?: any;
  win32?: any;
}

export function generateTable(jobMatrix: Matrix) {
  const d = debug('generateTable');
  d('input matrix %O', jobMatrix);

  const platforms = Object.keys(jobMatrix);
  // this assumes that each platform tests the same version list
  const versions = Object.keys(jobMatrix[platforms[0]]);

  const tableInput: string[][] = [];

  // header row
  const header = ['', ...platforms];
  tableInput.push(header);

  // each row is a version with its results per platform
  for (const version of versions) {
    const versionRow = [version];

    // TODO(any): prettify the status messages
    for (const plat of platforms) {
      const result = jobMatrix[plat][version] as TestJob;
      versionRow.push(result?.last.status ? result.last.status : '-');
    }

    tableInput.push(versionRow);
  }

  const tableOutput = table(tableInput);
  d(tableOutput);
  return tableOutput;
}
