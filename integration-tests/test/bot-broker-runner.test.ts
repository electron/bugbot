import * as path from 'path';
import nock, { Scope } from 'nock';
import { URL } from 'url';
import { createProbot, Probot, ProbotOctokit } from 'probot';
import { v4 as mkuuid } from 'uuid';
import { inspect } from 'util';

import { Auth, AuthScope } from '../../modules/broker/src/auth';
import { Broker } from '../../modules/broker/src/broker';
import { GithubClient } from '../../modules/bot/src/github-client';
import { Runner } from '../../modules/runner/src/runner';
import { Server as BrokerServer } from '../../modules/broker/src/server';
import { Labels } from '../../modules/bot/src/github-labels';
import { Task } from '../../modules/broker/src/task';

import bisectPayloadFixture from './../../modules/bot/test/fixtures/issue_comment.created.bisect.json';

import {
  BisectJob,
  Current,
  JobType,
  Platform,
  Result,
  TestJob,
  VersionRange,
} from '@electron/bugbot-shared/build/interfaces';

jest.setTimeout(60 * 1000);

describe('bot-broker-runner', () => {
  const brokerUrl = `http://localhost:43493` as const; // arbitrary port
  const pollIntervalMs = 10;

  // const auth = new Auth();
  const authToken = 'test' as const; // auth.createToken([AuthScope.UpdateJobs]);

  // BOT

  let ghclient: GithubClient;
  let robot: Probot;
  let ghNockScope: Scope;
  let brokerNockScope: Scope;
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

  function startRunners() {
    for (const platform of ['linux'] as Platform[]) {
      const runner = new Runner({
        authToken,
        brokerUrl,
        fiddleExec: path.resolve(__dirname, 'fixtures', 'electron-fiddle'),
        logIntervalMs: 1, // minimize batching to avoid timing issues during testing
        platform,
        pollIntervalMs,
      });
      runner.start();
      runners.set(platform, runner);
    }
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
    runners.forEach((runner) => runner.stop());
    runners.clear();

    // shut down the broker
    await brokerServer.stop();
  });

  async function startWithDefaults() {
    startProbot();
    await startBroker();
    startRunners();
  }

  it('starts', async () => {
    await startWithDefaults();
    expect(brokerServer.brokerUrl).toStrictEqual(new URL(brokerUrl));
  });


  it('queues a bisect', async () => {
    const botCommentId = 1 as const;
    const issueNumber = 10 as const;
    const projectPath = '/repos/erickzhao/bugbot' as const;
    const issuePath = `${projectPath}/issues/${issueNumber}` as const;
    const botComment = { id: botCommentId, user: { login: `${process.env.BUGBOT_GITHUB_LOGIN}[bot]` } };
    ghNockScope = nock('https://api.github.com');
    ghNockScope
      .get(`${projectPath}/collaborators/erickzhao/permission`)
      .reply(200, { permission: 'admin' })
      .post(`${issuePath}/labels`).reply(200)
      .get(`${issuePath}/comments?per_page=100`).reply(200, []) // No comments yet...
      .post(`${issuePath}/comments`).reply(200, { id: botCommentId }) // ...so we create a new comment
      .delete(`${issuePath}/labels/bugbot%2Ftest-running`).reply(200)
      // ... task runs...
      .post(`${issuePath}/labels`).reply(200)
      // .get(`${issuePath}/comments?per_page=100`).reply(200, [botComment]) // Now, the comment from above should exist...
      .patch(`${projectPath}/issues/comments/${botCommentId}`).reply(200); // update the comment

    await startWithDefaults();
    await robot.receive({
      name: 'issue_comment',
      payload: bisectPayloadFixture,
    } as any);

    const tasks = broker.getTasks();
    expect(tasks.length).toBe(1);
    const result = expect.objectContaining({
      status: 'success',
      version_range: ['10.3.2', '10.4.0'],
    });
    expect(tasks[0]).toMatchObject({
      job: expect.objectContaining({
        gist: '59444f92bffd5730944a0de6d85067fd',
        history: [result],
        type: 'bisect',
        version_range: ['10.1.6', '11.0.2'],
        last: result,
      })
    });
  });
});
