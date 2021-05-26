import { parseManualCommand } from '../src/github-client';
import { bisectFiddle, hasRunningTest, stopTest } from '../src/runner-api';

jest.mock('../src/runner-api', () => ({
  bisectFiddle: jest.fn(),
  hasRunningTest: jest.fn(),
  stopTest: jest.fn(),
}));

describe('github-client', () => {
  // eslint-disable-next-line
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

    it('stops a test if one is running', () => {
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

    it('stops a test if one is running', () => {
      parseManualCommand({
        payload: {
          comment: {
            body: '/test bisect',
          },
          issue: {
            body: 'Test issue',
            id: 1234,
          },
        },
      });
    });
  });
});
