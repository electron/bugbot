import debug from 'debug';
import { cosmiconfigSync } from 'cosmiconfig';

import { Server } from './server';

const d = debug('broker:server');

export function createServer(): Server {
  // load settings from a broker config file
  const searchResult = cosmiconfigSync('broker').search();
  if (!searchResult) throw new Error('broker config not found');
  d(`using broker config file '${searchResult.filepath}'`);
  const { config } = searchResult;

  // create the webserver
  return new Server(config?.server || {});
}

if (require.main === module) {
  createServer().start();
}
