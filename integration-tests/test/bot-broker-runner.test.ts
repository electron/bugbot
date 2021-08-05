import * as fs from 'fs-extra';
import * as path from 'path';
import nock, { Scope } from 'nock';
import { URL } from 'url';
import { createProbot, Probot, ProbotOctokit } from 'probot';

import { Platform } from '@electron/bugbot-shared/build/interfaces';

import {
  BaseVersions,
  BisectResult,
  Installer,
  Paths,
  Runner as FiddleRunner,
  TestResult,
} from 'fiddle-core';

import { Broker } from '../../modules/broker/src/broker';
import { GithubClient } from '../../modules/bot/src/github-client';
import { Runner } from '../../modules/runner/src/runner';
import { Server as BrokerServer } from '../../modules/broker/src/server';

jest.setTimeout(60_000);

describe('bot-broker-runner', () => {
  const fixtureDir = path.resolve(__dirname, 'fixtures', 'api.github.com');
  const brokerUrl = `http://localhost:43493` as const; // arbitrary port
  const pollIntervalMs = 10;
  const authToken = 'test' as const;

  const versionFile = path.join(__dirname, 'fixtures', 'releases.json');
  const versionJson = fs.readJsonSync(versionFile, { encoding: 'utf8' });
  const versions = new BaseVersions(versionJson);

  // BOT

  let ghclient: GithubClient;
  let robot: Probot;
  let ghNockScope: Scope;
  function startProbot() {
    robot = createProbot({
      overrides: {
        Octokit: ProbotOctokit.defaults({
          retry: { enabled: false },
          throttle: { enabled: false },
        }),
        githubToken: 'test',
      },
    });

    ghclient = new GithubClient({
      authToken,
      brokerBaseUrl: brokerUrl,
      pollIntervalMs,
      robot,
      versions,
    });
  }

  // BROKER

  let broker: Broker;
  let brokerServer: BrokerServer;
  function startBroker(opts: Record<string, unknown> = {}): Promise<void> {
    broker = new Broker();
    brokerServer = new BrokerServer({ broker, brokerUrl, ...opts });
    return brokerServer.start();
  }

  // RUNNERS

  const runners = new Map<Platform, Runner>();

  // async function startRunners() {
  function startRunners() {
    const fiddleRunner = {
      bisect: jest.fn(),
      run: jest.fn(),
    };
    // run tests with a fake version of Electron
    // const installerMock = { install: jest.fn() };
    // const electronMock = path.join(__dirname, 'fixtures', 'electron');
    // installerMock.install.mockResolvedValue(electronMock);

    // const fiddleRunner = await FiddleRunner.create({
    //   installer: installerMock as any, // 'any' because it's a fake Installer
    // });

    for (const platform of ['linux'] as Platform[]) {
      const runner = new Runner({
        authToken,
        brokerUrl,
        fiddleRunner: fiddleRunner as any,
        logIntervalMs: 1, // minimize batching to avoid timing issues during testing
        platform,
        pollIntervalMs,
      });
      void runner.start();
      runners.set(platform, runner);
    }

    return { fiddleRunner };
  }

  beforeAll(() => {
    process.env.BUGBOT_AUTH_TOKEN = authToken;
    process.env.BUGBOT_GITHUB_LOGIN = 'erick-bugbot';
  });

  beforeEach(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('localhost');
  });

  afterEach(async () => {
    // shut down the bot
    ghclient.close();
    if (!nock.isDone()) {
      throw new Error(
        `Unused nock interceptors in test "${
          expect.getState().currentTestName
        }"\n ${JSON.stringify(nock.pendingMocks())}`,
      );
    }
    nock.cleanAll();
    nock.enableNetConnect();

    // shut down the runners
    await Promise.all([...runners.values()].map((runner) => runner.stop()));
    runners.clear();

    // shut down the broker
    await brokerServer.stop();
  });

  async function startWithDefaults() {
    startProbot();
    await startBroker();
    // await startRunners();
    return startRunners();
  }

  it('starts', async () => {
    await startWithDefaults();
    expect(brokerServer.brokerUrl).toStrictEqual(new URL(brokerUrl));
  });

  it('bisects', async () => {
    const botCommentId = 1 as const;
    const issueNumber = 10 as const;
    const projectPath = '/repos/erickzhao/bugbot' as const;
    const issuePath = `${projectPath}/issues/${issueNumber}` as const;
    ghNockScope = nock('https://api.github.com');
    ghNockScope
      .get(`${projectPath}/collaborators/erickzhao/permission`)
      .reply(200, { permission: 'admin' })
      .post(`${issuePath}/labels`)
      .reply(200)
      // create a new comment:
      .post(`${issuePath}/comments`)
      .reply(200, { id: botCommentId })
      .delete(`${issuePath}/labels/bugbot%2Ftest-running`)
      .reply(200)
      // ... task runs...
      .post(`${issuePath}/labels`)
      .reply(200)
      // update the comment
      .patch(`${projectPath}/issues/comments/${botCommentId}`)
      .reply(200);

    const { fiddleRunner } = await startWithDefaults();
    const mockBisectResult: BisectResult = {
      range: ['10.3.2', '10.4.0'],
      status: 'bisect_succeeded',
    };
    fiddleRunner.bisect = jest.fn().mockResolvedValue(mockBisectResult);

    const filename = path.join(fixtureDir, 'issue_comment.created.bisect.json');
    await robot.receive({
      name: 'issue_comment',
      payload: JSON.parse(fs.readFileSync(filename, { encoding: 'utf8' })),
    } as any);

    const tasks = broker.getTasks();
    expect(tasks.length).toBe(1);
    expect(tasks).toMatchObject([
      {
        job: {
          gist: '59444f92bffd5730944a0de6d85067fd',
          history: [
            {
              status: 'success',
              version_range: ['10.3.2', '10.4.0'],
            },
          ],
          last: {
            status: 'success',
            version_range: ['10.3.2', '10.4.0'],
          },
          type: 'bisect',
          version_range: ['10.1.6', '11.0.2'],
        },
      },
    ]);
  });

  it('tests', async () => {
    const botCommentId = 1 as const;
    const issueNumber = 10 as const;
    const projectPath = '/repos/erickzhao/bugbot' as const;
    const issuePath = `${projectPath}/issues/${issueNumber}` as const;

    /*
    const electronJsNockScope = nock('https://electronjs.org/');
    electronJsNockScope
      .get('/headers/index.json')
      .replyWithFile(200, __dirname + '/fixtures/electron-versions.json', {
        'Content-Type': 'application/json',
      });
    */

    ghNockScope = nock('https://api.github.com');
    ghNockScope
      // should we respond to this comment? yes, it's from an admin
      .get(`${projectPath}/collaborators/erickzhao/permission`)
      .reply(200, { permission: 'admin' })
      // create a new comment:
      .post(`${issuePath}/comments`)
      .reply(200, { id: botCommentId })
      // and when the test is finished, update the comment
      .patch(`${projectPath}/issues/comments/${botCommentId}`)
      .reply(200);

    const { fiddleRunner } = await startWithDefaults();

    const mockTestResult: TestResult = { status: 'test_failed' };
    fiddleRunner.run.mockResolvedValue(mockTestResult);

    const filename = path.join(fixtureDir, 'issue_comment.created.test.json');
    await robot.receive({
      name: 'issue_comment',
      payload: JSON.parse(fs.readFileSync(filename, { encoding: 'utf8' })),
    } as any);

    const tasks = broker.getTasks();
    expect(tasks.length).toBe(1);
    expect(tasks).toMatchObject([
      {
        job: {
          gist: '59444f92bffd5730944a0de6d85067fd',
          history: [
            {
              status: 'failure',
              error: 'The test ran and failed.',
            },
          ],
          type: 'test',
          version: '12.0.0',
          platform: 'linux',
          last: {
            status: 'failure',
            error: 'The test ran and failed.',
          },
        },
      },
    ]);
  });
});
