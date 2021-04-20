export type FiddleBisectResult =
  | { success: false }
  | {
      success: true;
      goodVersion: string;
      badVersion: string;
    };

export function parseFiddleBisectOutput(stdout: string): FiddleBisectResult {
  // In an attempt to guard against any output from the fiddles, only take the
  // last few lines of the output to parse
  const OUTPUT_END_LINES = 8;
  const endOutput = stdout
    .split('\n')
    .splice(-OUTPUT_END_LINES, OUTPUT_END_LINES)
    .join('\n');

  // There should be an output line at the end that looks like this:
  //
  //     [TIMESTAMP] Task: Bisect  success
  //
  // Try to find that first to see if it says "success" or "invalid"
  const bisectTaskResult = endOutput.match(
    /Task: Bisect {2}(success|invalid)\s*$/,
  );

  if (bisectTaskResult === null) {
    // TODO: this may start to always happen if the output changes in the
    // future, but that is also just part of the fragility of parsing the
    // output.
    throw new Error('Cannot find bisect task result in fiddle output');
  }

  const success = bisectTaskResult[1] === 'success';

  // If we failed, we're done
  if (!success) {
    return { success };
  }

  // Try to parse out the final bisect versions
  const passedVersion = endOutput.match(
    /Runner: autobisect ✅ passed (\d+\.\d+\.\d+)/,
  );
  const failedVersion = endOutput.match(
    /Runner: autobisect ❌ failed (\d+\.\d+\.\d+)/,
  );

  if (passedVersion === null || failedVersion === null) {
    throw new Error('Cannot find bisect task final version(s)');
  }

  return {
    badVersion: failedVersion[1],
    goodVersion: passedVersion[1],
    success,
  };
}
