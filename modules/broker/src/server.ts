import create_etag from 'etag';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import express from 'express';
import * as jsonpatch from 'fast-json-patch';

import { Broker } from './broker';
import { Task } from './task';

type TaskBuilder = (params: any) => Task;

const TaskPublicFields = Object.freeze(
  new Set([
    'bisect_result',
    'client_data',
    'error',
    'first',
    'gist',
    'id',
    'last',
    'log',
    'os',
    'runner',
    'time_created',
    'time_finished',
    'time_started',
    'type',
  ]),
);

function publicFieldsOf(o: Record<string, any>) {
  return Object.fromEntries(
    Object.entries(o).filter(([key]) => TaskPublicFields.has(key)),
  );
}

function getTaskBody(task: Task) {
  const body = JSON.stringify(publicFieldsOf(task));
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
    this.app.use(express.json());
    this.app.get('/api/jobs/', this.getJobs.bind(this));
    this.app.get('/api/jobs/*', this.getJob.bind(this));
    this.app.patch('/api/jobs/*', this.patchJob.bind(this));
    this.app.post('/api/jobs', this.postJob.bind(this));
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

    if (task) {
      const { body, etag } = getTaskBody(task);
      task.etag = etag;
      res.header('ETag', etag);
      res.header('Content-Type', 'application/json');
      res.status(200).send(body);
    } else {
      res.status(404).end();
    }
  }

  private patchJob(req: express.Request, res: express.Response) {
    const id = path.basename(req.url);
    const task = this.broker.getTask(id);
    if (!task) {
      res.status(404).end();
      return;
    }

    const if_header = 'If-Match';
    const if_etag = req.header(if_header);
    if (if_etag && if_etag !== task.etag) {
      res.status(412).send(`Invalid ${if_header} header: ${if_etag}`);
      return;
    }

    try {
      console.debug('before patch', JSON.stringify(task));
      jsonpatch.applyPatch(task, req.body, (op, index, tree, existingPath) => {
        const readonlyPaths = ['/id', '/type'];
        if (readonlyPaths.includes(existingPath)) {
          throw new jsonpatch.JsonPatchError(
            `readonly property ${existingPath}`,
            'OPERATION_OP_INVALID',
            index,
            op,
            tree,
          );
        }
      });
      console.debug('after patch', JSON.stringify(task));
      const { etag } = getTaskBody(task);
      res.header('ETag', etag);
      res.status(200).end();
    } catch (err) {
      res.status(400).send(err);
    }
  }

  private getJobs(req: express.Request, res: express.Response) {
    let tasks = this.broker.getTasks().map(publicFieldsOf);
    for (const [key, filter] of Object.entries(req.query)) {
      switch (key) {
        case 'os':
          tasks = tasks.filter((task) => !task[key] || task[key] === filter);
          break;
        default:
          tasks = tasks.filter((task) => task[key] === filter);
          break;
      }
    }
    res.status(200).json(tasks.map((task) => task.id));
  }

  public listen(): Promise<void> {
    const options = {
      cert: fs.readFileSync(path.resolve(process.cwd(), 'server.cert')),
      key: fs.readFileSync(path.resolve(process.cwd(), 'server.key')),
    };
    this.server = https.createServer(options, this.app);
    return new Promise((resolve) => {
      this.server.listen(this.port, () => resolve());
    });
  }

  public close(): void {
    this.server.close();
    this.server = undefined;
  }
}
