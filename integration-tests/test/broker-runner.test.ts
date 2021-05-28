import { Server as Broker } from '../../modules/broker/src/server';
import { createServer as createBroker } from '../../modules/broker/src/main';

describe('IntegrationTests', () => {
  let broker: Broker;

  beforeEach(() => {
    broker = createBroker();
    broker.listen();
    expect(broker.port).toBeGreaterThan(0);
  });

  afterEach(() => {
    broker.close();
  });

  it.todo('starts');
});
