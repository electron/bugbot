import { parseManualCommand } from '../src/github-client';
import {
  bisectFiddle,
  getCompleteJob,
  hasRunningTest,
  markAsComplete,
  stopTest,
} from '../src/runner-api';

jest.mock('../src/runner-api', () => ({
  bisectFiddle: jest.fn(),
  getCompleteJob: jest.fn(),
  hasRunningTest: jest.fn(),
  markAsComplete: jest.fn(),
  stopTest: jest.fn(),
}));

jest.mock('../../shared/lib/issue-parser', () => ({
  parseIssueBody: jest.fn(),
}));

describe('github-client', () => {
  describe('parseManualCommand()', () => {
    it('does nothing without a test command', () => {
      parseManualCommand({
        payload: {
          comment: {
            body: 'I am commenting!',
          },
        },
      });

      expect(bisectFiddle).not.toHaveBeenCalled();
    });

    it('stops a test job if one is running', () => {
      (hasRunningTest as jest.Mock).mockReturnValueOnce(true);

      parseManualCommand({
        payload: {
          comment: {
            body: '/test stop',
          },
          issue: {
            body: 'Test issue',
            id: 1234,
          },
        },
      });

      expect(stopTest).toHaveBeenCalled();
    });

    it('starts a bisect job if no tests are running for the issue', async () => {
      jest.useFakeTimers();
      (hasRunningTest as jest.Mock).mockReturnValueOnce(false);
      (getCompleteJob as jest.Mock).mockReturnValueOnce({});
      const createFakeComment = jest.fn();

      await parseManualCommand({
        issue: jest.fn(),
        octokit: {
          issues: {
            createComment: createFakeComment,
          },
        },
        payload: {
          comment: {
            body: '/test bisect',
          },
          issue: {
            body: 'Test Issue',
            id: 1234,
          },
        },
      });

      jest.runOnlyPendingTimers();
      expect(setInterval).toHaveBeenCalledTimes(1);
      expect(createFakeComment).toHaveBeenCalledTimes(1);
      expect(markAsComplete).toHaveBeenCalledTimes(1);
      expect(clearInterval).toHaveBeenCalledTimes(1);
    });

    it('starts a bisect job if no tests are running for the issue', async () => {
      jest.useFakeTimers();
      (hasRunningTest as jest.Mock).mockReturnValueOnce(false);
      (getCompleteJob as jest.Mock).mockReturnValueOnce({});
      const createFakeComment = jest.fn();

      await parseManualCommand({
        issue: jest.fn(),
        octokit: {
          issues: {
            createComment: createFakeComment,
          },
        },
        payload: {
          comment: {
            body: '/test bisect',
          },
          issue: {
            body: 'Test Issue',
            id: 1234,
          },
        },
      });

      jest.runOnlyPendingTimers();
      expect(setInterval).toHaveBeenCalledTimes(1);
      expect(getCompleteJob).toHaveBeenCalledTimes(1);
      expect(createFakeComment).toHaveBeenCalledTimes(1);
      expect(markAsComplete).toHaveBeenCalledTimes(1);
      expect(clearInterval).toHaveBeenCalledTimes(1);
    });

    it('continuously polls the bisect job until completion', async () => {
      jest.useFakeTimers();
      (hasRunningTest as jest.Mock).mockReturnValue(false);
      (getCompleteJob as jest.Mock)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce({});
      const createFakeComment = jest.fn();

      await parseManualCommand({
        issue: jest.fn(),
        octokit: {
          issues: {
            createComment: createFakeComment,
          },
        },
        payload: {
          comment: {
            body: '/test bisect',
          },
          issue: {
            body: 'Test Issue',
            id: 1234,
          },
        },
      });

      jest.runOnlyPendingTimers();
      jest.runOnlyPendingTimers();
      expect(setInterval).toHaveBeenCalledTimes(1);
      expect(getCompleteJob).toHaveBeenCalledTimes(2);
      expect(clearInterval).toHaveBeenCalledTimes(1);
    });

    it.todo('fails gracefully if the issue body cannot be parsed');
  });
});
