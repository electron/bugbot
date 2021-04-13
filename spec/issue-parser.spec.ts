import { parseIssueBody } from '../src/util/issue-parser';
import * as fs from 'fs';
import * as SemVer from 'semver';

describe('issue-parser', () => {
  describe('parseIssueBody()', () => {
    it('extracts a version range and a gist from an issue string', () => {
      const issueBody = fs.readFileSync('./spec/fixtures/issue.md').toString();
      const { goodVersion, badVersion, gistId } = parseIssueBody(issueBody);

      expect(SemVer.valid(goodVersion)).toBe('13.0.0');
      expect(SemVer.valid(badVersion)).toBe('12.0.0');
      expect(typeof gistId).toBe('string');
    });

    it('attempts to coerce input versions into semver', () => {
      const issueBody = fs
        .readFileSync('./spec/fixtures/issue-versions-non-semantic.md')
        .toString();
      const { goodVersion, badVersion, gistId } = parseIssueBody(issueBody);

      expect(SemVer.valid(goodVersion)).toBe('13.0.0');
      expect(SemVer.valid(badVersion)).toBe('12.0.0');
      expect(typeof gistId).toBe('string');
    });

    it('handles a trailing slash at the end of the gist URL', () => {
      const issueBody = fs
        .readFileSync('./spec/fixtures/issue-gist-trailing-slash.md')
        .toString();
      const { goodVersion, badVersion, gistId } = parseIssueBody(issueBody);

      expect(SemVer.valid(goodVersion)).toBe('13.0.0');
      expect(SemVer.valid(badVersion)).toBe('12.0.0');
      expect(typeof gistId).toBe('string');
    });

    it('handles gists', () => {
      const issueBody = fs
        .readFileSync('./spec/fixtures/issue-gist-invalid.md')
        .toString();
      expect(() => {
        parseIssueBody(issueBody);
      }).toThrowError(
        'Testcase URL https://github.com/erickzhao/electron is invalid',
      );
    });

    it('throws an error if one or more required parameters is missing', () => {
      const issueBody = fs
        .readFileSync('./spec/fixtures/issue-missing-info.md')
        .toString();
      expect(() => {
        parseIssueBody(issueBody);
      }).toThrowError(
        'One or more required parameters is missing in issue body',
      );
    });

    it('throws if version numbers cannot be coerced', () => {
      const issueBody = fs
        .readFileSync('./spec/fixtures/issue-versions-invalid.md')
        .toString();
      expect(() => {
        parseIssueBody(issueBody);
      }).toThrowError(
        'One or more required parameters is missing in issue body',
      );
    });

    it('throws if testcase gist is invalid', () => {
      const issueBody = fs
        .readFileSync('./spec/fixtures/issue-gist-invalid.md')
        .toString();
      expect(() => {
        parseIssueBody(issueBody);
      }).toThrowError(
        'Testcase URL https://github.com/erickzhao/electron is invalid',
      );
    });
  });
});
