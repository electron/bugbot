import * as semver from 'semver';
import debug from 'debug';
import fromMarkdown = require('mdast-util-from-markdown');
import toString = require('mdast-util-to-string');
import { Heading } from 'mdast';
import { Node } from 'unist';
import { inspect } from 'util';

import { Versions, compareVersions } from 'fiddle-core';

import { Platform } from '@electron/bugbot-shared/build/interfaces';

// no types exist for this module
//eslint-disable-next-line @typescript-eslint/no-var-requires
const heading = require('mdast-util-heading-range');

export type BisectCommand = {
  badVersion: string;
  gistId: string;
  goodVersion: string;
  type: 'bisect';
  platform: Platform;
};

export type TestCommand = {
  gistId: string;
  platforms: Platform[];
  type: 'test';
  versions: string[];
};

export type IssueCommand = BisectCommand | TestCommand;

export function splitMarkdownByHeader(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  const tree = fromMarkdown(markdown);

  for (const child of tree.children) {
    if (child.type === 'heading') {
      const headerName = child.children[0].value as string;
      // Need to escape the header name here because the string input gets put into a RegExp value
      // https://stackoverflow.com/a/3561711/5602134
      const escapedHeader = headerName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      let content = '';
      heading(tree, escapedHeader, (_start: Heading, nodes: Array<Node>) => {
        content = toString(nodes);
      });
      sections.set(headerName, content.trim());
    }
  }

  return sections;
}

// copied from Fiddle code
export function getGistId(input?: string): string | null {
  let id: string | undefined = input;
  if (input?.startsWith('https://gist.github.com/')) {
    if (input.endsWith('/')) {
      input = input.slice(0, -1);
    }
    id = input.split('/').pop();
  }
  if (id && /[0-9A-Fa-f]{32}/.test(id)) {
    return id;
  }
  return null;
}

export function getPlatform(maybePlatform: string): Platform | undefined {
  const lowercasePlatform = maybePlatform.toLowerCase();
  const platformMatches: Map<Platform, string[]> = new Map();
  platformMatches.set('darwin', ['macos', 'mac', 'osx']);
  platformMatches.set('linux', ['linux', 'ubuntu']);
  platformMatches.set('win32', ['windows']);

  for (const [platform, matches] of platformMatches.entries()) {
    if (lowercasePlatform.includes(platform)) return platform;
    for (const match of matches) {
      if (lowercasePlatform.includes(match)) return platform;
    }
  }

  return undefined;
}

const ISSUE_SECTIONS = {
  badVersion: 'Electron Version',
  goodVersion: 'Last Known Working Electron Version',
  gistId: 'Testcase Gist URL',
  platform: 'What operating system are you using?',
};

const ALL_PLATFORMS: Platform[] = ['darwin', 'linux', 'win32'];

export function isValidPlatform(value: string): value is Platform {
  return ALL_PLATFORMS.includes(value as Platform);
}

// /bugbot bisect [gistId] [goodVersion [badVersion]] [platform]
// If no `gistId` is given, use TESTCASE_URL.
// If no `goodVersion` is given, use GOOD_VERSION or an old version.
// If no `badVersion` is given, use BAD_VERSION or the latest release.
// If no `platform` is given, use the platform from the reported issue or Linux.
function parseBisectCommand(
  issueBody: string,
  words: string[],
  versions: Versions,
): BisectCommand | undefined {
  const d = debug('issue-parser:parseBisectCommand');

  let badVersion: semver.SemVer | undefined;
  let gistId: string | undefined;
  let goodVersion: semver.SemVer | undefined;
  let platform: Platform | undefined;

  for (const word of words) {
    const id = getGistId(word);
    if (id) {
      gistId = id;
      continue;
    }
    const ver = semver.coerce(word);
    if (ver && versions.isVersion(ver)) {
      if (!goodVersion) {
        goodVersion = ver;
      } else {
        badVersion = ver;
      }
      continue;
    }
    const plat = getPlatform(word);
    if (isValidPlatform(plat)) {
      platform = plat;
      continue;
    }
  }

  // if any pieces are missing, fill them in from the issue body
  const sections = splitMarkdownByHeader(issueBody);
  d('sections', inspect(sections));
  badVersion ||= semver.coerce(sections.get(ISSUE_SECTIONS.badVersion));
  badVersion ||= versions.latest;
  goodVersion ||= semver.coerce(sections.get(ISSUE_SECTIONS.goodVersion));
  goodVersion ||= semver.parse(`${versions.supportedMajors[0] - 2}.0.0`);
  gistId ||= getGistId(sections.get(ISSUE_SECTIONS.gistId));
  platform ||= getPlatform(sections.get(ISSUE_SECTIONS.platform)) ?? 'linux';

  // ensure goodVersion < badVersion;
  const semGood = semver.parse(goodVersion);
  const semBad = semver.parse(badVersion);
  if (semGood && semBad && compareVersions(semGood, semBad) > 0) {
    [goodVersion, badVersion] = [badVersion, goodVersion];
  }

  d('%o', { badVersion, gistId, goodVersion, platform });
  return badVersion && gistId && goodVersion
    ? {
        badVersion: badVersion?.version,
        gistId,
        goodVersion: goodVersion?.version,
        platform,
        type: 'bisect',
      }
    : undefined;
}

const NUM_OBSOLETE_TO_TEST = 2;

function getVersionsToTest(versions: Versions): Array<string> {
  const testme: string[] = [];

  const addMajor = (major: number) => {
    const range = versions.inMajor(major);
    if (range.length !== 0) testme.push(range.shift().version);
    if (range.length !== 0) testme.push(range.pop().version);
  };

  versions.obsoleteMajors.slice(-NUM_OBSOLETE_TO_TEST).forEach(addMajor);
  versions.supportedMajors.forEach(addMajor);
  versions.prereleaseMajors.forEach(addMajor);
  return testme;
}

// /bugbot test [gistId | platform... | version...]
// If no `gistId` is given, use TESTCASE_URL.
// If no `platform`s are given, use `ALL_PLATFORMS`
// If no `version`s are given, use BAD_VERSION or the latest release.
function parseTestCommand(
  issueBody: string,
  words: string[],
  versions: Versions,
): TestCommand | undefined {
  const d = debug('issue-parser:parseTestCommand');
  const sections = splitMarkdownByHeader(issueBody);

  const ret: TestCommand = {
    gistId: '',
    platforms: [],
    type: 'test',
    versions: [],
  };

  // user-provided values
  for (const word of words) {
    const id = getGistId(word);
    if (id) {
      ret.gistId = id;
      continue;
    }
    if (isValidPlatform(word)) {
      ret.platforms.push(word);
      continue;
    }
    const ver = semver.coerce(word);
    if (ver && versions.isVersion(ver.version)) {
      ret.versions.push(ver.version);
      continue;
    }
  }
  d('user-provided: %o', ret);

  // fallback values
  if (ret.versions.length === 0) {
    ret.versions.push(...getVersionsToTest(versions));
  }
  if (ret.platforms.length === 0) {
    ret.platforms.push(...ALL_PLATFORMS);
  }
  if (!ret.gistId) {
    ret.gistId = getGistId(sections.get(ISSUE_SECTIONS.gistId));
  }

  d('after filling in defaults: %o', ret);
  return ret.platforms.length > 0 && ret.versions.length > 0 && ret.gistId
    ? ret
    : undefined;
}

export function parseIssueCommand(
  issueBody: string,
  cmd: string,
  versions: Versions,
): IssueCommand | undefined {
  const d = debug('issue-parser:parseIssueCommand');

  const words = cmd
    .split(' ')
    .map((word) => word.trim().toLocaleLowerCase())
    .filter((word) => word.length > 0);
  d('words', inspect(words));

  if (words.length < 2) return undefined;
  if (words[0] !== '/bugbot') return undefined;
  switch (words[1]) {
    case 'bisect':
      return parseBisectCommand(issueBody, words.slice(2), versions);
    case 'test':
      return parseTestCommand(issueBody, words.slice(2), versions);
    default:
      return undefined;
  }
}
