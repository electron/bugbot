import express from 'express';

import * as http from 'http';

import { Broker } from './broker';
import { Task } from './task';

type TaskBuilder = (params: any) => Task;

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
    this.app.post('/api/jobs', this.createJob.bind(this));
  }

  private createJob(req: express.Request, res: express.Response) {
    let task: Task;
    try {
      task = this.createBisectTask(req.body);
      this.broker.addTask(task);
      res.status(201).json(task.id);
    } catch (error) {
      res.status(422).send(error.message);
    }
  }

  public listen(): void {
    this.server = this.app.listen(this.port, () => {
      console.log(`App listening on port ${this.port}`);
    });
  }

  public close(): void {
    this.server.close();
    this.server = undefined;
  }
}
