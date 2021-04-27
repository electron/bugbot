import debug from 'debug';
import { Heading } from 'mdast';
import fromMarkdown from 'mdast-util-from-markdown';
import toString from 'mdast-util-to-string';
import SemVer from 'semver';
import { Node } from 'unist';
import { BisectOptions, TestOptions } from '../client/tasks';

// no types exist for this module
//eslint-disable-next-line @typescript-eslint/no-var-requires
const heading = require('mdast-util-heading-range');

const TESTCASE_URL = 'Testcase Gist URL';
const BUGGY_VERSION = 'Electron Version';
const LAST_KNOWN_GOOD_VERSION = 'Last Known Working Electron version';

function getHeadingContent(tree: Node, test: string) {
  let str = '';
  heading(tree, test, (_start: Heading, nodes: Array<Node>) => {
    str = toString(nodes);
  });
  return str;
}

// copied from Fiddle code
function getGistId(input: string): string | null {
  let id: string | undefined = input;
  if (input.startsWith('https://gist.github.com')) {
    if (input.endsWith('/')) {
      input = input.slice(0, -1);
    }
    id = input.split('/').pop();
  }
  if (id && id.match(/[0-9A-Fa-f]{32}/)) {
    return id;
  }
  return null;
}

const d = debug('github-client:issue-parser');

function getVersionFromHeading(
  tree: any,
  headerName: string,
): string | undefined {
  const content = getHeadingContent(tree, headerName);
  return SemVer.coerce(content)?.version;
}

function parseBody(markdown: string): any {
  const opts: any = {};
  const tree = fromMarkdown(markdown);

  const badVersion = getVersionFromHeading(tree, BUGGY_VERSION);
  if (badVersion) {
    opts.badVersion = badVersion;
  }

  const gistUrl = getHeadingContent(tree, TESTCASE_URL);
  if (gistUrl) {
    const gistId = getGistId(gistUrl);
    if (!gistId) {
      d('Invalid gist URL, returning', { gistUrl });
    } else {
      opts.gistId = gistId;
    }
  }

  const goodVersion = getVersionFromHeading(tree, LAST_KNOWN_GOOD_VERSION);
  if (goodVersion) {
    opts.goodVersion = goodVersion;
  }

  d('parseBody got', JSON.stringify(opts));
  return opts;
}

/**
 * Parses a markdown string and returns the testcase gist URL,
 * the last known good version, and first known bad version.
 * @param markdown The markdown content of the issue body
 * @returns Details needed to run Fiddle from the command line
 */
export function getBisectOptionsFromBody(markdown: string): BisectOptions | undefined {
  const opts = parseBody(markdown);

  const { badVersion, gistId, goodVersion } = opts;
  if (!badVersion || !gistId || !goodVersion) {
    return undefined;
  }

  return opts as BisectOptions;
}

export function getTestOptionsFromBody(markdown: string): TestOptions | undefined {
  const opts = parseBody(markdown);

  const { badVersion, gistId } = opts;
  if (!badVersion || !gistId) {
    return undefined;
  }

  return opts as TestOptions;
}
