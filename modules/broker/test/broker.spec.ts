import * as semver from 'semver';
import dayjs from 'dayjs';
import fetch from 'node-fetch';
import { v4 as mkuuid, validate as is_uuid } from 'uuid';

import { Broker } from '../src/broker';
import { Server } from '../src/server';
import { Task } from '../src/task';

describe('broker', () => {
  let broker: Broker;
  let server: Server;
  const port = 9099; // arbitrary
  const base_url = `http://localhost:${port}`;

  beforeEach(async () => {
    const { createBisectTask } = Task;
    broker = new Broker();
    server = new Server({ broker, createBisectTask, port });
    await server.listen();
  });

  afterEach(() => {
    server.close();
  });

  function postJob(body) {
    return fetch(`${base_url}/api/jobs`, {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
  }

  async function postNewBisectJob(params = {}) {
    // fill in defaults for any missing required values
    params = {
      first: '10.0.0',
      gist: 'abbaabbaabbaabbaabbaabbaabbaabbaabbaabba',
      last: '11.2.0',
      type: 'bisect',
      ...params,
    };

    const response = await postJob(params);
    const body = await response.text();
    return { body, response };
  }

  async function getJob(id: string) {
    const response = await fetch(`${base_url}/api/jobs/${id}`);
    const etag = response.headers.get('ETag');
    let body;
    try {
      body = await response.json();
    } catch (err) {
      // empty
    }
    return { body, etag, response };
  }

  async function getJobs(filter = {}) {
    const params = new URLSearchParams();
    for (const [key, val] of Object.entries(filter)) {
      params.set(key, val.toString());
    }
    const response = await fetch(`${base_url}/api/jobs?${params}`);
    const body = await response.json();
    return { body, response };
  }

  describe('/api/jobs (POST)', () => {
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

    it('rejects unknown properties', async () => {
      const unknown = 'potrzebie';
      const { response, body } = await postNewBisectJob({ [unknown]: unknown });
      expect(response.status).toBe(422);
      expect(body.includes(unknown));
    });

    async function rejectsNonSemver(name: string) {
      const unknown = 'Precise Pangolin';
      const { response, body } = await postNewBisectJob({ [name]: unknown });
      expect(response.status).toBe(422);
      expect(body.includes(unknown));
    }

    it(`rejects non-semver 'first'`, async () => {
      await rejectsNonSemver('first');
    });
    it(`rejects non-semver 'last'`, async () => {
      await rejectsNonSemver('last');
    });

    it('checks for required parameters', async () => {
      const gist = 'abcdabcdabcdabcdabcdabcdabcdabcdabcdabcd';
      const os = 'linux';
      const required = ['gist', 'type'];
      const type = 'bisect';

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
    const gist = 'gist';
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
      // confirm the property exists
      const { body: job } = await getJob(id);
      expect(job.time_created).toBeTruthy();

      // confirm it can be parsed
      const time_created_msec = Number.parseInt(job.time_created, 10);
      expect(time_created_msec).not.toBeNaN();

      // confirm the job was created less than a minute ago
      // (in the beforeEach() before this test)
      const time_created = dayjs(time_created_msec);
      const now = dayjs();
      expect(now.diff(time_created, 'minute')).toBe(0);
    });

    it('may include a client_data value', async () => {
      const { body: job } = await getJob(id);
      expect(job.client_data).toBe(client_data);
    });

    it('may include a os value', async () => {
      const { body: job } = await getJob(id);
      expect(job.os).toBe(os);
    });

    it('may include a first and last bisect range', async () => {
      const { body: job } = await getJob(id);
      expect(semver.valid(job.first)).toBeTruthy();
      expect(semver.valid(job.last)).toBeTruthy();
    });

    it.todo('may include a result_bisect value');
    it.todo('may include a time_finished value');
    it.todo('may include a time_started value');
    it.todo('may include an error value');
  });

  describe('/api/jobs? (GET)', () => {
    it('returns task ids', async () => {
      const { body: id } = await postNewBisectJob();
      const { body: jobs } = await getJobs();
      expect(jobs).toContainEqual(id);
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
        expect(jobs).toContain(id_os_lin);
        expect(jobs).toContain(id_os_any);
      });

      it('gist', async () => {
        const { body: a } = await postNewBisectJob({ gist: 'foo' });
        const { body: b } = await postNewBisectJob({ gist: 'foo' });
        await postNewBisectJob({ gist: 'bar' });

        const { body: jobs } = await getJobs({ gist: 'foo' });

        expect(jobs.length).toBe(2);
        expect(jobs).toContain(a);
        expect(jobs).toContain(b);
      });

      it('filters on property-missing with "undefined" keyword', async () => {
        const { body: no_runner_id } = await postNewBisectJob();
        await postNewBisectJob({ runner: 'runner_1' });
        await postNewBisectJob({ runner: 'runner_2' });

        const { body: jobs } = await getJobs({ runner: 'undefined' });
        expect(jobs).toStrictEqual([no_runner_id]);
      });
    });
  });

  describe('/api/jobs/$job_id (PATCH)', () => {
    let etag: string;
    let id: string;

    beforeEach(async () => {
      const { body: post_body } = await postNewBisectJob();
      id = post_body;
      ({ etag } = await getJob(id));
    });

    function patchJob(patchId: string, patchEtag: string, body: any) {
      return fetch(`${base_url}/api/jobs/${patchId}`, {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', 'If-Match': patchEtag },
        method: 'PATCH',
      });
    }

    it('adds properties', async () => {
      const client_data = Math.random().toString();
      const body = [{ op: 'add', path: '/client_data', value: client_data }];
      const response = await patchJob(id, etag, body);
      expect(response.status).toBe(200);

      const { body: job } = await getJob(id);
      expect(job.client_data).toBe(client_data);
    });

    it('replaces properties', async () => {
      const new_gist = 'new_gist';
      const body = [{ op: 'replace', path: '/gist', value: new_gist }];
      const response = await patchJob(id, etag, body);
      expect(response.status).toBe(200);

      const { body: job } = await getJob(id);
      expect(job.gist).toBe(new_gist);
    });

    it('removes properties', async () => {
      // add a property
      {
        const client_data = Math.random().toString();
        const body = [{ op: 'add', path: '/client_data', value: client_data }];
        const response = await patchJob(id, etag, body);
        expect(response.status).toBe(200);

        let job;
        ({ etag, body: job } = await getJob(id));
        expect(job.client_data).toBe(client_data);
      }

      // remove it
      {
        const body = [{ op: 'remove', path: '/client_data' }];
        const response = await patchJob(id, etag, body);
        expect(response.status).toBe(200);
        const { body: job } = await getJob(id);
        expect(job).not.toHaveProperty('client_data');
      }
    });

    it('sets result_bisect as two versions', async () => {
      const goodbad = ['10.0.0', '10.0.1'];
      const response = await patchJob(id, etag, [
        { op: 'add', path: '/result_bisect', value: goodbad },
        { op: 'add', path: '/time_finished', value: Date.now() },
      ]);
        const text = await response.text();
        console.log('text', text);
      expect(response.status).toBe(200);

      const { body: job } = await getJob(id);
      expect(job.result_bisect).toStrictEqual(goodbad);
    });

    describe('fails if', () => {
      it('the job is not found', async () => {
        const new_gist = 'new_gist';
        const body = [{ op: 'replace', path: '/gist', value: new_gist }];
        const response = await patchJob('unknown-job', etag, body);
        expect(response.status).toBe(404);
      });

      it('the etag does not match', async () => {
        const new_gist = 'new_gist';
        const body = [{ op: 'replace', path: '/gist', value: new_gist }];
        const response = await patchJob(id, 'unknown-etag', body);
        expect(response.status).toBe(412);

        const { body: job } = await getJob(id);
        expect(job.gist).not.toBe(new_gist);
      });

      it('the patch is malformed', async () => {
        const new_gist = 'new_gist';
        const body = [{ op: '💩', path: '/gist', value: new_gist }];
        const response = await patchJob(id, etag, body);
        expect(response.status).toBe(400);

        const { body: job } = await getJob(id);
        expect(job.gist).not.toBe(new_gist);
      });

      it('the patch changes readonly properties', async () => {
        const path = '/id';
        const new_id = 'poop';
        const body = [{ op: 'replace', path, value: new_id }];
        const response = await patchJob(id, etag, body);
        expect(response.status).toBe(400);
        expect(await response.text()).toContain(path);

        const { response: res } = await getJob(new_id);
        expect(res.status).toBe(404);
      });
    });
  });

  async function getLog(job_id: string) {
    const response = await fetch(`${base_url}/log/${job_id}`);
    const text = await response.text();
    const lines = `${text}`.split(/\r?\n/);
    return { body: lines, response };
  }

  describe('/log/$job_id (GET)', () => {
    it('errors if the task is unknown', async () => {
      const { response } = await getLog('unknown-job-id');
      expect(response.status).toBe(404);
    });
  });

  describe('/api/jobs/$job_id/log (PUT)', () => {
    function addLogMessages(job_id: string, body = '') {
      return fetch(`${base_url}/api/jobs/${job_id}/log`, {
        body,
        method: 'PUT',
      });
    }

    it('appends messages viewable in the job.log URL', async () => {
      const { body: job_id } = await postNewBisectJob();

      const lines = ['line 1', 'line 2', 'line 3'];
      for (const line of lines) {
        await addLogMessages(job_id, line);
      }

      const { body: log } = await getLog(job_id);
      expect(log).toStrictEqual(lines);
    });

    it('errors if the task is unknown', async () => {
      const response = await addLogMessages('unknown-job-id', 'text');
      expect(response.status).toBe(404);
    });
  });

  it.todo('remembers state when restarted');
  it.todo('rejects unauthenticated requsts');
  it.todo('marks jobs as timed-out when inactive for too long');
});
