import * as SemVer from 'semver';
import * as fs from 'fs';
import * as path from 'path';

import { parseIssueBody } from '../src/util/issue-parser';

describe('issue-parser', () => {
  describe('parseIssueBody()', () => {
    function getIssueBody(basename: string) {
      const filename = path.resolve('./spec/fixtures/', basename);
      return fs.readFileSync(filename).toString();
    }

    function expectValidRegressionReport(issueBody: string) {
      const { goodVersion, badVersion, gistId } = parseIssueBody(issueBody);
      expect(SemVer.valid(goodVersion)).toBe('13.0.0');
      expect(SemVer.valid(badVersion)).toBe('12.0.0');
      expect(typeof gistId).toBe('string');
    }

    function expectIssueToThrow(name: string, errmsg: string) {
      expect(() => parseIssueBody(getIssueBody(name))).toThrow(errmsg);
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
      expectIssueToThrow(
        'issue-gist-invalid.md',
        'URL https://github.com/erickzhao/electron is invalid',
      );
    });

    it('throws if parameters are missing', () => {
      expectIssueToThrow(
        'issue-missing-info.md',
        'One or more required parameters is missing in issue body',
      );
    });

    it('throws if version numbers are invalid', () => {
      expectIssueToThrow(
        'issue-versions-invalid.md',
        'One or more required parameters is missing in issue body',
      );
    });

    it('throws if testcase gist is invalid', () => {
      expectIssueToThrow(
        'issue-gist-invalid.md',
        'Testcase URL https://github.com/erickzhao/electron is invalid',
      );
    });
  });
});
