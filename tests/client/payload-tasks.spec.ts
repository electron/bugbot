import * as fs from 'fs';
import * as path from 'path';

import { TaskType, TestOptions, createTestTask } from '../../src/client/tasks';
import { getTasksFromPayload } from '../../src/client/payload-tasks';

function getFixturePayload(fixture: string) {
  const filename = path.resolve(__dirname, 'fixtures', fixture);
  return JSON.parse(fs.readFileSync(filename).toString());
}

function getTasks(fixture: string) {
  return getTasksFromPayload(getFixturePayload(fixture));
}

describe('planner', () => {
  const badVersion = '12.0.0';
  const gistId = '8c5fc0c6a5153d49b5a4a56d3ed9da8f';

  describe('generates bisect tasks', () => {
    const expectedBisectTask = {
      bisect: {
        badVersion,
        gistId,
        goodVersion: '11.0.0',
      },
      type: TaskType.bisect,
    };

    function expectBisectTask(fixture: string) {
      const tasks = getTasks(fixture);
      expect(tasks).toEqual(expect.arrayContaining([expectedBisectTask]));
    }

    it('from labels', () => {
      expectBisectTask('payload-new-label-bisect-needed.json');
    });

    it('from new issues', () => {
      expectBisectTask('payload-new-issue-opened.json');
    });
  });

  describe('generates test tasks', () => {
    const opts: TestOptions = { badVersion, gistId };
    const expectedTasks = createTestTask(opts);

    function expectBisectTask(fixture: string) {
      const tasks = getTasks(fixture);
      expect(tasks).toEqual(expect.arrayContaining([expectedTasks]));
    }

    it('from labels', () => {
      expectBisectTask('payload-new-label-test-needed.json');
    });
  });
});
