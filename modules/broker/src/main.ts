import Debug from 'debug';
import { cosmiconfigSync } from 'cosmiconfig';

import { Broker } from './broker';
import { Server } from './server';
import { Task } from './task';

const debug = Debug('broker:server');

// load settings from a broker config file
const searchResult = cosmiconfigSync('broker').search();
if (!searchResult) throw new Error('broker config not found');
debug(`using broker config file '${searchResult.filepath}'`);
const { config } = searchResult;

// start the web server
const broker = new Broker();
const server = new Server({
  ...(config?.server || {}),
  broker,
  createBisectTask: Task.createBisectTask,
});
server.listen();
