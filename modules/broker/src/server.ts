import express from 'express';

import * as http from 'http';

import { Broker } from './broker';
import { Task } from './task';

export class Server {
  private readonly app: express.Application;
  private readonly broker: Broker;
  private readonly port: number;
  private server: http.Server;

  constructor(appInit: { broker: Broker; port: number }) {
    this.broker = appInit.broker;
    this.port = appInit.port;
    console.log('this.broker', this.broker);
    console.log('this.port', this.port);

    this.app = express();
    this.app.use(express.json());
    this.app.post('/api/jobs', this.createJob.bind(this));
  }

  private createJob(req: express.Request, res: express.Response) {
    console.log('req.body', req.body);
    console.log(`res: ${res}`);
    const task = new Task(req.body);
    this.broker.addTask(task);
    res.status(200).json(task.id);
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
