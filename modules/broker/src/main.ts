import { Broker } from './broker';
import { Server } from './server';
import { Task } from './task';

const broker = new Broker();
const server = new Server({
  broker,
  createBisectTask: Task.createBisectTask,
  port: Number.parseInt(process.env.BUGBOT_BROKER_PORT, 10) || 8088,
});
server.listen();
