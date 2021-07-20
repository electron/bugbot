import * as path from 'path';
import { URL } from 'url';
import { v4 as mkuuid } from 'uuid';

import { Auth, AuthScope } from '../../modules/broker/src/auth';
import { Broker } from '../../modules/broker/src/broker';
import { Task } from '../../modules/broker/src/task';
import { Server as BrokerServer } from '../../modules/broker/src/server';
import { Runner } from '../../modules/runner/src/runner';

import {
  BisectJob,
  Current,
  JobType,
  Platform,
  Result,
  TestJob,
  VersionRange,
} from '@electron/bugbot-shared/build/interfaces';

jest.setTimeout(60_000);

describe('runner', () => {
  const brokerUrl = `http://localhost:9090`; // arbitrary port
  const platform: Platform = 'linux';

  const auth = new Auth();
  const authToken = auth.createToken([AuthScope.UpdateJobs]);

  let broker: Broker;
  let brokerServer: BrokerServer;
  let runner: Runner;

  function startBroker(opts: Record<string, any> = {}): Promise<void> {
    broker = new Broker();
    brokerServer = new BrokerServer({ auth, broker, brokerUrl, ...opts });
    return brokerServer.start();
  }

  function createRunner(opts: Record<string, unknown> = {}) {
    runner = new Runner({
      authToken,
      brokerUrl,
      fiddleExec: path.resolve(__dirname, 'fixtures', 'electron-fiddle'),
      logIntervalMs: 1, // minimize batching to avoid timing issues during testing
      platform,
      ...opts,
    });
  }

  afterEach(async () => {
    await brokerServer.stop();
    runner.stop();
  });

  it('starts', async () => {
    await startBroker();
    expect(brokerServer.brokerUrl).toStrictEqual(new URL(brokerUrl));

    createRunner();
    expect(runner.platform).toBe(platform);
  });

  async function runTask(task: Task, runnerOpts: Record<string, any> = {}) {
    await startBroker();
    broker.addTask(task);
    createRunner(runnerOpts);
    await runner.pollOnce();
  }

  function createBisectTask(job: Partial<BisectJob> = {}) {
    return new Task({
      gist: '8c5fc0c6a5153d49b5a4a56d3ed9da8f',
      history: [],
      id: mkuuid(),
      platform,
      time_added: Date.now(),
      type: JobType.bisect,
      version_range: ['10.0.0', '11.2.0'],
      ...job,
    });
  }

  function createTestTask(job: Partial<TestJob> = {}) {
    return new Task({
      gist: '8c5fc0c6a5153d49b5a4a56d3ed9da8f',
      history: [],
      id: mkuuid(),
      platform,
      time_added: Date.now(),
      type: JobType.test,
      version: '10.0.0',
      ...job,
    });
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

    const version_range: Readonly<VersionRange> = [
      '11.0.0-nightly.20200724',
      '11.0.0-nightly.20200729',
    ];

    beforeAll(async () => {
      task = createBisectTask();
      const { job } = task;
      expect(job.last).toBeUndefined();
      expect(job.history).toHaveLength(0);
      await runTask(task);
    });

    it('sets job.last', () => {
      const expected = {
        runner: runner.uuid,
        status: 'success',
        version_range,
      } as const;

      const { last } = task.job;
      expect(last.runner).toBe(expected.runner);
      expect(last.status).toBe(expected.status);
      expect(last.version_range).toStrictEqual(expected.version_range);

      const { time_begun, time_ended } = last;
      expect(time_begun).not.toBeNaN();
      expect(time_begun).toBeGreaterThan(0);
      expect(time_ended).not.toBeNaN();
      expect(time_ended).toBeGreaterThanOrEqual(time_begun);
    });

    it('appends job.history', () => {
      const { job } = task;
      expect(job.history).toStrictEqual([job.last]);
    });

    it('clears job.current', () => {
      const { job } = task;
      expect(job.current).toBeFalsy();
    });

    it('includes the commit range to job.log', () => {
      const log = task.getRawLog();
      const [a, b] = version_range;
      const url = `https://github.com/electron/electron/compare/v${a}...v${b}`;
      expect(log).toMatch(url);
    });
  });

  describe('handles test that pass', () => {
    let task: Task;

    beforeAll(async () => {
      task = createTestTask();
      const { job } = task;
      expect(job.last).toBeUndefined();
      expect(job.history).toHaveLength(0);
      await runTask(task);
    });

    it('sets job.last', () => {
      const expected = {
        runner: runner.uuid,
        status: 'success',
      } as const;

      const { last } = task.job;
      expect(last.runner).toBe(expected.runner);
      expect(last.status).toBe(expected.status);

      const { time_begun, time_ended } = last;
      expect(time_begun).not.toBeNaN();
      expect(time_begun).toBeGreaterThan(0);
      expect(time_ended).not.toBeNaN();
      expect(time_ended).toBeGreaterThanOrEqual(time_begun);
    });
  });

  describe('handles tests that fail', () => {
    let task: Task;

    beforeAll(async () => {
      task = createTestTask({ version: '11.0.2' });
      const { job } = task;
      expect(job.last).toBeUndefined();
      expect(job.history).toHaveLength(0);
      await runTask(task);
    });

    it('sets job.last', () => {
      const expected = {
        runner: runner.uuid,
        status: 'failure',
      } as const;

      const { last } = task.job;
      expect(last.runner).toBe(expected.runner);
      expect(last.status).toBe(expected.status);

      const { time_begun, time_ended } = last;
      expect(time_begun).not.toBeNaN();
      expect(time_begun).toBeGreaterThan(0);
      expect(time_ended).not.toBeNaN();
      expect(time_ended).toBeGreaterThanOrEqual(time_begun);
    });
  });

  it('returns a system error if electron-fiddle cannot start', async () => {
    const childTimeoutMs = 200;
    const fiddleExec = '/dev/null';
    const task = createTestTask();

    await runTask(task, { childTimeoutMs, fiddleExec });
    const { last } = task.job;
    expect(last).toMatchObject({
      error: expect.stringMatching(fiddleExec),
      status: 'system_error',
    });
  });
});
