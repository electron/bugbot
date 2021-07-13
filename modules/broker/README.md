# Broker Routes

| Path | Method | Description |
|---|---|---|
| [`/api/jobs/$job_id`](#apijobsjob_id-GET) | GET | Get a job's status. |
| [`/api/jobs/$job_id/log`](#FIXME) | PUT | Append runner console.log lines. Called by the Runner. |
| [`/api/jobs/$job_id`](#apijobsjob_id-PATCH) | PATCH | Modify a job (e.g. Runner claims a job or sets a result, Probot client changes bot_client_data) |
| [`/api/jobs?`](#apijobs-GET) | GET  | Query jobs |
| [`/api/jobs`](#apijobs-POST) | POST | Create new job.  Posted by the Probot client. |
| [`/log/$job_id?`](#logjob_id-GET) | GET | Shows a job's activity |

## /api/jobs/$job_id (GET)

Payload is a JSON object that contains

| Name | Datatype | Job | Mutability | Description |
|---|---|---|---|---|
| version_range | VersionRange | bisect | readonly | The starting bisection range |
| bot_client_data | any | all | | opaque data structure only used by the Probot bot
| current? | { runner, time_begun } | all | | Subset of a Result. Exists if there is a current runner |
| gist | string | all | readonly | Hex string identifying a GitHub gist |
| history | Result[] | all | | the results of one or more runner sessions |
| id | string | all | readonly | UUID of the job |
| last? | Result | all | | Result of the last Runner session |
| platform? | Platform | all | readonly | platform the test should run on, or undefined if not platform-specific |
| time_added | number | all | readonly| epoch_msec of when the job was created |
| type | Type | all | readonly | the job type |
| version | string | test | readonly | The version of Electron to test the gist with |

### Types

* VersionRange: `Version[2]`
* Platform: `['darwin' | 'linux' | 'win32']`
* Result:
  | Name | Datatype | Job | Description |
  |---|---|---|---|
  | version_range? | VersionRange | bisect | The ending bisection range |
  | error? | string | all | Human-readable error message |
  | runner | string | all | UUID of the runner |
  | status | Status | all | Outcome of a Runner session |
  | time_begun | number | all | epoch msec of when the test start time |
  | time_ended | number | all | epoch_msec of when the test finish time |
* Status: `['failure' | 'success' | 'system_error' | 'test_error']`
    * `'failure'` If the fiddle ran and failed
    * `'success'` If the fiddle ran and passed, or if a bisection completed
    * `'system_error'` If the job failed due to an issue that likely needs intervention by a maintainer, e.g. electron-fiddle was unable to launch
    * `'test_error'` If the job failed due to an issue that likely needs intervention by the bug reporter, e.g. it ran too long and the Runner had to kill it, or bisection failed due to both ends of the bisect range returning the same result
* Type: `['bisect' | 'test']`
* Version: a `string` which is valid [semver](https://semver.org/).


## /api/jobs/$job_id (PATCH)

A [JSON Patch](http://jsonpatch.com/) that Runners and the Probot client can use to modify a job.

Returns:
* 200 on success
* 409 if the patch would conflict, e.g. if there was a race between Runners to claim a job and another claimed it first

### Examples

#### How a Runner could claim a job:

```js=
ops = [
  {
    op: 'replace',
    path: '/current',
    value: {
      runner: ${runner_uuid},
      time_started: Date.now(),
    },
  },
]
```

#### How a Runner could report a finished task:

```js=
const result: Result = ...;

ops = [
  { op: 'add', path: '/history/-', value: result },
  { op: 'replace', path: '/last', value: result },
  { op: 'remove', path: '/current' },
]
```

## /api/jobs? (GET)

Get a list of jobs. Payload is a JSON array job ids.

### Search conventions

- `.` in a query key denotes an object subtree
- `,` in a query value delimits multiple values
- a query value of `undefined` matches undefined values
- a query key ending in `!` negates the filter

### Examples

- `foo=bar`          - `job[foo] == bar`
- `foo!=bar`         - `job[foo] != bar`
- `foo=undefined`    - `job[foo] === undefined`
- `foo=bar,baz`      - `job[foo] == bar || job[foo] == baz`
- `foo.bar=baz`      - `job[foo][bar] == baz`
- `foo!=undefined`   - `job[foo] != undefined`
- `foo!=bar,baz`     - `job[foo] != bar && job[foo] != baz`
- `foo.bar=baz,qux`  - `job[foo][bar] == baz || job[foo][bar] == qux`
- `foo.bar!=baz,qux` - `job[foo][bar] != baz && job[foo][bar] != qux`

#### How a Runner could search for unclaimed jobs:

```=
/api/jobs?platform=linux,undefined&current.runner=undefined&last.result=undefined
```

Rationale:
* `platform=linux,undefined` matches jobs can run on linux.
* `current.runner=undefined` matches jobs that are not claimed.
* `last.result=undefined` matches jobs that have not finished.

#### How the Probot Client could look for issues needing a result comment:

1. Only the Probot Client uses `bot_client_data` and it can inject any value it likes. This is implementation-depdenent on the bot module.
2. As an example, the Probot Client *could* use `{ issue: number, result_commented: boolean }` by patching a job's `/bot_client_data` to `{ issue: 123456, result_commented: false }`
3. If it used that approach, it could query on:

```=
/api/jobs?last.result!=undefined&bot_client_data.result_commented!=true
```

Rationale:
* `last.result!=undefined` matches jobs that have finished
* `bot_client_data.commented!=true` matches jobs that do not yet have a comment

## /api/jobs (POST)

### Params
* {string} gist - Hex string identifying a GitHub gist.
* {string} type - ['bisect' | 'test']
* {any} [bot_client_data] - Optional data defined by Probot Client.
* {string} [first] - A version of Electron where the bug is not present, i.e. first version to bisecting with. Required for bisect types.
* {string} [last] - A version of Electron where the bug **is** present, i.e. last version to bisect with. Required for bisect types.
* {string} [platform] - ['darwin' | 'linux' | 'win32']. Omitted if the task is not platform-dependent.

### Returns
* 201 if job created.
* 422 on error, e.g. missing gist


## /log/$job_id? (GET)

Get a job's activity log.
