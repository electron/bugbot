import Debug from 'debug';
import { cosmiconfigSync } from 'cosmiconfig';

import { Broker } from './broker';
import { Server } from './server';
import { Task } from './task';

const debug = Debug('broker:server');

export function createServer(): Server {
  // load settings from a broker config file
  const searchResult = cosmiconfigSync('broker').search();
  if (!searchResult) throw new Error('broker config not found');
  debug(`using broker config file '${searchResult.filepath}'`);
  const { config } = searchResult;

  // create the webserver
  const broker = new Broker();
  return new Server({
    ...(config?.server || {}),
    broker,
    createBisectTask: Task.createBisectTask,
  });
}

if (require.main === module) {
  createServer().listen();
}
