import { Broker } from './broker';
import { Server } from './server';

const broker = new Broker();
const server = new Server({
  broker,
  port: Number.parseInt(process.env.BUGBOT_BROKER_PORT, 10) || 8088,
});
server.listen();
