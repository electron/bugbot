import dayjs from 'dayjs';

import { Broker } from '../../modules/broker/src/broker';
import { Task } from '../../modules/broker/src/task';
import { Server as BrokerServer } from '../../modules/broker/src/server';

import { Runner } from '../../modules/runner/src/runner';

jest.setTimeout(60 * 1000);

describe('runner', () => {
  const first = '10.0.0';
  const gist = '8c5fc0c6a5153d49b5a4a56d3ed9da8f';
  const last = '11.2.0';
  const platform = 'linux';
  const port = 9999;
  const type = 'bisect';

  let broker: Broker;
  let brokerServer: BrokerServer;
  let runner: Runner;

  function startBroker(opts: Record<string, any> = {}) {
    broker = new Broker();
    brokerServer = new BrokerServer({ broker, port, ...opts });
    brokerServer.start();
  }

  function createRunner(opts: Record<string, any> = {}) {
    runner = new Runner({
      brokerUrl: `http://localhost:${brokerServer.port}`,
      platform,
      ...opts
    });
  }

  afterEach(() => {
    runner.stop();
    brokerServer.stop();
  });

  it('starts', () => {
    startBroker();
    expect(brokerServer.port).toBe(port);

    createRunner();
    expect(runner.platform).toBe(platform);
  });

  describe('when bisecting', () => {
    it('sets a result when bisection succeeds', async () => {
      const task = Task.createBisectTask({ first, gist, last, platform, type });
      expect(task.result_bisect).toBeUndefined();

      startBroker();
      broker.addTask(task);
      createRunner();
      await runner.poll();

      const expectedResult = [
        '11.0.0-nightly.20200724',
        '11.0.0-nightly.20200729',
      ];
      expect(task.result_bisect).toStrictEqual(expectedResult);
    });

    it('does not claim tasks that require a different platform', async () => {
      const task = Task.createBisectTask({
        first,
        gist,
        last,
        platform: 'win32',
        type,
      });
      expect(task.result_bisect).toBeUndefined();
      const originalEntries = Object.entries(task);

      startBroker();
      broker.addTask(task);
      createRunner();
      await runner.poll();

      expect(Object.entries(task)).toStrictEqual(originalEntries);
    });

    it('sets an error in the broker if the gist is invalid', async () => {
      const badGist = 'badGist';
      const task = Task.createBisectTask({ first, gist: badGist, last, type });
      expect(task.error).toBeFalsy();

      startBroker();
      broker.addTask(task);
      createRunner();
      await expect(runner.poll()).rejects.toThrow();

      expect(task.error).toBeTruthy();
    });
  });
});
