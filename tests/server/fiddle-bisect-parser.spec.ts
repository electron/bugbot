import * as fs from 'fs';
import * as path from 'path';

import { FiddleBisectResult } from '../../src/interfaces';
import { parseFiddleBisectOutput } from '../../src/server/fiddle-bisect-parser';

describe('fiddle-bisect-parser', () => {
  function getBisectResult(basename: string) {
    const filename = path.resolve(__dirname, 'fixtures', basename);
    const output = fs.readFileSync(filename).toString();
    return parseFiddleBisectOutput(output) as FiddleBisectResult & {
      success: true;
    };
  }

  describe('parseFiddleBisectOutput()', () => {
    it('parses a success', () => {
      const result = getBisectResult('fiddle-bisect-output-success.txt');
      expect(result.success).toBe(true);
      expect(result.goodVersion).toBe('10.3.2');
      expect(result.badVersion).toBe('10.4.0');
    });

    it('parses a failure', () => {
      const result = getBisectResult('fiddle-bisect-output-failed.txt');
      expect(result.success).toBe(false);
      expect(result).not.toHaveProperty('goodVersion');
      expect(result).not.toHaveProperty('badVersion');
    });
  });
});
