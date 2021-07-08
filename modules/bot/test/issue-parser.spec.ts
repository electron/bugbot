import * as fs from 'fs';
import * as path from 'path';

import {
  BisectCommand,
  TestCommand,
  parseIssueCommand,
} from '../src/issue-parser';
import { ElectronVersions } from '../src/electron-versions';

describe('issue-parser', () => {
  const versionsMock = {
    getDefaultBisectStart: jest.fn(),
    getLatestVersion: jest.fn(),
    getVersionsToTest: jest.fn(),
    isVersion: jest.fn(),
  };
  const versions = (versionsMock as undefined) as ElectronVersions;
  const fakeLatestVersion = '13.0.0' as const;
  const fakeBisectStart = '10.0.0' as const;

  beforeEach(() => {
    versionsMock.getLatestVersion.mockResolvedValue(fakeLatestVersion);
    versionsMock.getDefaultBisectStart.mockResolvedValue(fakeBisectStart);
    versionsMock.isVersion.mockResolvedValue(true);
    versionsMock.getVersionsToTest.mockResolvedValue([fakeBisectStart, fakeLatestVersion]);
  });

  describe('await parseIssueCommand()', () => {
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
      ])('%s', async (name: string, comment: string) => {
        const issueBody = getIssueBody('issue.md');
        const command = await parseIssueCommand(issueBody, comment, versions);
        expect(command).toBeUndefined();
      });
    });

    describe('parsing test commands', () => {
      const COMMENT = '/bugbot test' as const;

      const expectedCommand: TestCommand = {
        gistId: fixtureGistId,
        type: 'test',
        platforms: ['darwin', 'linux', 'win32'],
        versions: [fakeBisectStart, fakeLatestVersion],
      };

      it('uses a gist from the comment, if provided', async () => {
        const issueBody = getIssueBody('issue.md');
        const comment = `${COMMENT} https://gist.github.com/${otherGistId}/`;
        const command = await parseIssueCommand(issueBody, comment, versions);
        expect(command).toMatchObject({
          ...expectedCommand,
          gistId: otherGistId,
        });
      });

      it('finds a gist from the issue body', async () => {
        const issueBody = getIssueBody('issue.md');
        const command = await parseIssueCommand(issueBody, COMMENT, versions);
        expect(command).toMatchObject(expectedCommand);
      });

      it('returns undefined if it has an invalid gist', async () => {
        const issueBody = getIssueBody('issue-gist-invalid.md');
        const command = await parseIssueCommand(issueBody, COMMENT, versions);
        expect(command).toBeUndefined();
      });

      it('finds versions provided in the command', async () => {
        const issueBody = getIssueBody('issue.md');
        const versionNumbers = ['10.0.0', '10.1.0', '9.0.0', '12.0.0'];
        const comment = `${COMMENT} ${versionNumbers.join(' ')}`;
        const command = await parseIssueCommand(issueBody, comment, versions);
        expect(command).toMatchObject({
          ...expectedCommand,
          versions: versionNumbers,
        });
      });

      it('finds platforms provided in the command', async () => {
        const issueBody = getIssueBody('issue.md');
        const platforms = ['darwin', 'linux'];
        const comment = `${COMMENT} ${platforms.join(' ')}`;
        const command = await parseIssueCommand(issueBody, comment, versions);
        expect(command).toMatchObject({ ...expectedCommand, platforms });
      });

      it('ignores garbage inputs', async () => {
        const issueBody = getIssueBody('issue.md');
        const comment = `${COMMENT} gromble frotz splart`;
        const command = await parseIssueCommand(issueBody, comment, versions);
        expect(command).toMatchObject(expectedCommand);
      });

      it('returns undefined if it has an invalid gist', async () => {
        const issueBody = getIssueBody('issue-gist-invalid.md');
        const command = await parseIssueCommand(issueBody, COMMENT, versions);
        expect(command).toBeUndefined();
      });

      it('returns undefined if it has a missing gist', async () => {
        const issueBody = getIssueBody('issue-missing-info.md');
        const command = await parseIssueCommand(issueBody, COMMENT, versions);
        expect(command).toBeUndefined();
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

      it('finds a gist and version range', async () => {
        const issueBody = getIssueBody('issue.md');
        const command = await parseIssueCommand(issueBody, COMMENT, versions);
        expect(command).toMatchObject(expectedCommand);
      });

      it('is not confused by extra whitespace in the comment body', async () => {
        const issueBody = getIssueBody('issue.md');
        const command = await parseIssueCommand(issueBody, `\n  \n  /bugbot   bisect \n\n\n `, versions);
        expect(command).toMatchObject(expectedCommand);
      });

      it('coerces version numbers into semver', async () => {
        const issueBody = getIssueBody('issue-versions-non-semantic.md');
        const command = await parseIssueCommand(issueBody, COMMENT, versions);
        expect(command).toMatchObject(expectedCommand);
      });

      it('handles a trailing slash at the end of the gist URL', async () => {
        const issueBody = getIssueBody('issue-gist-trailing-slash.md');
        const command = await parseIssueCommand(issueBody, COMMENT, versions);
        expect(command).toMatchObject(expectedCommand);
      });

      it('reads a gist from the issue comment', async () => {
        const issueBody = getIssueBody('issue.md');
        const comment = `${COMMENT} ${otherGistId}`;
        const command = await parseIssueCommand(issueBody, comment, versions);
        expect(command).toMatchObject({
          ...expectedCommand,
          gistId: otherGistId,
        });
      });

      it('reads a goodVersion from the issue comment', async () => {
        const issueBody = getIssueBody('issue.md');
        expect(otherGoodVersion).not.toBe(expectedCommand.goodVersion);
        const comment = `${COMMENT} ${otherGoodVersion}`;
        const command = await parseIssueCommand(issueBody, comment, versions);
        expect(command).toMatchObject({
          ...expectedCommand,
          goodVersion: otherGoodVersion,
        });
      });

      it('reads a goodVersion and badVersion from the issue comment', async () => {
        const issueBody = getIssueBody('issue.md');
        const comment = `${COMMENT} ${otherGoodVersion} ${otherBadVersion}`;
        const command = await parseIssueCommand(issueBody, comment, versions);
        expect(command).toMatchObject({
          ...expectedCommand,
          goodVersion: otherGoodVersion,
          badVersion: otherBadVersion,
        });
      });

      it('ensures that goodVersion is older than newVersion', async () => {
        const issueBody = getIssueBody('issue.md');
        const comment = `${COMMENT} ${otherBadVersion} ${otherGoodVersion}`;
        const command = await parseIssueCommand(issueBody, comment, versions);
        expect(command).toMatchObject({
          ...expectedCommand,
          goodVersion: otherGoodVersion,
          badVersion: otherBadVersion,
        });
      });

      it('ignores inscrutable comment arguments', async () => {
        const issueBody = getIssueBody('issue.md');
        const comment = `${COMMENT} fnord`;
        const command = await parseIssueCommand(issueBody, comment, versions);
        expect(command).toMatchObject(expectedCommand);
      });

      it('it uses ElectronVersions defaults if the issue has no version info', async () => {
        const issueBody = getIssueBody('issue-versions-invalid.md');
        const comment = COMMENT;
        const command = await parseIssueCommand(issueBody, comment, versions);
        expect(command).toMatchObject({
          ...expectedCommand,
          goodVersion: fakeBisectStart,
          badVersion: fakeLatestVersion,
        });
      });

      it.each([
        ['it has an invalid gist', 'issue-gist-invalid.md'],
        ['it does not have all necessary information', 'issue-missing-info.md'],
      ])('returns undefined if %s', async (name: string, fixture: string) => {
        const issueBody = getIssueBody(fixture);
        const command = await parseIssueCommand(issueBody, COMMENT, versions);
        expect(command).toBeUndefined();
      });
    });
  });
});
