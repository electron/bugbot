import * as SemVer from 'semver';
import debug from 'debug';
import fromMarkdown = require('mdast-util-from-markdown');
import toString = require('mdast-util-to-string');
import { Heading } from 'mdast';
import { Node } from 'unist';
import { inspect } from 'util';
import { ElectronVersions, releaseCompare } from './electron-versions';
import { Platform } from '@electron/bugbot-shared/build/interfaces';

// no types exist for this module
//eslint-disable-next-line @typescript-eslint/no-var-requires
const heading = require('mdast-util-heading-range');

export type BisectCommand = {
  badVersion: string;
  gistId: string;
  goodVersion: string;
  type: 'bisect';
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
      let content = '';
      heading(tree, headerName, (_start: Heading, nodes: Array<Node>) => {
        content = toString(nodes);
      });
      sections.set(headerName, content.trim());
    }
  }

  return sections;
}

// copied from Fiddle code
export function getGistId(input: string): string | null {
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

const BAD_VERSION = 'Electron Version';
const GOOD_VERSION = 'Last Known Working Electron Version';
const TESTCASE_URL = 'Testcase Gist URL';

// /bugbot bisect [gistId] [goodVersion [badVersion]]
// If no `gistId` is given, use TESTCASE_URL.
// If no `goodVersion` is given, use GOOD_VERSION or an old version.
// If no `badVersion` is given, use BAD_VERSION or the latest release.
async function parseBisectCommand(
  issueBody: string,
  words: string[],
  versions: ElectronVersions,
): Promise<BisectCommand | undefined> {
  const d = debug('issue-parser:parseBisectCommand');

  let badVersion: string;
  let gistId: string;
  let goodVersion: string;

  for (const word of words) {
    const id = getGistId(word);
    if (id) {
      gistId = id;
      continue;
    }
    const ver = SemVer.coerce(word);
    if (ver && (await versions.isVersion(ver.version))) {
      if (!goodVersion) {
        goodVersion = ver.version;
      } else {
        badVersion = ver.version;
      }
      continue;
    }
  }

  // if any pieces are missing, fill them in from the issue body
  const sections = splitMarkdownByHeader(issueBody);
  d('sections', inspect(sections));
  badVersion ||= SemVer.coerce(sections.get(BAD_VERSION))?.version;
  badVersion ||= await versions.getLatestVersion();
  goodVersion ||= SemVer.coerce(sections.get(GOOD_VERSION))?.version;
  goodVersion ||= await versions.getDefaultBisectStart();
  if (!gistId) {
    const url = sections.get(TESTCASE_URL);
    if (url) gistId = getGistId(url);
  }

  // ensure goodVersion < badVersion;
  const semGood = SemVer.parse(goodVersion);
  const semBad = SemVer.parse(badVersion);
  if (semGood && semBad && releaseCompare(semGood, semBad) > 0) {
    [goodVersion, badVersion] = [badVersion, goodVersion];
  }

  d({ badVersion, gistId, goodVersion });
  return badVersion && gistId && goodVersion
    ? { type: 'bisect', badVersion, gistId, goodVersion }
    : undefined;
}

const ALL_PLATFORMS = ['darwin', 'linux', 'win32'];

// /bugbot test [gistId | platform... | version...]
// If no `gistId` is given, use TESTCASE_URL.
// If no `platform`s are given, use `allPlatforms`
// If no `version`s are given, use BAD_VERSION or the latest release.
async function parseTestCommand(
  issueBody: string,
  words: string[],
  versions: ElectronVersions,
): Promise<TestCommand | undefined> {
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
    const ver = SemVer.coerce(word);
    if (ver) {
      ret.versions.push(ver.version);
      continue;
    }
    if (allPlatforms.includes(word)) {
      ret.platforms.push(word as Platform);
      continue;
    }
  }
  d('user-provided: %o', ret);

  // fallback values
  if (ret.versions.length === 0) {
    ret.versions.push(...(await versions.getVersionsToTest()));
  }
  if (ret.platforms.length === 0) {
    ret.platforms.push(...(allPlatforms as Platform[]));
  }
  if (!ret.gistId) {
    ret.gistId = getGistId(sections.get(TESTCASE_URL));
  }

  d('after filling in defaults: %o', ret);
  return ret.platforms.length > 0 && ret.versions.length > 0 && ret.gistId
    ? ret
    : undefined;
}

export async function parseIssueCommand(
  issueBody: string,
  cmd: string,
  versions: ElectronVersions,
): Promise<IssueCommand | undefined> {
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
      return await parseBisectCommand(issueBody, words.slice(2), versions);
    case 'test':
      return await parseTestCommand(issueBody, words.slice(2), versions);
    default:
      return undefined;
  }
}
