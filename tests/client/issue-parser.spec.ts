import * as SemVer from 'semver';
import * as fs from 'fs';
import * as path from 'path';

import { getBisectOptionsFromBody } from '../../src/util/issue-parser';

describe('issue-parser', () => {
  describe('getBisectOptionsFromBody()', () => {
    function getIssueBody(basename: string) {
      const filename = path.resolve(__dirname, 'fixtures', basename);
      return fs.readFileSync(filename).toString();
    }

    function expectValidRegressionReport(body: string) {
      const opts = getBisectOptionsFromBody(body);
      expect(opts).toBeTruthy();
      const { goodVersion, badVersion, gistId } = opts!;
      expect(SemVer.valid(goodVersion)).toBe('13.0.0');
      expect(SemVer.valid(badVersion)).toBe('12.0.0');
      expect(typeof gistId).toBe('string');
    }

    function expectUndefinedBisect(name: string) {
      expect(getBisectOptionsFromBody(getIssueBody(name))).toBeUndefined();
    }

    it('extracts a version range and a gist from an issue string', () => {
      expectValidRegressionReport(getIssueBody('issue.md'));
    });

    it('attempts to coerce input versions into semver', () => {
      const name = 'issue-versions-non-semantic.md';
      expectValidRegressionReport(getIssueBody(name));
    });

    it('handles a trailing slash at the end of the gist URL', () => {
      const name = 'issue-gist-trailing-slash.md';
      expectValidRegressionReport(getIssueBody(name));
    });

    it('handles gists', () => {
      expectUndefinedBisect('issue-gist-invalid.md');
    });

    it('returns undefined if parameters are missing', () => {
      expectUndefinedBisect('issue-missing-info.md');
    });

    it('returns undefined if version numbers are invalid', () => {
      expectUndefinedBisect('issue-versions-invalid.md');
    });

    it('returns undefined if testcase gist is invalid', () => {
      expectUndefinedBisect('issue-gist-invalid.md');
    });
  });
});
