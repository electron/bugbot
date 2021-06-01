export const Labels = {
  Blocked: {
    NeedRepro: 'blocked/need-repro',
  },
  Bug: {
    Regression: 'bug/regression',
  },
  BugBot: {
    MaintainerNeeded: 'bugbot/maintainer-needed',
    Running: 'bugbot/test-running',
    TestNeeded: 'bugbot/test-needed',
  },
  Platform: {
    all: 'platform/all',
    darwin: 'platform/macOS',
    linux: 'platform/linux',
    win32: 'platform/windows',
  },
} as const;
