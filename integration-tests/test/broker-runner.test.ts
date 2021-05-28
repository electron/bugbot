import { Server as Broker } from '../../modules/broker/src/server';
import { Runner } from '../../modules/runner/src/runner';

describe('IntegrationTests', () => {
  let broker: Broker;
  let runner: Runner;
  const port = 9999;
  const platform = 'linux';

  beforeEach(() => {
    broker = new Broker({ port });
    broker.start();

    runner = new Runner({
      brokerUrl: `http://localhost:${broker.port}`,
      fiddleExecPath: '/fixme/path/to/fiddle/fixture',
      platform,
    });
    runner.start();
  });

  afterEach(() => {
    runner.stop();
    broker.stop();
  });

  it('starts', () => {
    expect(broker.port).toBe(port);
    expect(runner.platform).toBe(platform);
  });
});
