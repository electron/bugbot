# BugBot

## Development

BugBot is split into multiple modules, connected in development via [Yarn Workspaces](https://classic.yarnpkg.com/en/docs/workspaces/) and [TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references.html). Each module can be found within the `modules/` top-level directory.

After cloning BugBot, run the following commands to set up your workspace:
```sh
$ yarn
$ yarn run build
```

**Note**: The latter command is required due to [a caveat with TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references.html#caveats-for-project-references) and will hopefully be remedied automatically in the future. If you don't run `yarn run build` then you may see errors in your editor for modules that have not been built (or are not up-to-date and need to be rebuilt).

## Running BugBot

### Envionment variables

| Name | Module | Description | Default |
|---|---|---|---|
| `BUGBOT_BROKER_CERT` or `BUGBOT_BROKER_CERT_PATH` | Required by Broker if `BUGBOT_BROKER_URL` is https | The data (or the path to it) to use as the `cert` option to [https.createServer()](https://nodejs.org/api/https.html#https_https_createserver_options_requestlistener). | None |
| `BUGBOT_BROKER_KEY` or `BUGBOT_BROKER_KEY_PATH` | Required by Broker if `BUGBOT_BROKER_URL` is https | The data (or the path to it) to use as the `key` option to [https.createServer()](https://nodejs.org/api/https.html#https_https_createserver_options_requestlistener). | None |
| `BUGBOT_BROKER_URL` | Required by all | The base URL for the broker, e.g. `https://bugbot.electronjs.org:8443`. | None |
| `BUGBOT_CHILD_TIMEOUT_MS` | Runner | When to cancel a hung child | 5 minutes |
| `BUGBOT_FIDDLE_EXEC` | Runner | Used to invoke electron-fiddle. This can include other space-delimited command-line arguments, e.g. `xvfb-run electron-fiddle` | '[which](https://github.com/npm/node-which) electron-fiddle' |
| `BUGBOT_POLL_INTERVAL_MS` | Bot, Runner | How frequently to poll the Broker | 20 seconds |

