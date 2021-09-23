declare module 'mdast-util-heading-range' {
  import { Heading } from 'mdast';
  import { Node } from 'unist';

  type Test = string | RegExp | ((value: string, node: Heading) => boolean);

  interface Options {
    test: Test;
    ignoreFinalDefinitions?: boolean;
  }

  type Handler = (
    start: Heading,
    nodes: Node[],
    end: Node | undefined,
    scope: {
      parent: Node;
      start: number;
      end?: number;
    },
  ) => (Node | undefined)[] | void;

  function heading(tree: Node, test: Test | Options, handler: Handler): void;

  export = heading;
}
