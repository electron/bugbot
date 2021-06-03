import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as jsonpatch from 'fast-json-patch';
import * as path from 'path';
import debug from 'debug';
import create_etag from 'etag';
import express from 'express';
import { URL } from 'url';

import { env } from '@electron/bugbot-shared/lib/env-vars';

import { Broker } from './broker';
import { Task } from './task';

const DebugPrefix = 'broker:server';

function getTaskBody(task: Task) {
  const body = JSON.stringify(task.publicSubset());
  const etag = create_etag(body);
  return { body, etag };
}

function getData(data_env: string) {
  const d = debug(`${DebugPrefix}:getData`);

  if (Object.prototype.hasOwnProperty.call(process.env, data_env)) {
    d(`found '${data_env}'; using that`);
    return process.env[data_env];
  }

  const path_env = `${data_env}_PATH`;
  if (Object.prototype.hasOwnProperty.call(process.env, path_env)) {
    d(`found '${path_env}'; using that`);
    return fs.readFileSync(path_env, { encoding: 'utf8' });
  }

  const message = `Neither '$${data_env}' nor '${path_env}' found`;
  console.error(message);
  d(message);
  process.exit(1);
}

export class Server {
  public readonly port: number;

  private readonly app: express.Application;
  private readonly baseUrl: string;
  private readonly broker: Broker;
  private readonly cert: string;
  private readonly key: string;
  private server: http.Server;

  constructor(opts: Record<string, any> = {}) {
    if (!opts.baseUrl) opts.baseUrl = env('BUGBOT_BROKER_URL');
    if (!opts.broker) opts.broker = new Broker();
    const url = new URL(opts.baseUrl);
    if (url.protocol === 'https') {
      if (!opts.cert) opts.cert = getData('BUGBOT_BROKER_CERT');
      if (!opts.key) opts.key = getData('BUGBOT_BROKER_KEY');
    }
    Object.assign(this, opts);

    this.app = express();
    this.app.get('/api/jobs/', this.getJobs.bind(this));
    this.app.get('/api/jobs/*', this.getJob.bind(this));
    this.app.get('/log/*', this.getLog.bind(this));
    this.app.patch('/api/jobs/*', express.json(), this.patchJob.bind(this));
    this.app.post('/api/jobs', express.json(), this.postJob.bind(this));
    this.app.put('/api/jobs/*/log', express.text(), this.putLog.bind(this));
  }

  private getLog(req: express.Request, res: express.Response) {
    const d = debug(`${DebugPrefix}:getLog`);

    const id = path.basename(req.url);
    d('getLog', id);
    const task = this.broker.getTask(id);
    if (!task) {
      d('404 no such task');
      res.status(404).send(`Unknown job '${id}'`);
      return;
    }

    const pre = task.log.join('\n');
    const refresh_interval_sec = task.current ? 5 : 60;
    // FIXME: hardcoding all this is bad
    const body = `<head><meta http-equiv="refresh" content="${refresh_interval_sec}"></head><body style="color: #66FF66; background: #282828;"><pre>${pre}</pre></body>`;
    res.header('Content-Type', 'text/html; charset=UTF-8');
    res.status(200).send(body);
  }

  private putLog(req: express.Request, res: express.Response) {
    const d = debug(`${DebugPrefix}:putLog`);

    const [, id] = /\/api\/jobs\/(.*)\/log/.exec(req.url);
    const task = this.broker.getTask(id);
    if (!task) {
      res.status(404).send(`Unknown job '${id}'`);
      return;
    }

    const lines = req.body
      .split(/\r?\n/)
      .filter((line) => line && line.length > 0);
    d('appending to log:', JSON.stringify(lines));
    task.log.push(...lines);
    res.status(200).end();
  }

  private postJob(req: express.Request, res: express.Response) {
    let task: Task;
    try {
      task = Task.createBisectTask(req.body);
      this.broker.addTask(task);
      res.status(201).send(task.id);
    } catch (error) {
      res.status(422).send(error.message);
    }
  }

  private getJob(req: express.Request, res: express.Response) {
    const id = path.basename(req.url);
    const task = this.broker.getTask(id);
    if (!task) {
      res.status(404).send(`Unknown job '${id}'`);
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
    const id = path.basename(req.url);
    const task = this.broker.getTask(id);
    if (!task) {
      res.status(404).send(`Unknown job '${id}'`);
      return;
    }

    const if_header = 'If-Match';
    const if_etag = req.header(if_header);
    if (if_etag && if_etag !== task.etag) {
      res.status(412).send(`Invalid ${if_header} header: ${if_etag}`);
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
      res.status(400).send(err);
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

  public start(): Promise<any> {
    const d = debug(`${DebugPrefix}:start`);
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

    const url = new URL(this.baseUrl);
    const port = Number.parseInt(url.port, 10);
    switch (url.protocol) {
      case 'http': {
        const opts = {};
        this.server = http.createServer(opts, this.app);
        return listen(this.server, port);
        break;
      }

      case 'https': {
        const opts = {
          cert: fs.readFileSync(this.cert),
          key: fs.readFileSync(this.key),
        };
        this.server = https.createServer(opts, this.app);
        return listen(this.server, port);
      }

      default:
        console.error(`unknown protocol '${url.protocol}' in '${this.baseUrl}'`);
        process.exit(1);
    }
  }

  public stop(): void {
    const d = debug(`${DebugPrefix}:stop`);
    this.server.close();
    delete this.server;
    d('server stopped');
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
