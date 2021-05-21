import { Broker } from './broker';
import { Server } from './server';

const broker = new Broker();
const server = new Server({
  broker,
  port: 8088,
});
server.listen();
