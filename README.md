# BugBot

## Overview

1. People [file Electron bug reports](https://github.com/electron/electron/issues/new/choose) with [tests](#by-bug-reporters).
1. BugBot can run the test on many platforms and Electron versions, then report back in-issue.
1. BugBot can bisect regressions down to a range of commits, then report back in-issue.
1. Users and maintainers can see where the bug is reproducible.

## Usage

### By bug reporters

BugBot only needs one thing: a test that exits with `exitCode` 0 if Electron works, or nonzero if Electron has a bug.

One easy way to make a test is with [Electron Fiddle](https://github.com/electron/fiddle). Its "File > New Test" has a [test template](https://github.com/electron/electron-quick-start/tree/test-template) with some [lightweight test helpers](https://github.com/electron/electron-quick-start/blob/test-template/preload.js) and its "Publish" button can upload the test to the [gist.github.com](https://gist.github.com/) [pastebin](https://en.wikipedia.org/wiki/Pastebin).

If you want to do it manually, the only requirement is that 0/1 `exitCode`. You can write it from scratch or use [electron-quick-start](https://github.com/electron/electron-quick-start)'s [`test-template` branch](https://github.com/electron/electron-quick-start/tree/test-template) as a starting point, which is the same template used by Electron Fiddle. You can clone it from the command line with `git clone --branch test-template https://github.com/electron/electron-quick-start`, then use a web browser to upload it to [gist.github.com](https://gist.github.com/).

After uploading your test to gist.github.com, file an [Electron bug report](https://github.com/electron/electron/issues/new/choose). The bug report template will ask for a "Testcase Gist URL", which is where you'll provide the Gist URL.

### By maintainers

Much like [trop](https://github.com/electron/trop/blob/master/docs/usage.md#using-trop), you can start BugBot with issue comments. To begin bisection, add a comment that looks like this:

```
/bugbot test [gist] [platforms...] [versions...]
```

- If no `gist` is given, use the issue body's `Testcase Gist URL`.
- If no `platforms` are given, test on Linux, macOS, and Windows.
- If no `versions` are given, test the first version and latest version of each prerelease branch, of [each supported branch](https://www.electronjs.org/docs/tutorial/support#supported-versions), and of the two branches before that.


```
/bugbot bisect [gist] [goodVersion [badVersion]]
```

- If no `gist` is given, use the issue body's `Testcase Gist URL`.
- If no `goodVersion` is given, use the issue body's `Last Known Working Electron Version` or an old version.
- If no `badVersion` is given, use the issue body's `Electron Version` or the latest release.

## Deployment

### Environment variables

| Name | Module | Description | Default |
|---|---|---|---|
| `BUGBOT_BROKER_CERT` or `BUGBOT_BROKER_CERT_PATH` | Required by Broker if `BUGBOT_BROKER_URL` is https | The data (or the path to it) to use as the `cert` option to [https.createServer()](https://nodejs.org/api/https.html#https_https_createserver_options_requestlistener). | None |
| `BUGBOT_BROKER_KEY` or `BUGBOT_BROKER_KEY_PATH` | Required by Broker if `BUGBOT_BROKER_URL` is https | The data (or the path to it) to use as the `key` option to [https.createServer()](https://nodejs.org/api/https.html#https_https_createserver_options_requestlistener). | None |
| `BUGBOT_BROKER_URL` | Required by all | The base URL for the broker, e.g. `https://bugbot.electronjs.org:8443`. | None |
| `BUGBOT_CHILD_TIMEOUT_MS` | Runner | When to cancel a hung child | 5 minutes |
| `BUGBOT_FIDDLE_EXEC` | Runner | Used to invoke electron-fiddle. This can include other space-delimited command-line arguments, e.g. `xvfb-run electron-fiddle` | '[which](https://github.com/npm/node-which) electron-fiddle' |
| `BUGBOT_POLL_INTERVAL_MS` | Issue Manager, Runner | How frequently to poll the Broker | issue-manager: 500 msec. runner: 20 sec |
| `BUGBOT_AUTH_TOKEN` | Required: Issue Manager, Runner; Optional: Broker | The auth token for communications with the Broker |
| `BUGBOT_GITHUB_LOGIN` | Issue Manager | The name of the GitHub app registered for the Probot client |
| `BUGBOT_LOG_METRICS_URL` | Broker | The remote Loki endpoint to send log metrics to |
| `BUGBOT_LOG_METRICS_AUTH` | Broker | The (`Basic`) auth credentials to authenticate log metrics requests with |

## Development

BugBot is split into multiple modules, connected in development via [Yarn Workspaces](https://classic.yarnpkg.com/en/docs/workspaces/) and [TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references.html). Each module can be found within the `modules/` top-level directory.

After cloning BugBot, run the following commands to set up your workspace:
```sh
$ yarn
$ yarn run build
```

**Note**: The latter command is required due to [a caveat with TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references.html#caveats-for-project-references) and will hopefully be remedied automatically in the future. If you don't run `yarn run build` then you may see errors in your editor for modules that have not been built (or are not up-to-date and need to be rebuilt).
