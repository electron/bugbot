process.env.BUGBOT_BROKER_URL = 'http://localhost:9099';
process.env.BUGBOT_GITHUB_LOGIN = 'erick-bugbot';
process.env.BUGBOT_AUTH_TOKEN = 'fake_token';

import nock, { Scope } from 'nock';
import { createProbot, Probot, ProbotOctokit } from 'probot';

import BrokerAPI from '../src/broker-client';
import { GithubClient } from '../src/github-client';
import payloadFixture from './fixtures/issue_comment.created.bisect.json';
import {
  BisectJob,
  JobType,
  Result,
} from '@electron/bugbot-shared/build/interfaces';
import { Labels } from '../src/github-labels';

jest.mock('../src/broker-client');

describe('github-client', () => {
  const authToken = process.env.BUGBOT_AUTH_TOKEN;
  const brokerBaseUrl = process.env.BUGBOT_BROKER_URL;
  const pollIntervalMs = 10;

  let ghclient: GithubClient;
  let mockCompleteJob: jest.Mock;
  let mockGetJob: jest.Mock;
  let mockQueueBisectJob: jest.Mock;
  let mockStopJob: jest.Mock;
  let robot: Probot;
  let nockScope: Scope;

  beforeEach(() => {
    mockCompleteJob = jest.fn();
    mockGetJob = jest.fn();
    mockStopJob = jest.fn();
    mockQueueBisectJob = jest.fn();
    (BrokerAPI as jest.Mock).mockImplementation(() => {
      return {
        completeJob: mockCompleteJob,
        getJob: mockGetJob,
        queueBisectJob: mockQueueBisectJob,
        stopJob: mockStopJob,
      };
    });

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
      brokerBaseUrl,
      pollIntervalMs,
      robot,
    });

    nock.disableNetConnect();
  });

  afterEach(() => {
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
  });

  describe('GithubClient', () => {
    describe('on `/test bisect` command', () => {
      beforeEach(() => {
        nockScope = nock('https://api.github.com');
        nockScope
          .get('/repos/erickzhao/bugbot/collaborators/erickzhao/permission')
          .reply(200, {
            permission: 'admin',
          });
      });
      it('queues a bisect job and comments the result', async () => {
        const mockSuccess: Result = {
          runner: 'my-runner-id',
          status: 'success',
          time_begun: 5,
          time_ended: 10,
          version_range: ['10.3.2', '10.4.0'],
        };
        const id = 'my-job-id';
        const mockJobRunning: BisectJob = {
          gist: 'my-gist-id',
          history: [],
          id,
          time_added: 5,
          type: JobType.bisect,
          version_range: ['10.1.6', '11.0.2'],
        };
        const mockJobDone: BisectJob = {
          ...mockJobRunning,
          history: [mockSuccess],
          last: mockSuccess,
        };
        mockQueueBisectJob.mockResolvedValue(id);
        mockGetJob
          .mockResolvedValueOnce(mockJobRunning)
          .mockResolvedValueOnce(mockJobDone);

        nockScope
          // No comments yet...
          .get('/repos/erickzhao/bugbot/issues/10/comments?per_page=100')
          .reply(200, [])

          // ...so we create a new comment
          .post('/repos/erickzhao/bugbot/issues/10/comments', ({ body }) => {
            expect(body).toEqual('Queuing bisect job...');
            return true;
          })
          .reply(200)

          // Add bugbot/test-running label
          .post('/repos/erickzhao/bugbot/issues/10/labels', ({ labels }) => {
            expect(labels).toEqual([Labels.BugBot.Running]);
            return true;
          })
          .reply(200)

          // Now, the comment from above should exist...
          .get('/repos/erickzhao/bugbot/issues/10/comments?per_page=100')
          .reply(200, [
            {
              id: 1,
              user: { login: `${process.env.BUGBOT_GITHUB_LOGIN}[bot]` },
            },
          ])

          // ...so we update it with the bisect info.
          .patch('/repos/erickzhao/bugbot/issues/comments/1', ({ body }) => {
            const [v1, v2] = mockSuccess.version_range;
            expect(body).toEqual(
              `It looks like this bug was introduced between ${v1} and ${v2}\n` +
                '\n' +
                `Commits between those versions: https://github.com/electron/electron/compare/v${v1}...v${v2}\n` +
                '\n' +
                `For more information, see ${process.env.BUGBOT_BROKER_URL}/log/${id}`,
            );
            return true;
          })
          .reply(200)

          // delete the `bugbot/test-running` label and add `bug/regression`
          .delete(
            '/repos/erickzhao/bugbot/issues/10/labels/bugbot%2Ftest-running',
            () => true,
          )
          .reply(200)
          .post('/repos/erickzhao/bugbot/issues/10/labels', ({ labels }) => {
            expect(labels).toEqual([Labels.Bug.Regression]);
            return true;
          })
          .reply(200);

        await robot.receive({
          name: 'issue_comment',
          payload: payloadFixture,
        } as any);

        expect(mockCompleteJob).toHaveBeenCalledWith(id);
      });

      it('handles failures gracefully', async () => {
        const mockTestError: Result = {
          error: 'my-error',
          runner: 'my-runner-id',
          status: 'test_error',
          time_begun: 5,
          time_ended: 10,
        };
        const mockJob: BisectJob = {
          gist: 'my-gist-id',
          history: [mockTestError],
          id: 'my-job-id',
          last: mockTestError,
          time_added: 5,
          type: JobType.bisect,
          version_range: ['10.1.6', '11.0.2'],
        };

        mockQueueBisectJob.mockResolvedValueOnce(mockJob.id);
        mockGetJob.mockResolvedValueOnce(mockJob);

        nockScope
          // No comments yet...
          .get('/repos/erickzhao/bugbot/issues/10/comments?per_page=100')
          .reply(200, [])

          // ...so we create a new comment
          .post('/repos/erickzhao/bugbot/issues/10/comments', ({ body }) => {
            expect(body).toEqual('Queuing bisect job...');
            return true;
          })
          .reply(200)

          // Add bugbot/test-running label
          .post('/repos/erickzhao/bugbot/issues/10/labels', ({ labels }) => {
            expect(labels).toEqual([Labels.BugBot.Running]);
            return true;
          })
          .reply(200)

          // Now, the comment from above should exist...
          .get('/repos/erickzhao/bugbot/issues/10/comments?per_page=100')
          .reply(200, [
            {
              id: 1,
              user: { login: `${process.env.BUGBOT_GITHUB_LOGIN}[bot]` },
            },
          ])
          // ...so we update the comment with an error message.
          .patch('/repos/erickzhao/bugbot/issues/comments/1', ({ body }) => {
            expect(body).toBe(
              `BugBot was unable to complete this bisection. Check the table’s links for more information.\n\n` +
                'A maintainer in @wg-releases will need to look into this. When any issues are resolved, BugBot can be restarted by replacing the bugbot/maintainer-needed label with bugbot/test-needed.\n\n' +
                `For more information, see ${brokerBaseUrl}/log/${mockJob.id}`,
            );
            return true;
          })
          .reply(200)

          // delete the `bugbot/test-running` label and add `bugbot/maintainer-needed`
          .delete(
            '/repos/erickzhao/bugbot/issues/10/labels/bugbot%2Ftest-running',
            () => true,
          )
          .reply(200)
          .post('/repos/erickzhao/bugbot/issues/10/labels', ({ labels }) => {
            expect(labels).toEqual([Labels.BugBot.MaintainerNeeded]);
            return true;
          })
          .reply(200);

        await robot.receive({
          name: 'issue_comment',
          payload: payloadFixture,
        } as any);

        expect(mockCompleteJob).toHaveBeenCalledWith(mockJob.id);
      });

      it.todo('stops a test job if one is running');

      describe('does nothing if', () => {
        it('...the comment does not have a command', async () => {
          const onIssueCommentSpy = jest.spyOn(ghclient, 'onIssueComment');
          const noCommandFixture = JSON.parse(JSON.stringify(payloadFixture));
          noCommandFixture.comment.body = 'This issue comment has no command';

          await robot.receive({
            name: 'issue_comment',
            payload: noCommandFixture,
          } as any);
          expect(onIssueCommentSpy).toHaveBeenCalledTimes(1);
          expect(mockQueueBisectJob).not.toHaveBeenCalled();
        });

        it('...the comment has an invalid command', async () => {
          const onIssueCommentSpy = jest.spyOn(ghclient, 'onIssueComment');
          const invalidCommandFixture = JSON.parse(
            JSON.stringify(payloadFixture),
          );
          invalidCommandFixture.comment.body = '/test bisetc';

          await robot.receive({
            name: 'issue_comment',
            payload: invalidCommandFixture,
          } as any);
          expect(onIssueCommentSpy).toHaveBeenCalledTimes(1);
          expect(mockQueueBisectJob).not.toHaveBeenCalled();
        });

        it('...the commenter is not a maintainer', async () => {
          // remove existing valid maintainer mock
          const interceptor = nockScope.get(
            '/repos/erickzhao/bugbot/collaborators/erickzhao/permission',
          );
          nock.removeInterceptor(interceptor);

          // mock invalid maintainer
          nockScope
            .get('/repos/erickzhao/bugbot/collaborators/fnord/permission')
            .reply(200, {
              permissions: 'none',
            });
          const onIssueCommentSpy = jest.spyOn(ghclient, 'onIssueComment');
          const unauthorizedUserFixture = JSON.parse(
            JSON.stringify(payloadFixture),
          );
          unauthorizedUserFixture.comment.user.login = 'fnord';

          await robot.receive({
            name: 'issue_comment',
            payload: unauthorizedUserFixture,
          } as any);
          expect(onIssueCommentSpy).toHaveBeenCalledTimes(1);
          expect(mockQueueBisectJob).not.toHaveBeenCalled();
        });
      });
    });
  });
});
