import debug from 'debug';
import { Heading } from 'mdast';
import fromMarkdown = require('mdast-util-from-markdown');
import toString = require('mdast-util-to-string');
import * as SemVer from 'semver';
import { Node } from 'unist';

// no types exist for this module
//eslint-disable-next-line @typescript-eslint/no-var-requires
const heading = require('mdast-util-heading-range');

const TESTCASE_URL = 'Testcase Gist URL';
const FIRST_KNOWN_BAD_VERSION = 'Electron Version';
const LAST_KNOWN_GOOD_VERSION = 'Last Known Working Electron version';

export interface FiddleInput {
  goodVersion: string;
  badVersion: string;
  gistId: string;
}

function getHeadingContent(tree: Node, test: string) {
  let str = '';
  heading(tree, test, (_start: Heading, nodes: Array<Node>) => {
    str = toString(nodes);
  });
  return str;
}

// copied from Fiddle code
export function getGistId(input: string): string | null {
  let id: string | undefined = input;
  if (input.startsWith('https://gist.github.com/')) {
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

/**
 * Parses a markdown string and returns the testcase gist URL,
 * the last known good version, and first known bad version.
 * @param markdown The markdown content of the issue body
 * @returns Details needed to run Fiddle from the command line
 */
export function parseIssueBody(markdown: string): FiddleInput {
  const d = debug('github-client:issue-parser');
  const tree = fromMarkdown(markdown);

  const gistUrl = getHeadingContent(tree, TESTCASE_URL);
  const goodVersion = SemVer.coerce(
    getHeadingContent(tree, LAST_KNOWN_GOOD_VERSION),
  )?.version;
  const badVersion = SemVer.coerce(
    getHeadingContent(tree, FIRST_KNOWN_BAD_VERSION),
  )?.version;

  if (!gistUrl || !goodVersion || !badVersion) {
    d('Undefined value, returning', { badVersion, gistUrl, goodVersion });
    throw new Error('One or more required parameters is missing in issue body');
  }

  const gistId = getGistId(gistUrl);
  if (!gistId) {
    d('Invalid gist URL, returning', { gistUrl });
    throw new Error(`Testcase URL ${gistUrl} is invalid`);
  }

  return { badVersion, gistId, goodVersion };
}
