import {
  FiddleBisectResult,
  parseFiddleBisectOutput,
} from '../src/server/fiddle-bisect-parser';
import * as fs from 'fs';

describe('fiddle-bisect-parser', () => {
  describe('parseFiddleBisectOutput()', () => {
    it('parses a success', () => {
      const output = fs
        .readFileSync('./spec/fixtures/fiddle-bisect-output-success.txt')
        .toString();
      const result = parseFiddleBisectOutput(output) as FiddleBisectResult & {
        success: true;
      };

      expect(result.success).toBe(true);
      expect(result.goodVersion).toBe('10.3.2');
      expect(result.badVersion).toBe('10.4.0');
    });

    it('parses a failure', () => {
      const output = fs
        .readFileSync('./spec/fixtures/fiddle-bisect-output-failed.txt')
        .toString();
      const result = parseFiddleBisectOutput(output) as FiddleBisectResult & {
        success: false;
      };

      expect(result.success).toBe(false);
      expect(result).not.toHaveProperty('goodVersion');
      expect(result).not.toHaveProperty('badVersion');
    });
  });
});
