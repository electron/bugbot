import { parseManualCommand } from '../src/github-client';
import BrokerAPI from '../src/api-client';

jest.mock('../src/api-client');

jest.mock('../../shared/lib/issue-parser', () => ({
  parseIssueBody: jest.fn(),
}));

describe('github-client', () => {
  beforeEach(() => {
    // Clear all instances and calls to constructor and all methods:
    (BrokerAPI as jest.Mock).mockClear();
  });

  describe('parseManualCommand()', () => {
    it('does nothing without a test command', () => {
      parseManualCommand({
        payload: {
          comment: {
            body: 'I am commenting!',
          },
        },
      });

      const [apiInstance] = (BrokerAPI as jest.Mock).mock.instances;

      expect(apiInstance.getJob).not.toHaveBeenCalled();
    });

    it.todo('stops a test job if one is running');
    it.todo('starts a bisect job if no tests are running for the issue');
    it.todo('continuously polls the bisect job until completion');
    it.todo('fails gracefully if the issue body cannot be parsed');
  });
});
