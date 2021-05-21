import express from 'express';

import { Broker } from './broker';
import { Task } from './task';

export class Server {
  private readonly app: express.Application;
  private readonly broker: Broker;
  private readonly port: number;

  constructor(appInit: { broker: Broker; port: number }) {
    this.broker = appInit.broker;
    console.log('this.broker', this.broker);
    this.port = appInit.port;

    this.app = express();
    this.app.use(express.json());
    this.app.post('/api/jobs', this.createJob.bind(this));
  }

  private createJob(req: express.Request, res: express.Response) {
    console.log('req.body', req.body);
    console.log(`res: ${res}`);
    this.broker.addTask(new Task(req.body));
  }

  public listen(): void {
    this.app.listen(this.port, () => {
      console.log(`App listening on port ${this.port}`);
    });
  }
}
