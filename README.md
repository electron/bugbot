# BugBot

## Development

BugBot is split into multiple modules, connected in development via [Yarn Workspaces](https://classic.yarnpkg.com/en/docs/workspaces/) and [TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references.html). Each module can be found within the `modules/` top-level directory.

After cloning BugBot, run the following commands to setup your workspace:
```sh
$ yarn
$ yarn run build
```

**Note**: The latter command is required due to [a caveat with TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references.html#caveats-for-project-references) and will hopefully be remedied automatically in the future. If you don't run `yarn run build` then you may see errors in your editor for modules that have not been built (or are not up-to-date and need to be rebuilt).
