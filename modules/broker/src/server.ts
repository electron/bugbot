import * as http from 'http';
import * as jsonpatch from 'fast-json-patch';
import * as path from 'path';
import Debug from 'debug';
import create_etag from 'etag';
import express from 'express';

import { Broker } from './broker';
import { Task } from './task';

const debug = Debug('broker:server');

// eslint-disable-next-line no-unused-vars
type TaskBuilder = (params: any) => Task;

function getTaskBody(task: Task) {
  const body = JSON.stringify(task.publicSubset());
  const etag = create_etag(body);
  return { body, etag };
}

export class Server {
  private readonly app: express.Application;
  private readonly createBisectTask: TaskBuilder;
  private readonly broker: Broker;
  private readonly port: number;
  private server: http.Server;

  constructor(appInit: {
    broker: Broker;
    createBisectTask: TaskBuilder;
    port: number;
  }) {
    this.broker = appInit.broker;
    this.createBisectTask = appInit.createBisectTask;
    this.port = appInit.port;

    this.app = express();
    this.app.get('/api/jobs/', this.getJobs.bind(this));
    this.app.get('/api/jobs/*', this.getJob.bind(this));
    this.app.get('/log/*', this.getLog.bind(this));
    this.app.patch('/api/jobs/*', express.json(), this.patchJob.bind(this));
    this.app.post('/api/jobs', express.json(), this.postJob.bind(this));
    this.app.put('/api/jobs/*/log', express.text(), this.putLog.bind(this));
  }

  private getLog(req: express.Request, res: express.Response) {
    const id = path.basename(req.url);
    const task = this.broker.getTask(id);
    if (!task) {
      res.status(404).send(`Unknown job '${id}'`);
      return;
    }

    const body = task.log.join('\n');
    res.status(200).send(body);
  }

  private putLog(req: express.Request, res: express.Response) {
    const [, id] = /\/api\/jobs\/(.*)\/log/.exec(req.url);
    const task = this.broker.getTask(id);
    if (!task) {
      res.status(404).send(`Unknown job '${id}'`);
      return;
    }

    task.log.push(...req.body.split(/\/r?\n/));
    res.status(200).end();
  }

  private postJob(req: express.Request, res: express.Response) {
    let task: Task;
    try {
      task = this.createBisectTask(req.body);
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
      debug('before patch', JSON.stringify(task));
      jsonpatch.applyPatch(task, req.body, (op, index, tree) => {
        if (!['add', 'copy', 'move', 'remove', 'replace'].includes(op.op)) {
          return;
        }
        const prop = op.path.slice(1);
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
      debug('after patch', JSON.stringify(task));
      const { etag } = getTaskBody(task);
      res.header('ETag', etag);
      res.status(200).end();
    } catch (err) {
      debug(err);
      res.status(400).send(err);
    }
  }

  private getJobs(req: express.Request, res: express.Response) {
    let tasks = this.broker.getTasks().map((task) => task.publicSubset());
    const includeUndefined = ['os'];

    const filters = Object.entries(req.query).filter(([key]) =>
      Task.PublicFields.has(key),
    );
    for (const [key, value] of filters) {
      const noProp = (task) => !Object.prototype.hasOwnProperty.call(task, key);
      const matches = (task) => task[key] === value;

      if (value === 'undefined') {
        tasks = tasks.filter((task) => noProp(task));
      } else if (includeUndefined.includes(key)) {
        tasks = tasks.filter((task) => noProp(task) || matches(task));
      } else {
        tasks = tasks.filter((task) => matches(task));
      }
    }
    res.status(200).json(tasks.map((task) => task.id));
  }

  public listen(): Promise<void> {
    this.server = http.createServer({}, this.app);
    return new Promise((resolve) => {
      this.server.listen(this.port, () => resolve());
    });
  }

  public close(): void {
    this.server.close();
    this.server = undefined;
  }
}
