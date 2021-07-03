process.env.BUGBOT_BROKER_URL = 'http://localhost:9099';
process.env.BUGBOT_AUTH_TOKEN = 'fake_token';

import { PartialDeep } from 'type-fest';
import nock from 'nock';
import { createProbot, Probot, ProbotOctokit } from 'probot';
import { IssueCommentCreatedEvent } from '@octokit/webhooks-types/schema';

import BrokerAPI from '../src/broker-client';
import { GithubClient } from '../src/github-client';
import payloadFixture from './fixtures/issue_comment.created.json';
import { BisectJob, Result } from '@electron/bugbot-shared/lib/interfaces';
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
  });

  afterEach(() => {
    ghclient.close();
  });

  describe('GithubClient', () => {
    function createBisectPayload({
      badVersion = '11.0.2',
      comment = '/test bisect',
      gistId = '59444f92bffd5730944a0de6d85067fd',
      goodVersion = '10.1.6',
      login = 'ckerr',
    } = {}) {
      const payload: PartialDeep<IssueCommentCreatedEvent> = {
        action: 'created',
        comment: {
          body: comment,
          user: {
            login,
          },
        },
        issue: {
          body: `### Electron Version\r\n\r\n${badVersion}\r\n\r\n### What operating system are you using?\r\n\r\nWindows\r\n\r\n### Operating System Version\r\n\r\n10\r\n\r\n### What arch are you using?\r\n\r\nx64\r\n\r\n### Last Known Working Electron Version\r\n\r\n${goodVersion}\r\n\r\n### Testcase Gist URL\r\n\r\n${gistId}`,
        },
      };
      return { badVersion, comment, gistId, goodVersion, login, payload };
    }

    describe('onIssueComment()', () => {
      it('starts a bisect job if no tests are running for the issue', async () => {
        const { badVersion, gistId, goodVersion, payload } =
          createBisectPayload();
        await robot.receive({ name: 'issue_comment', payload } as any);
        expect(mockQueueBisectJob).toHaveBeenCalledWith({
          badVersion,
          gistId,
          goodVersion,
        });
      });

      it.todo('stops a test job if one is running');

      describe('does nothing if', () => {
        it('...the comment does not have a command', async () => {
          const onIssueCommentSpy = jest.spyOn(ghclient, 'onIssueComment');
          const { payload } = createBisectPayload();
          payload.comment.body = 'This issue comment has no command';

          await robot.receive({ name: 'issue_comment', payload } as any);
          expect(onIssueCommentSpy).toHaveBeenCalledTimes(1);
          expect(mockQueueBisectJob).not.toHaveBeenCalled();
        });

        it('...the comment has an invalid command', async () => {
          const onIssueCommentSpy = jest.spyOn(ghclient, 'onIssueComment');
          const { payload } = createBisectPayload();
          payload.comment.body = '/test bisetc';

          await robot.receive({ name: 'issue_comment', payload } as any);
          expect(onIssueCommentSpy).toHaveBeenCalledTimes(1);
          expect(mockQueueBisectJob).not.toHaveBeenCalled();
        });

        it('...the commenter is not a maintainer', async () => {
          const onIssueCommentSpy = jest.spyOn(ghclient, 'onIssueComment');
          const { payload } = createBisectPayload();
          payload.comment.user.login = 'fnord';

          await robot.receive({ name: 'issue_comment', payload } as any);
          expect(onIssueCommentSpy).toHaveBeenCalledTimes(1);
          expect(mockQueueBisectJob).not.toHaveBeenCalled();
        });

        it('...the issue body has no gistId', async () => {
          const onIssueCommentSpy = jest.spyOn(ghclient, 'onIssueComment');
          const { payload } = createBisectPayload();
          payload.issue.body = 'This issue body has no gistId';

          await robot.receive({ name: 'issue_comment', payload } as any);
          expect(onIssueCommentSpy).toHaveBeenCalledTimes(1);
          expect(mockQueueBisectJob).not.toHaveBeenCalled();
        });
      });
    });

    describe('commentBisectResult()', () => {
      beforeEach(() => {
        nock.disableNetConnect();
      });

      afterEach(() => {
        nock.cleanAll();
        nock.enableNetConnect();
      });

      describe('comments and labels', () => {
        it('...on success', async (done) => {
          const mockSuccess: Result = {
            bisect_range: ['10.3.2', '10.4.0'],
            runner: 'my-runner-id',
            status: 'success',
            time_begun: 5,
            time_ended: 10,
          };
          const id = 'my-job-id';
          const mockJobRunning: BisectJob = {
            bisect_range: ['10.1.6', '11.0.2'],
            gist: 'my-gist-id',
            history: [],
            id,
            time_added: 5,
            type: 'bisect',
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

          // check for comment created
          nock('https://api.github.com')
            .post('/repos/erickzhao/bugbot/issues/10/comments', ({ body }) => {
              expect(body).toEqual(
                `It looks like this bug was introduced between ${mockSuccess.bisect_range[0]} and ${mockSuccess.bisect_range[1]}\n` +
                  '\n' +
                  `Commits between those versions: https://github.com/electron/electron/compare/v${mockSuccess.bisect_range[0]}...v${mockSuccess.bisect_range[1]}\n` +
                  '\n' +
                  `For more information, see ${process.env.BUGBOT_BROKER_URL}/log/${id}`,
              );
              return true;
            })
            .reply(200);

          // check for label deletion
          nock('https://api.github.com')
            .delete(
              '/repos/erickzhao/bugbot/issues/10/labels/bugbot%2Ftest-running',
              () => {
                done();
                return true;
              },
            )
            .reply(200);

          // check for label additions
          nock('https://api.github.com')
            .post('/repos/erickzhao/bugbot/issues/10/labels', ({ labels }) => {
              expect(labels).toEqual([Labels.Bug.Regression]);
              return true;
            })
            .reply(200);

          await robot.receive({
            name: 'issue_comment',
            payload: payloadFixture,
          } as any);

        });

        it('...on failure', async (done) => {
          const mockTestError: Result = {
            error: 'my-error',
            runner: 'my-runner-id',
            status: 'test_error',
            time_begun: 5,
            time_ended: 10,
          };
          const mockJob: BisectJob = {
            bisect_range: ['10.1.6', '11.0.2'],
            gist: 'my-gist-id',
            history: [mockTestError],
            id: 'my-job-id',
            last: mockTestError,
            time_added: 5,
            type: 'bisect',
          };

          mockQueueBisectJob.mockResolvedValueOnce(mockJob.id);
          mockGetJob.mockResolvedValueOnce(mockJob);

          // check for comment created
          nock('https://api.github.com')
            .post('/repos/erickzhao/bugbot/issues/10/comments', ({ body }) => {
              expect(body).toBe(
                `BugBot was unable to complete this bisection. Check the table’s links for more information.\n\n` +
                  'A maintainer in @wg-releases will need to look into this. When any issues are resolved, BugBot can be restarted by replacing the bugbot/maintainer-needed label with bugbot/test-needed.\n\n' +
                  `For more information, see ${brokerBaseUrl}/log/${mockJob.id}`,
              );
              return true;
            })
            .reply(200);

          // check for label deletion
          nock('https://api.github.com')
            .delete(
              '/repos/erickzhao/bugbot/issues/10/labels/bugbot%2Ftest-running',
              () => {
                done();
                return true;
              },
            )
            .reply(200);

          // check for label additions
          nock('https://api.github.com')
            .post('/repos/erickzhao/bugbot/issues/10/labels', ({ labels }) => {
              expect(labels).toEqual([Labels.BugBot.MaintainerNeeded]);
              return true;
            })
            .reply(200);

          await robot.receive({
            name: 'issue_comment',
            payload: payloadFixture,
          } as any);
        });
      });
    });
  });
});
