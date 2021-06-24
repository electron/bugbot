import * as path from 'path';
import { URL } from 'url';
import { v4 as mkuuid } from 'uuid';

import { Auth, AuthScope } from '../../modules/broker/src/auth';
import { Broker } from '../../modules/broker/src/broker';
import { Task } from '../../modules/broker/src/task';
import { Server as BrokerServer } from '../../modules/broker/src/server';
import { Runner } from '../../modules/runner/src/runner';

import {
  BisectRange,
  Current,
  Platform,
  Result,
} from '@electron/bugbot-shared/lib/interfaces';

jest.setTimeout(60 * 1000);

describe('runner', () => {
  const brokerUrl = `http://localhost:9090`; // arbitrary port
  const platform: Platform = 'linux';

  const auth = new Auth();
  const authToken = auth.createToken([AuthScope.UpdateJobs]);

  let broker: Broker;
  let brokerServer: BrokerServer;
  let runner: Runner;

  function startBroker(opts: Record<string, any> = {}) {
    broker = new Broker();
    brokerServer = new BrokerServer({ auth, broker, brokerUrl, ...opts });
    brokerServer.start();
  }

  function createRunner(opts: Record<string, any> = {}) {
    runner = new Runner({
      authToken,
      brokerUrl,
      fiddleExec: path.resolve(__dirname, 'fixtures', 'electron-fiddle'),
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
    expect(brokerServer.brokerUrl).toStrictEqual(new URL(brokerUrl));

    createRunner();
    expect(runner.platform).toBe(platform);
  });

  async function runTask(task: Task) {
    startBroker();
    broker.addTask(task);
    createRunner();
    await runner.poll();
  }

  function createBisectTask(opts: Record<string, any> = {}) {
    const bisect_range: Readonly<BisectRange> = ['10.0.0', '11.2.0'];
    const gist = '8c5fc0c6a5153d49b5a4a56d3ed9da8f' as const;
    const type = 'bisect' as const;
    const defaults = { bisect_range, gist, platform, type } as const;
    return Task.createBisectTask({ ...defaults, ...opts });
  }

  describe('does not claim tasks', () => {
    async function expectTaskToNotChange(task: Task) {
      const takeSnapshot = (o: any) => JSON.stringify(o);
      const originalState = takeSnapshot(task);
      await runTask(task);
      expect(takeSnapshot(task)).toStrictEqual(originalState);
    }

    it('where job.platform differs', async () => {
      const otherPlatform = 'win32';
      expect(otherPlatform).not.toStrictEqual(platform);
      const task = createBisectTask({ platform: otherPlatform });
      await expectTaskToNotChange(task);
    });

    it('where job.current is set', async () => {
      const current: Current = {
        runner: mkuuid(),
        time_begun: Date.now(),
      };
      const task = createBisectTask({ current });
      await expectTaskToNotChange(task);
    });

    it('whose last.status is set', async () => {
      const last: Result = {
        runner: mkuuid(),
        status: 'success',
        time_begun: Date.now(),
        time_ended: Date.now(),
      };
      const task = createBisectTask({ last });
      await expectTaskToNotChange(task);
    });
  });

  describe('handles successful bisection', () => {
    let task: Task;

    const bisect_range: Readonly<BisectRange> = [
      '11.0.0-nightly.20200724',
      '11.0.0-nightly.20200729',
    ];

    beforeAll(async () => {
      task = createBisectTask();
      expect(task.last).toBeUndefined();
      expect(task.history).toHaveLength(0);
      await runTask(task);
    });

    it('sets job.last', () => {
      const expected = {
        bisect_range,
        runner: runner.uuid,
        status: 'success',
      } as const;
      expect(task.last.bisect_range).toStrictEqual(expected.bisect_range);
      expect(task.last.runner).toBe(expected.runner);
      expect(task.last.status).toBe(expected.status);

      const time_begun = Number.parseInt(task.last.time_begun, 10);
      expect(time_begun).not.toBeNaN();
      expect(time_begun).toBeGreaterThan(0);

      const time_ended = Number.parseInt(task.last.time_begun, 10);
      expect(time_ended).not.toBeNaN();
      expect(time_ended).toBeGreaterThanOrEqual(time_begun);
    });

    it('appends job.history', () => {
      expect(task.history).toStrictEqual([task.last]);
    });

    it('clears job.current', () => {
      expect(task.current).toBeFalsy();
    });

    it('includes the commit range to job.log', () => {
      const log = task.getRawLog();
      const [a, b] = bisect_range;
      const url = `https://github.com/electron/electron/compare/v${a}...v${b}`;
      expect(log).toMatch(url);
    });
  });
});
