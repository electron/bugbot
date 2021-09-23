import * as fs from 'fs';
import * as path from 'path';

import { BaseVersions } from 'fiddle-core';

import {
  BisectCommand,
  TestCommand,
  parseIssueCommand,
} from '../src/issue-parser';

describe('issue-parser', () => {
  const versions = new BaseVersions([
    '13.0.2',
    '13.0.1',
    '13.0.0',
    '12.0.3',
    '12.0.2',
    '12.0.1',
    '12.0.0',
    '11.0.2',
    '11.0.1',
    '11.0.0',
    '10.1.0',
    '10.0.2',
    '10.0.1',
    '10.0.0',
    '9.0.3',
    '9.0.2',
    '9.0.1',
    '9.0.0',
    '8.0.2',
    '8.0.1',
    '8.0.0',
    '7.0.2',
    '7.0.1',
    '7.0.0',
    '6.1.4',
    '6.1.2',
    '6.1.0',
    '6.0.0',
  ]);
  const fakeLatestVersion = versions.latest.version;
  const fakeBisectStart = `${versions.supportedMajors[0] - 2}.0.0`;

  describe('parseIssueCommand()', () => {
    const fixtureGistId = '24848aefcbb922444b148321a1821be6' as const;
    const otherGistId = '8c5fc0c6a5153d49b5a4a56d3ed9da8f' as const;

    beforeAll(() => {
      expect(otherGistId).not.toBe(fixtureGistId);
    });

    function getIssueBody(basename: string): string {
      const filename = path.resolve(__dirname, 'fixtures', basename);
      return fs.readFileSync(filename, 'utf8');
    }

    describe('returns undefined if the issue comment', () => {
      it.each([
        ['does not begin with "/bugbot"', '/bugbo bisect'],
        ['has no command', '/bugbot'],
        ['has a command that is not "bisect" or "test"', '/bugbot fnord'],
      ])('%s', (name: string, comment: string) => {
        const issueBody = getIssueBody('issue.md');
        const command = parseIssueCommand(issueBody, comment, versions);
        expect(command).toBeUndefined();
      });
    });

    describe('parsing test commands', () => {
      const COMMENT = '/bugbot test' as const;

      const expectedCommand: TestCommand = {
        gistId: fixtureGistId,
        type: 'test',
        platforms: ['darwin', 'linux', 'win32'],
        versions: [
          '8.0.0',
          '8.0.2',
          '9.0.0',
          '9.0.3',
          '10.0.0',
          '10.1.0',
          '11.0.0',
          '11.0.2',
          '12.0.0',
          '12.0.3',
          '13.0.0',
          '13.0.2',
        ],
      };

      it('uses a gist from the comment, if provided', () => {
        const issueBody = getIssueBody('issue.md');
        const comment = `${COMMENT} https://gist.github.com/${otherGistId}/`;
        const command = parseIssueCommand(issueBody, comment, versions);
        expect(command).toStrictEqual({
          ...expectedCommand,
          gistId: otherGistId,
        });
      });

      it('finds a gist from the issue body', () => {
        const issueBody = getIssueBody('issue.md');
        const command = parseIssueCommand(issueBody, COMMENT, versions);
        expect(command).toStrictEqual(expectedCommand);
      });

      it('returns undefined if it has an invalid gist', () => {
        const issueBody = getIssueBody('issue-gist-invalid.md');
        const command = parseIssueCommand(issueBody, COMMENT, versions);
        expect(command).toBeUndefined();
      });

      it('finds versions provided in the command', () => {
        const issueBody = getIssueBody('issue.md');
        const versionNumbers = ['10.0.0', '10.1.0', '9.0.0', '12.0.0'];
        const comment = `${COMMENT} ${versionNumbers.join(' ')}`;
        const command = parseIssueCommand(issueBody, comment, versions);
        expect(command).toStrictEqual({
          ...expectedCommand,
          versions: versionNumbers,
        });
      });

      it('finds platforms provided in the command', () => {
        const issueBody = getIssueBody('issue.md');
        const platforms = ['darwin', 'linux'];
        const comment = `${COMMENT} ${platforms.join(' ')}`;
        const command = parseIssueCommand(issueBody, comment, versions);
        expect(command).toStrictEqual({ ...expectedCommand, platforms });
      });

      it('ignores garbage inputs', () => {
        const issueBody = getIssueBody('issue.md');
        const comment = `${COMMENT} gromble frotz splart`;
        const command = parseIssueCommand(issueBody, comment, versions);
        expect(command).toStrictEqual(expectedCommand);
      });

      it('returns undefined if it has an invalid gist', () => {
        const issueBody = getIssueBody('issue-gist-invalid.md');
        const command = parseIssueCommand(issueBody, COMMENT, versions);
        expect(command).toBeUndefined();
      });

      it('returns undefined if it has a missing gist', () => {
        const issueBody = getIssueBody('issue-missing-info.md');
        const command = parseIssueCommand(issueBody, COMMENT, versions);
        expect(command).toBeUndefined();
      });

      it('does not parse win32 as Electron 32.0.0', () => {
        const issueBody = getIssueBody('issue.md');
        const platforms = ['linux', 'win32'];
        const vers = ['11.0.2'];
        const comment = `${COMMENT} ${platforms.join(' ')} ${vers.join(' ')}`;
        const command = parseIssueCommand(issueBody, comment, versions);
        expect(command).toStrictEqual({
          ...expectedCommand,
          platforms,
          versions: vers,
        });
      });
    });

    describe('parsing bisect commands', () => {
      const COMMENT = '/bugbot bisect' as const;

      const otherGoodVersion = '10.0.0' as const;
      const otherBadVersion = '11.0.0' as const;

      const expectedCommand: BisectCommand = {
        badVersion: '13.0.0',
        gistId: fixtureGistId,
        goodVersion: '12.0.0',
        type: 'bisect',
      };

      beforeAll(() => {
        expect(otherGoodVersion).not.toBe(expectedCommand.goodVersion);
        expect(otherBadVersion).not.toBe(expectedCommand.badVersion);
      });

      it('finds a gist and version range', () => {
        const issueBody = getIssueBody('issue.md');
        const command = parseIssueCommand(issueBody, COMMENT, versions);
        expect(command).toStrictEqual(expectedCommand);
      });

      it('is not confused by extra whitespace in the comment body', () => {
        const issueBody = getIssueBody('issue.md');
        const command = parseIssueCommand(
          issueBody,
          '\n  \n  /bugbot   bisect \n\n\n ',
          versions,
        );
        expect(command).toStrictEqual(expectedCommand);
      });

      it('coerces version numbers into semver', () => {
        const issueBody = getIssueBody('issue-versions-non-semantic.md');
        const command = parseIssueCommand(issueBody, COMMENT, versions);
        expect(command).toStrictEqual(expectedCommand);
      });

      it('handles a trailing slash at the end of the gist URL', () => {
        const issueBody = getIssueBody('issue-gist-trailing-slash.md');
        const command = parseIssueCommand(issueBody, COMMENT, versions);
        expect(command).toStrictEqual(expectedCommand);
      });

      it('reads a gist from the issue comment', () => {
        const issueBody = getIssueBody('issue.md');
        const comment = `${COMMENT} ${otherGistId}`;
        const command = parseIssueCommand(issueBody, comment, versions);
        expect(command).toStrictEqual({
          ...expectedCommand,
          gistId: otherGistId,
        });
      });

      it('reads a goodVersion from the issue comment', () => {
        const issueBody = getIssueBody('issue.md');
        expect(otherGoodVersion).not.toBe(expectedCommand.goodVersion);
        const comment = `${COMMENT} ${otherGoodVersion}`;
        const command = parseIssueCommand(issueBody, comment, versions);
        expect(command).toStrictEqual({
          ...expectedCommand,
          goodVersion: otherGoodVersion,
        });
      });

      it('reads a goodVersion and badVersion from the issue comment', () => {
        const issueBody = getIssueBody('issue.md');
        const comment = `${COMMENT} ${otherGoodVersion} ${otherBadVersion}`;
        const command = parseIssueCommand(issueBody, comment, versions);
        expect(command).toStrictEqual({
          ...expectedCommand,
          goodVersion: otherGoodVersion,
          badVersion: otherBadVersion,
        });
      });

      it('ensures that goodVersion is older than newVersion', () => {
        const issueBody = getIssueBody('issue.md');
        const comment = `${COMMENT} ${otherBadVersion} ${otherGoodVersion}`;
        const command = parseIssueCommand(issueBody, comment, versions);
        expect(command).toStrictEqual({
          ...expectedCommand,
          goodVersion: otherGoodVersion,
          badVersion: otherBadVersion,
        });
      });

      it('ignores inscrutable comment arguments', () => {
        const issueBody = getIssueBody('issue.md');
        const comment = `${COMMENT} fnord`;
        const command = parseIssueCommand(issueBody, comment, versions);
        expect(command).toStrictEqual(expectedCommand);
      });

      it('uses Versions defaults if the issue has no version info', () => {
        const issueBody = getIssueBody('issue-versions-invalid.md');
        const comment = COMMENT;
        const command = parseIssueCommand(issueBody, comment, versions);
        expect(command).toStrictEqual({
          ...expectedCommand,
          goodVersion: fakeBisectStart,
          badVersion: fakeLatestVersion,
        });
      });

      it('falls back to Versions for bisect start point', () => {
        const issueBody = getIssueBody('issue-missing-info.md');
        const comment = `${COMMENT} ${fixtureGistId}`;
        const command = parseIssueCommand(issueBody, comment, versions);
        expect(command).toStrictEqual({
          ...expectedCommand,
          goodVersion: fakeBisectStart,
          badVersion: fakeLatestVersion,
        });
      });

      it('handles case insensitive markdown headings', () => {
        const issueBody = getIssueBody('issue-random-capitalization.md');
        const command = parseIssueCommand(issueBody, COMMENT, versions);
        expect(command).toStrictEqual(expectedCommand);
      });

      it.each([
        ['has an invalid gist', 'issue-gist-invalid.md'],
        ['does not have all necessary information', 'issue-missing-info.md'],
      ])('returns undefined if %s', (name: string, fixture: string) => {
        const issueBody = getIssueBody(fixture);
        const command = parseIssueCommand(issueBody, COMMENT, versions);
        expect(command).toBeUndefined();
      });
    });
  });
});
