import dayjs from 'dayjs';
import { v4 as mkuuid } from 'uuid';

import { Broker } from '../../modules/broker/src/broker';
import { Task } from '../../modules/broker/src/task';
import { Server as BrokerServer } from '../../modules/broker/src/server';

import { Runner } from '../../modules/runner/src/runner';

jest.setTimeout(60 * 1000);

describe('runner', () => {
  const port = 9999 as const;
  const platform = 'linux' as const;

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
      ...opts,
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

  async function runTask(task: Task) {
    startBroker();
    broker.addTask(task);
    createRunner();
    await runner.poll();
  }

  const result_bisect = [
    '11.0.0-nightly.20200724',
    '11.0.0-nightly.20200729',
  ] as const;

  function createBisectTask(opts: Record<string, any> = {}) {
    const first = '10.0.0' as const;
    const gist = '8c5fc0c6a5153d49b5a4a56d3ed9da8f' as const;
    const last = '11.2.0' as const;
    const type = 'bisect' as const;
    const defaults = { first, gist, last, platform, type } as const;
    return Task.createBisectTask({ ...defaults, ...opts });
  }

  describe('does not claim tasks', () => {
    async function expectTaskToNotChange(task: Task) {
      const takeSnapshot = (o: any) => JSON.stringify(o);
      const originalState = takeSnapshot(task);
      await runTask(task);
      expect(takeSnapshot(task)).toStrictEqual(originalState);
    }

    it('whose platform differs', async () => {
      const otherPlatform = 'win32';
      expect(otherPlatform).not.toStrictEqual(platform);
      const task = createBisectTask({ platform: otherPlatform });
      await expectTaskToNotChange(task);
    });

    it('whose runner property is set', async () => {
      const task = createBisectTask({ runner: mkuuid() });
      await expectTaskToNotChange(task);
    });

    it('whose result_bisect property is set', async () => {
      const task = createBisectTask({ result_bisect });
      await expectTaskToNotChange(task);
    });

    it('whose time_started property is set', async () => {
      const task = createBisectTask({ time_started: Date.now() });
      await expectTaskToNotChange(task);
    });

    it('whose time_done property is set', async () => {
      const task = createBisectTask({ time_done: Date.now() });
      await expectTaskToNotChange(task);
    });
  });

  describe('when bisecting', () => {
    describe('successfully', () => {
      it('sets the result_bisect property', async () => {
        const task = createBisectTask();
        expect(task.result_bisect).toBeUndefined();
        await runTask(task);
        expect(task.result_bisect).toStrictEqual(result_bisect);
      });

      it('sets the time_done property', async () => {
        const task = createBisectTask();
        expect(task.time_done).toBeUndefined();
        await runTask(task);
        const finishedAt = dayjs(task.time_done);
        const now = dayjs();
        expect(now.diff(finishedAt, 'minute')).toBeLessThan(1);
      });
    });

    describe('unsuccessfully due to invalid inputs', () => {
      function createInvalidBisectTask() {
        return createBisectTask({ gist: '💩' });
      }

      it('sets the error property', async () => {
        const task = createInvalidBisectTask();
        await expect(runTask(task)).rejects.toThrow();
        expect(task.error).toBeTruthy();
      });

      it('does not set the time_done property', async () => {
        const task = createInvalidBisectTask();
        await expect(runTask(task)).rejects.toThrow();
        expect(task.time_done).toBeUndefined();
      });
    });
  });
});
