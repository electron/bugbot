import express = require('express');
import { execFile } from 'child_process';
import { parseFiddleBisectOutput } from './fiddle-bisect-parser';
import * as SemVer from 'semver';

/**
 * This is the path to the fiddle executable. This is read from the environment
 * variable named `FIDDLE_EXEC_PATH`.
 */
const { FIDDLE_EXEC_PATH } = process.env;
if (!FIDDLE_EXEC_PATH) {
  // Just to make it more visible
  console.error('`FIDDLE_EXEC_PATH` env variable is unset!');
}

/**
 * The same as `Object.prototype.hasOwnProperty`.
 */
function objHasOwnKey(target: any, key: keyof any): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

const app = express();

app.use(express.json());

app.post('/fiddle/bisect', (req, res) => {
  // Ensure an object-like body was parsed for this request
  if (!req.body || typeof req.body !== 'object') {
    res.status(400).end('missing request body');
    return;
  }

  // Duck-type the request body to make sure it looks like a fiddle request
  if (
    !objHasOwnKey(req.body, 'goodVersion') ||
    typeof req.body.goodVersion !== 'string'
  ) {
    res.status(400).end('missing or incorrect parameter "goodVersion"');
    return;
  }
  if (
    !objHasOwnKey(req.body, 'badVersion') ||
    typeof req.body.goodVersion !== 'string'
  ) {
    res.status(400).end('missing or incorrect parameter "goodVersion"');
    return;
  }
  if (
    !objHasOwnKey(req.body, 'gistId') ||
    typeof req.body.goodVersion !== 'string'
  ) {
    res.status(400).end('missing or incorrect parameter "goodVersion"');
    return;
  }

  // Ensure that the versions are valid semver and that they were passed as
  // valid versions too
  const goodVersion = SemVer.valid(req.body.goodVersion);
  if (goodVersion !== req.body.goodVersion) {
    res.status(400).end('invalid goodVersion');
    return;
  }

  const badVersion = SemVer.valid(req.body.badVersion);
  if (badVersion !== req.body.badVersion) {
    res.status(400).end('invalid badVersion');
    return;
  }

  // The gist ID is expected to just be the ID
  const { gistId } = req.body;
  if (gistId.length !== 32 || !/^[0-9a-f]{32}$/i.test(gistId)) {
    res.status(400).end('invalid gist ID');
    return;
  }

  // Run fiddle with the given parameters an pipe the response back to the
  // request
  execFile(
    FIDDLE_EXEC_PATH as string,
    ['bisect', goodVersion, badVersion, '--fiddle', gistId] as string[],
    (err, stdout, stderr) => {
      if (err !== null) {
        console.log('failed fiddle stdout:\n', stdout);
        console.log('failed fiddle stderr:\n', stderr);
        res.status(400).end('fiddle failed to run');
        return;
      }

      // Parse fiddle's output and pass it back to the request
      const result = parseFiddleBisectOutput(stdout);
      res
        .status(200)
        .header('Content-Type', 'application/json')
        .end(JSON.stringify(result));
    },
  );
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`listening for requests on port ${PORT}`);
});
