import * as https from 'https';
import fetch from 'node-fetch';
import { v4 as mkuuid, validate as is_uuid } from 'uuid';

import { Broker } from '../src/broker';
import { Server } from '../src/server';
import { Task } from '../src/task';

describe('broker', () => {
  let broker: Broker;
  let server: Server;
  const port = 9099;
  const base_url = `https://localhost:${port}`;
  const agent = new https.Agent({
    rejectUnauthorized: false
  });

  beforeEach(async () => {
    const { createBisectTask } = Task;
    broker = new Broker();
    server = new Server({ broker, createBisectTask, port });
    await server.listen();
  });

  afterEach(() => {
    server.close();
  });

  function postJob(body: any) {
    return fetch(`${base_url}/api/jobs`, {
      agent,
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
  }

  async function postNewBisectJob(params = {}) {
    // default values
    const gist = 'abbaabbaabbaabbaabbaabbaabbaabbaabbaabba';
    const type = 'bisect';

    const response = await postJob({ gist, type, ...params });
    const body = await response.text();
    return { body, response };
  }

  async function getJob(id: string) {
    const response = await fetch(`${base_url}/api/jobs/${id}`, { agent });
    let body;
    try {
      body = await response.json();
    } catch (err) {}
    return { body, response };
  }

  async function getJobs(o: Record<string, any> = {}) {
    const params = new URLSearchParams();
    for (const [key, val] of Object.entries(o)) {
      params.set(key, val);
    }
    const response = await fetch(`${base_url}/api/jobs?${params}`, { agent });
    const body = await response.json();
    return { body, response };
  }

  describe('/api/jobs (POST)', () => {
    const gist = 'abcdabcdabcdabcdabcdabcdabcdabcdabcdabcd';
    const type = 'bisect';
    // const headers = { 'Content-Type': 'application/json' };
    // const method = 'POST';
    const os = 'linux';

    it('creates a bisect job', async () => {
      const { response } = await postNewBisectJob();
      expect(response.status).toBe(201);
    });

    it('rejects unknown operating systems', async () => {
      const unknown = 'android';
      const { response, body } = await postNewBisectJob({ os: unknown });
      expect(response.status).toBe(422);
      expect(body.includes(unknown));
    });

    it('rejects unknown types', async () => {
      const unknown = 'gromify';
      const { response, body } = await postNewBisectJob({ type: unknown });
      expect(response.status).toBe(422);
      expect(body.includes(unknown));
    });

    it('checks for required parameters', async () => {
      const required = ['gist', 'type'];
      for (const name of required) {
        const body = { gist, os, type };
        delete body[name];
        const response = await postJob(body);
        expect(response.status).toBe(422);

        const data = await response.text();
        expect(data.includes(name));
      }
    });

    it('returns a job uuid', async () => {
      const { body: id, response } = await postNewBisectJob();
      expect(response.status).toBe(201);
      expect(is_uuid(id)).toBe(true);
    });
  });

  describe('/api/jobs/$job_id (GET)', () => {
    const client_data = Math.random().toString();
    const gist = 'bedfacedbedfacedbedfacedbedfacedbedfaced';
    const os = 'linux';
    const type = 'bisect';
    let id: string;

    beforeEach(async () => {
      const { body } = await postNewBisectJob({ client_data, gist, os, type });
      id = body;
    });

    it('includes a gist', async () => {
      const { body: job } = await getJob(id);
      expect(job.gist).toBe(gist);
    });

    it('includes a type', async () => {
      const { body: job } = await getJob(id);
      expect(job.type).toBe(type);
    });

    it('includes a job id', async () => {
      const { body: job } = await getJob(id);
      expect(job.id).toBe(id);
    });

    it('includes a time_created number', async () => {
      const { body: job } = await getJob(id);
      expect(job.time_created).toBeTruthy();
      expect(Number.parseInt(job.time_created, 10)).not.toBeNaN();
    });

    it('may include a client_data value', async () => {
      const { body: job } = await getJob(id);
      expect(job.client_data).toBe(client_data);
    });

    it('may include a os value', async () => {
      const { body: job } = await getJob(id);
      expect(job.os).toBe(os);
    });

    it.todo('includes a log url');
    it.todo('may include a result_bisect value');
    it.todo('may include a time_finished value');
    it.todo('may include a time_started value');
    it.todo('may include an error value');
  });

  describe('/api/jobs? (GET)', () => {
    it('returns objects identical to /api/jobs/$job_id', async () => {
      const { body: id } = await postNewBisectJob();
      const { body: job } = await getJob(id);
      const { body: jobs } = await getJobs();
      expect(jobs).toContainEqual(job);
    });

    it('returns 404 if no such job', async () => {
      const { response } = await getJob(mkuuid());
      expect(response.status).toBe(404);
    });

    describe('filters by job properties in query parameters', () => {
      it('os', async () => {
        const { body: id_os_any } = await postNewBisectJob();
        const { body: id_os_lin } = await postNewBisectJob({ os: 'linux' });
        await postNewBisectJob({ os: 'windows' });

        const { body: jobs } = await getJobs({ os: 'linux' });

        expect(jobs.length).toBe(2);
        expect(jobs).toContainEqual(expect.objectContaining({ id: id_os_lin }));
        expect(jobs).toContainEqual(expect.objectContaining({ id: id_os_any }));
      });

      it('gist', async () => {
        const { body: a } = await postNewBisectJob({ gist: 'foo' });
        const { body: b } = await postNewBisectJob({ gist: 'foo' });
        await postNewBisectJob();

        const { body: jobs } = await getJobs({ gist: 'foo' });

        expect(jobs.length).toBe(2);
        expect(jobs).toContainEqual(expect.objectContaining({ id: a }));
        expect(jobs).toContainEqual(expect.objectContaining({ id: b }));
      });

      it.todo('runner=undefined');
    });
  });

  describe('/api/jobs/$job_id (PATCH)', () => {
    it.todo('modifies a property');
    it.todo('errors if the property has an unexpected value');
  });

  describe('/api/jobs/$job_id/log (PUT)', () => {
    it.todo('appends messages viewable in the job.log URL');
    it.todo('accepts `transfer-encoding: chunked` requests');
  });

  it.todo('remembers state when restarted');
  it.todo('rejects unauthenticated requsts');
  it.todo('marks jobs as timed-out when inactive for too long');
});
