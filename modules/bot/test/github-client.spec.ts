process.env.BUGBOT_BROKER_URL = `http://localhost:9099`;

import { Context } from 'probot';
import { parseManualCommand } from '../src/github-client';
import BrokerAPI from '../src/api-client';
import fixture from './fixtures/issue_comment.created.json';
import { parseIssueBody } from '@electron/bugbot-shared/lib/issue-parser';

jest.mock('../src/api-client');

jest.mock('../../shared/lib/issue-parser', () => ({
  parseIssueBody: jest.fn(),
}));

describe('github-client', () => {
  const mockGetJob = jest.fn();
  const mockQueueBisectJob = jest.fn();
  const mockStopJob = jest.fn();

  beforeAll(() => {
    (BrokerAPI as jest.Mock).mockImplementation(() => {
      return {
        getJob: mockGetJob,
        queueBisectJob: mockQueueBisectJob,
        stopJob: mockStopJob,
      };
    });
  });

  beforeEach(() => {
    // Clear all instances and calls to constructor and all methods:
    (BrokerAPI as jest.Mock).mockClear();
  });

  describe('parseManualCommand()', () => {
    // lets us pass incomplete contexts to parseManualCommand()
    // without losing type safety
    function parseManualCommandWrapper(context: Partial<Context>) {
      return parseManualCommand(context as any as Context);
    }

    it('does nothing without a test command', async () => {
      await parseManualCommandWrapper({
        payload: {
          comment: {
            body: 'I am commenting!',
          },
        },
      });

      expect(mockGetJob).not.toHaveBeenCalled();
    });

    it('stops a test job if one is running', async () => {
      mockGetJob.mockResolvedValueOnce({});
      await parseManualCommandWrapper({
        payload: {
          comment: {
            body: '/test stop',
          },
        },
      });

      expect(mockGetJob).toHaveBeenCalled();
      expect(mockStopJob).toHaveBeenCalled();
    });

    it('starts a bisect job if no tests are running for the issue', async () => {
      const input = {
        badVersion: 'v10.1.6',
        gistId: '1abcdef',
        goodVersion: 'v11.0.2',
      };
      (parseIssueBody as jest.Mock).mockReturnValueOnce(input);

      await parseManualCommandWrapper({
        payload: fixture,
      });

      expect(mockQueueBisectJob).toHaveBeenCalledWith(input);
    });

    it('fails gracefully if the issue body cannot be parsed', async () => {
      (parseIssueBody as jest.Mock).mockImplementationOnce(() => {
        throw new Error();
      });
      await parseManualCommandWrapper({
        payload: fixture,
      });

      expect(mockQueueBisectJob).not.toHaveBeenCalled();
    });
  });
});
