import * as http from 'http';
import * as https from 'https';
import * as jsonpatch from 'fast-json-patch';
import escapeHtml from 'escape-html';
import debug from 'debug';
import create_etag from 'etag';
import express from 'express';
import { URL } from 'url';

import { env, getEnvData } from '@electron/bugbot-shared/lib/env-vars';

import { Auth, AuthScope } from './auth';
import { Broker } from './broker';
import { Task } from './task';
import { buildLog } from './log';

const DebugPrefix = 'broker:server';

function getTaskBody(task: Task) {
  const body = JSON.stringify(task.publicSubset());
  const etag = create_etag(body);
  return { body, etag };
}

export class Server {
  public readonly brokerUrl: URL;

  private readonly app: express.Application;
  private readonly auth: Auth;
  private readonly broker: Broker;
  private readonly cert: string;
  private readonly key: string;
  private server: http.Server;

  constructor(
    opts: {
      auth?: Auth;
      broker?: Broker;
      brokerUrl?: string;
      cert?: string;
      key?: string;
    } = {},
  ) {
    // Initialize some fields either from being passed in, from the environment,
    // or to a sensible default
    this.broker = opts.broker || new Broker();
    this.brokerUrl = new URL(opts.brokerUrl || env('BUGBOT_BROKER_URL'));

    // For Heroku, the $PORT env var is set dynamically
    if (!this.brokerUrl.port) {
      this.brokerUrl.port = env('PORT');
    }

    if (this.brokerUrl.protocol === 'https:') {
      this.cert = opts.cert || getEnvData('BUGBOT_BROKER_CERT');
      this.key = opts.key || getEnvData('BUGBOT_BROKER_KEY');
    }

    // Initialize auth either from being passed in or by creating a new auth
    // with a control token that is printed out
    if (opts.auth !== undefined) {
      this.auth = opts.auth;
    } else {
      this.auth = new Auth();

      // Create a control token and debug print it out
      const controlTokenId = this.auth.createToken([AuthScope.ControlTokens]);
      debug(`${DebugPrefix}:auth`)(
        `Empty auth created with control token "${controlTokenId}"`,
      );
    }

    this.app = express();
    this.app.get(
      '/api/jobs',
      this.authMiddleware([AuthScope.Jobs]),
      this.getJobs.bind(this),
    );
    this.app.get(
      '/api/jobs/:jobId',
      this.authMiddleware([AuthScope.Jobs]),
      this.getJob.bind(this),
    );
    this.app.patch(
      '/api/jobs/:jobId',
      this.authMiddleware([AuthScope.Jobs]),
      express.json(),
      this.patchJob.bind(this),
    );
    this.app.post(
      '/api/jobs',
      this.authMiddleware([AuthScope.Jobs]),
      express.json(),
      this.postJob.bind(this),
    );
    this.app.put(
      '/api/jobs/:jobId/log',
      this.authMiddleware([AuthScope.Jobs]),
      express.text(),
      this.putLog.bind(this),
    );
    this.app.get('/log/:jobId', this.getLog.bind(this));
    this.app.post(
      '/api/tokens',
      this.authMiddleware([AuthScope.ControlTokens]),
      express.json(),
      this.postTokens.bind(this),
    );
    this.app.delete(
      '/api/tokens',
      this.authMiddleware([AuthScope.ControlTokens]),
      this.deleteTokens.bind(this),
    );
  }

  private getLog(req: express.Request, res: express.Response) {
    const d = debug(`${DebugPrefix}:getLog`);

    const id = req.params.jobId;
    d('getLog', id);
    const task = this.broker.getTask(id);
    if (!task) {
      d('404 no such task');
      res.status(404).send(escapeHtml(`Unknown job '${id}'`));
      return;
    }

    res.header('Content-Type', 'text/html; charset=UTF-8');
    res.status(200).send(buildLog(task));
  }

  private putLog(req: express.Request, res: express.Response) {
    const id = req.params.jobId;
    const task = this.broker.getTask(id);
    if (task) {
      task.logText(req.body);
      res.status(200).end();
    } else {
      res.status(404).send(escapeHtml(`Unknown job '${id}'`));
    }
  }

  private postJob(req: express.Request, res: express.Response) {
    let task: Task;
    try {
      task = Task.createBisectTask(req.body);
      this.broker.addTask(task);
      res.status(201).send(escapeHtml(task.id));
    } catch (error) {
      res.status(422).send(escapeHtml(error.message));
    }
  }

  private getJob(req: express.Request, res: express.Response) {
    const id = req.params.jobId;
    const task = this.broker.getTask(id);
    if (!task) {
      res.status(404).send(escapeHtml(`Unknown job '${id}'`));
      return;
    }

    const { body, etag } = getTaskBody(task);
    task.etag = etag;
    res.header('ETag', etag);
    res.header('Content-Type', 'application/json');
    res.status(200).send(body);
  }

  private patchJob(req: express.Request, res: express.Response) {
    const d = debug(`${DebugPrefix}:patchJob`);
    const id = req.params.jobId;
    const task = this.broker.getTask(id);
    if (!task) {
      res.status(404).send(escapeHtml(`Unknown job '${id}'`));
      return;
    }

    const if_header = 'If-Match';
    const if_etag = req.header(if_header);
    if (if_etag && if_etag !== task.etag) {
      res
        .status(412)
        .send(escapeHtml(`Invalid ${if_header} header: ${if_etag}`));
      return;
    }

    try {
      d('before patch', JSON.stringify(task));
      d('patch body', req.body);
      jsonpatch.applyPatch(task, req.body, (op, index, tree) => {
        if (!['add', 'copy', 'move', 'remove', 'replace'].includes(op.op)) {
          return;
        }
        const [, prop] = op.path.split('/'); // '/bot_client_data/foo' -> 'bot_client_data'
        const value = (op as any).value || undefined;
        if (Task.canSet(prop, value)) {
          return;
        }
        throw new jsonpatch.JsonPatchError(
          `unable to patch ${prop} on task ${task.id}`,
          'OPERATION_OP_INVALID',
          index,
          op,
          tree,
        );
      });
      d('after patch', JSON.stringify(task));
      const { etag } = getTaskBody(task);
      res.header('ETag', etag);
      res.status(200).end();
    } catch (err) {
      d(err);
      res.status(400).send(escapeHtml(err.message));
    }
  }

  private getJobs(req: express.Request, res: express.Response) {
    const d = debug(`${DebugPrefix}:getJobs`);

    d(`getJobs: query: ${JSON.stringify(req.query)}`);
    const tasks = this.broker.getTasks().map((task) => task.publicSubset());
    const ids = Server.filter(tasks, req.query as any).map((task) => task.id);
    d(`getJobs: tasks: [${ids.join(', ')}]`);
    res.status(200).json(ids);
  }

  private postTokens(req: express.Request, res: express.Response) {
    const scopes = req.body;
    const tokenId = this.auth.createToken(scopes);
    res.status(200).json(tokenId);
  }

  private deleteTokens(req: express.Request, res: express.Response) {
    const tokenId = req.body;
    const success = this.auth.revokeToken(tokenId);
    if (success) {
      res.status(200).end();
    } else {
      res.status(404).end();
    }
  }

  /**
   * Creates a middleware for use in routing to ensure requests have certain
   * required scopes before progressing to the route function.
   */
  private authMiddleware(scopes: AuthScope[]): express.RequestHandler {
    return (req, res, next) => {
      // Get the `authorization` header value, rejecting requests that don't
      // provide one
      const authHeader = req.headers.authorization;
      if (authHeader === undefined) {
        res.status(401).end();
        return;
      }

      // Ensure the header is the correct type
      const match = authHeader.match(/^Bearer (.+)$/);
      if (match === null) {
        res.status(401).end();
        return;
      }

      // Extract the token from the header
      const [, tokenId] = match;

      // Check if the token is authorized for the given scopes
      const isAuthed = this.auth.tokenHasScopes(tokenId, scopes);
      if (!isAuthed) {
        res.status(403).end();
        return;
      }

      next();
    };
  }

  public start(): Promise<void> {
    const d = debug(`${DebugPrefix}:start`);

    this.stop(); // ensure we don't accidentally start a 2nd server

    d('starting server');

    const listen = (server: http.Server, port: number) => {
      return new Promise<void>((resolve, reject) => {
        server.listen(port, () => {
          d(`listening on port ${port}`);
          resolve();
        });
        server.once('error', (err) => reject(err));
      });
    };

    const port = Number.parseInt(this.brokerUrl.port, 10);
    d(`url.protocol ${this.brokerUrl.protocol}`);
    switch (this.brokerUrl.protocol) {
      case 'http:': {
        const opts = {};
        this.server = http.createServer(opts, this.app);
        return listen(this.server, port);
      }

      case 'https:': {
        const { cert, key } = this;
        const opts = { cert, key };
        this.server = https.createServer(opts, this.app);
        return listen(this.server, port);
      }

      default: {
        return Promise.reject(
          new Error(`Unsupported protocol in '${this.brokerUrl}'`),
        );
      }
    }
  }

  public stop(): void {
    const d = debug(`${DebugPrefix}:stop`);
    if (this.server) {
      this.server.close();
      delete this.server;
      d('server stopped');
    }
  }

  /**
   * Conventions:
   * - `.` characters in the key delimit an object subtree
   * - `,` characters in the value delimit multiple values
   * - a value of `undefined` matches undefined values
   * - a key ending in `!` negates the filter
   *
   * Examples:
   * - `foo=bar`          - `o[foo] == bar`
   * - `foo!=bar`         - `o[foo] != bar`
   * - `foo=undefined`    - `o[foo] === undefined`
   * - `foo=bar,baz`      - `o[foo] == bar || o[foo] == baz`
   * - `foo.bar=baz`      - `o[foo][bar] == baz`
   * - `foo!=undefined`   - `o[foo] != undefined`
   * - `foo!=bar,baz`     - `o[foo] != bar && o[foo] != baz`
   * - `foo.bar=baz,qux`  - `o[foo][bar] == baz || o[foo][bar] == qux`
   * - `foo.bar!=baz,qux` - `o[foo][bar] != baz && o[foo][bar] != qux`
   */
  public static filter(
    beginning_set: any[],
    query: Record<string, string>,
  ): any[] {
    let filtered = [...beginning_set];
    const arrayFormatSeparator = ',';

    for (const entry of Object.entries(query)) {
      // get the key
      let negate = false;
      let [key] = entry;
      if (key.endsWith('!')) {
        negate = true;
        key = key.slice(0, -1);
      }
      const names = key.split('.');

      // get the array of matching values
      const values = entry[1]
        .split(arrayFormatSeparator)
        .filter((v) => Boolean(v));

      filtered = filtered.filter((value: any) => {
        // walk the object tree to the right value
        for (const walk of names) value = value?.[walk];
        value = value === undefined ? 'undefined' : value;
        // eslint-disable-next-line eqeqeq
        const matched = values.findIndex((v) => v == value) !== -1;
        return negate ? !matched : matched;
      });
    }

    return filtered;
  }
}
