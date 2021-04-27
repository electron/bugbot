import {
  Label,
  createCommentTask,
  createRemoveLabelsTask,
} from '../../src/client/tasks';
import { runTasks } from '../../src/client/run-tasks';

const OWNER = 'electron';
const REPO = 'electron';
const ISSUE_NUMBER = 1;

class OctokitMock {
  public rest = {
    issues: {
      addLabels: jest.fn(),
      createComment: jest.fn(),
      listLabelsOnIssue: jest.fn().mockReturnValue({
        data: [{ name: Label.bisectNeeded }],
      }),
      setLabels: jest.fn(),
    },
  };
  public readonly issues;
  constructor() {
    this.issues = this.rest.issues;
  }
}

class ContextMock {
  readonly owner: string;
  readonly repo: string;
  public issue_number = ISSUE_NUMBER;

  constructor(owner = OWNER, repo = REPO) {
    this.owner = owner;
    this.repo = repo;
  }

  public issue(o = {}) {
    const { issue_number, owner, repo } = this;
    return { issue_number, owner, repo, ...o };
  }

  public octokit = new OctokitMock();
}

describe('runTasks', () => {
  let context: ContextMock;

  beforeEach(() => {
    context = new ContextMock();
  });

  it('can add a comment', async () => {
    const body = 'this is the comment body';
    const task = createCommentTask(body);
    await runTasks([task], context);
    expect(context.octokit.issues.createComment).toHaveBeenCalledWith(
      context.issue({ body }),
    );
  });

  it('can remove labels', async () => {
    const labels = new Set<string>([Label.bisectNeeded, Label.bisectDone]);
    context.octokit.issues.listLabelsOnIssue.mockReturnValue({
      data: [...labels].map((name) => ({ name })),
    });
    const removeMe = [Label.bisectDone];
    const task = createRemoveLabelsTask(...removeMe);
    for (const label of removeMe) {
      labels.delete(label)
    }
    await runTasks([task], context);
    expect(context.octokit.issues.setLabels).toHaveBeenCalledWith(
      context.issue({ labels })
    );
  });
});
