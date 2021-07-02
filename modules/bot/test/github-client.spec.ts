process.env.BUGBOT_BROKER_URL = 'http://localhost:9099';
process.env.BUGBOT_AUTH_TOKEN = 'fake_token';

import { PartialDeep } from 'type-fest';
import { createProbot, Context, Probot, ProbotOctokit } from 'probot';
import {
  Issue,
  IssueComment,
  IssueCommentCreatedEvent,
  User,
} from '@octokit/webhooks-types/schema';

import { GithubClient } from '../src/github-client';
import BrokerAPI from '../src/api-client';

import { parseIssueBody } from '@electron/bugbot-shared/lib/issue-parser';

jest.mock('../src/api-client');

describe('github-client', () => {
  let ghclient: GithubClient;
  let mockGetJob: jest.Mock;
  let mockQueueBisectJob: jest.Mock;
  let mockStopJob: jest.Mock;
  let probot: Probot;

  beforeEach(() => {
    mockGetJob = jest.fn();
    mockStopJob = jest.fn();
    mockQueueBisectJob = jest.fn();
    (BrokerAPI as jest.Mock).mockImplementation(() => {
      return {
        getJob: mockGetJob,
        queueBisectJob: mockQueueBisectJob,
        stopJob: mockStopJob,
      };
    });

    probot = createProbot({
      overrides: {
        Octokit: ProbotOctokit.defaults({
          retry: { enabled: false },
          throttle: { enabled: false },
        }),
        githubToken: 'test',
      },
    });

    ghclient = new GithubClient(probot);
  });

  describe('GithubClient', () => {
    function createBisectPayload({
      badVersion = '11.0.2',
      comment = '/test bisect',
      gistId = '59444f92bffd5730944a0de6d85067fd',
      goodVersion ='10.1.6',
      login = 'ckerr',
    } = {}) {
      const payload: PartialDeep<IssueCommentCreatedEvent> = {
        action: 'created',
        comment: {
          body: comment,
          user: {
            login: login,
          },
        },
        issue: {
          body: `### Electron Version\r\n\r\n${badVersion}\r\n\r\n### What operating system are you using?\r\n\r\nWindows\r\n\r\n### Operating System Version\r\n\r\n10\r\n\r\n### What arch are you using?\r\n\r\nx64\r\n\r\n### Last Known Working Electron Version\r\n\r\n${goodVersion}\r\n\r\n### Testcase Gist URL\r\n\r\n${gistId}`,
        },
      };
      return { badVersion, comment, gistId, goodVersion, login, payload };
    }

    describe('onIssueCommentCreated()', () => {
      it('starts a bisect job if no tests are running for the issue', async () => {
        const { badVersion, gistId, goodVersion, payload } = createBisectPayload();
        await probot.receive({ name: 'issue_comment', payload } as any);
        expect(mockQueueBisectJob).toHaveBeenCalledWith({ badVersion, gistId, goodVersion });
      });

      it('does nothing without a test command', async () => {
        const { payload } = createBisectPayload();
        payload.comment.body = 'This issue comment has no command';
        await probot.receive({ name: 'issue_comment', payload } as any);
        expect(mockQueueBisectJob).not.toHaveBeenCalled();
      });

      it.todo('stops a test job if one is running');

      it('does nothing without a parseable issue body', async () => {
        const { payload } = createBisectPayload();
        payload.issue.body = 'This issue body has no gistId';
        await probot.receive({ name: 'issue_comment', payload } as any);
        expect(mockQueueBisectJob).not.toHaveBeenCalled();
      });
    });
  });
});
