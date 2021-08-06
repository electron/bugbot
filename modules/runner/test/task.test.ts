import { Task } from '../src/task';

describe('Task', () => {
  describe('claimForRunner()', () => {
    it.todo('tries to patch the job on the broker');
    it.todo('sends an etag in its header');
    it.todo('returns true if the patch succeeded');
    it.todo('returns false if the patch failed');
  });

  describe('sendResult()', () => {
    it.todo('appends job.history with the result');
    it.todo('assigns job.last with the result');
    it.todo('unsets job.current to indicate no current runner');
    it.todo('sends an etag in its header');
    it.todo('returns true if the patch succeeded');
    it.todo('returns false if the patch false');
  });

  describe('addLogData()', () => {
    it.todo('eventually is sent to the broker');
  });
});
