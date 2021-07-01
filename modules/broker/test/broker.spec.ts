import * as fs from 'fs';
import * as path from 'path';
import * as semver from 'semver';
import dayjs from 'dayjs';
import fetch from 'node-fetch';
import { Operation as PatchOp } from 'fast-json-patch';
import { URL, URLSearchParams } from 'url';
import { v4 as mkuuid, validate as is_uuid } from 'uuid';

import { Result, JobId } from '@electron/bugbot-shared/lib/interfaces';
import { Auth, AuthScope } from '../src/auth';
import { Server } from '../src/server';

describe('broker', () => {
  let server: Server;
  let authToken: string;
  const base_url = 'http://localhost:9090'; // arbitrary port

  function fixturePath(name) {
    return path.resolve(__dirname, 'fixtures', name);
  }
  function readFixture(name) {
    return fs.readFileSync(fixturePath(name)).toString();
  }

  beforeEach(async () => {
    process.env.BUGBOT_BROKER_URL = base_url;

    const auth = new Auth();
    authToken = auth.createToken([AuthScope.CreateJobs, AuthScope.UpdateJobs]);
    server = new Server({ auth, brokerUrl: base_url });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  describe('authorization', () => {
    it('rejects requests missing authorization header with error code 401', async () => {
      const response = await fetch(new URL('/api/jobs', base_url), {
        method: 'POST',
      });
      expect(response.status).toBe(401);
    });

    it('rejects requests with misformed authorization header with error code 401', async () => {
      const response = await fetch(new URL('/api/jobs', base_url), {
        headers: {
          Authorization: 'just trust me',
        },
        method: 'POST',
      });
      expect(response.status).toBe(401);
    });

    it('rejects requests with unknown auth tokens with error code 403', async () => {
      const response = await fetch(new URL('/api/jobs', base_url), {
        headers: {
          Authorization: `Bearer justTrustMe`,
        },
        method: 'POST',
      });
      expect(response.status).toBe(403);
    });
  });

  function postJob(body) {
    return fetch(new URL('/api/jobs', base_url), {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
  }

  it('errors if scheme is not http nor https', async () => {
    const bad_url = 'sftp://localhost:22';
    process.env.BUGBOT_BROKER_URL = bad_url;
    const sftp_server = new Server({ brokerUrl: bad_url });
    expect(sftp_server.start()).rejects.toThrow('sftp');
    await sftp_server.stop();
  });

  it('can run as an https server', async () => {
    const https_url = 'https://localhost:9991'; // arbitrary port
    const https_server = new Server({
      brokerUrl: https_url,
      cert: readFixture('test.cert'),
      key: readFixture('test.key'),
    });
    await expect(https_server.start()).resolves.not.toThrow();
    await https_server.stop();
  });

  it('uses environmental variables as a fallback', async () => {
    process.env.PORT = '9229';
    process.env.BUGBOT_BROKER_URL = 'https://localhost';
    process.env.BUGBOT_BROKER_CERT_PATH = fixturePath('test.cert');
    process.env.BUGBOT_BROKER_KEY_PATH = fixturePath('test.key');

    const https_server = new Server();
    expect(https_server.brokerUrl).toStrictEqual(
      new URL(`${process.env.BUGBOT_BROKER_URL}:${process.env.PORT}`),
    );
    await expect(https_server.start()).resolves.not.toThrow();
    await https_server.stop();

    delete process.env.PORT;
    delete process.env.BUGBOT_BROKER_URL;
    delete process.env.BUGBOT_BROKER_CERT_PATH;
    delete process.env.BUGBOT_BROKER_KEY_PATH;
  });

  async function postNewBisectJob(params = {}) {
    // fill in defaults for any missing required values
    params = {
      bisect_range: ['10.0.0', '11.2.0'],
      gist: 'abbaabbaabbaabbaabbaabbaabbaabbaabbaabba',
      type: 'bisect',
      ...params,
    };

    const response = await postJob(params);
    const body = await response.text();
    return { body, response };
  }

  async function getJob(id: string) {
    const response = await fetch(new URL(`/api/jobs/${id}`, base_url), {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
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
    const response = await fetch(new URL(`/api/jobs?${params}`, base_url), {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
    const body = await response.json();
    return { body, response };
  }

  describe('/api/jobs (POST)', () => {
    it('creates a bisect job', async () => {
      const { response } = await postNewBisectJob();
      expect(response.status).toBe(201);
    });

    it('returns a job uuid', async () => {
      const { body: id, response } = await postNewBisectJob();
      expect(response.status).toBe(201);
      expect(is_uuid(id)).toBe(true);
    });

    it(`rejects invalid job.bisect_range values`, async () => {
      let bisect_range = ['10.0.0', 'Precise Pangolin'];
      let body;
      let response;
      ({ response, body } = await postNewBisectJob({ bisect_range }));
      expect(response.status).toBe(422);
      expect(body.includes('bisect_range'));

      bisect_range = ['Precise Pangolin', '10.0.0'];
      ({ response, body } = await postNewBisectJob({ bisect_range }));
      expect(response.status).toBe(422);
      expect(body.includes('bisect_range'));
    });

    it('rejects invalid job.platform values', async () => {
      const unknown = 'android';
      const { response, body } = await postNewBisectJob({ platform: unknown });
      expect(response.status).toBe(422);
      expect(body.includes(unknown));
    });

    it('rejects invalid job.type values', async () => {
      const unknown = 'gromify';
      const { response, body } = await postNewBisectJob({ type: unknown });
      expect(response.status).toBe(422);
      expect(body.includes(unknown));
    });

    it('rejects properties that are unknown', async () => {
      const unknown = 'potrzebie';
      const { response, body } = await postNewBisectJob({ [unknown]: unknown });
      expect(response.status).toBe(422);
      expect(body.includes(unknown));
    });

    it('rejects properties that are required but missing', async () => {
      const gist = 'abcdabcdabcdabcdabcdabcdabcdabcdabcdabcd';
      const platform = 'linux';
      const required = ['gist', 'type'];
      const type = 'bisect';

      for (const name of required) {
        const body = { gist, platform, type };
        delete body[name];
        const response = await postJob(body);
        expect(response.status).toBe(422);

        const data = await response.text();
        expect(data.includes(name));
      }
    });
  });

  describe('/api/jobs/$job_id (GET)', () => {
    const bot_client_data = Math.random().toString();
    const gist = 'gist';
    const platform = 'linux';
    const type = 'bisect';
    let id: string;

    beforeEach(async () => {
      const { body } = await postNewBisectJob({
        bot_client_data,
        gist,
        platform,
        type,
      });
      id = body;
    });

    it('includes job.gist', async () => {
      const { body: job } = await getJob(id);
      expect(job.gist).toBe(gist);
    });

    it('includes job.id', async () => {
      const { body: job } = await getJob(id);
      expect(job.id).toBe(id);
    });

    it('includes job.time_added', async () => {
      // confirm the property exists
      const { body: job } = await getJob(id);
      expect(job.time_added).toBeTruthy();

      // confirm it can be parsed
      const time_added_msec = Number.parseInt(job.time_added, 10);
      expect(time_added_msec).not.toBeNaN();

      // confirm the job was created less than a minute ago
      // (in the beforeEach() before this test)
      const time_added = dayjs(time_added_msec);
      const now = dayjs();
      expect(now.diff(time_added, 'minute')).toBe(0);
    });

    it('includes job.type', async () => {
      const { body: job } = await getJob(id);
      expect(job.type).toBe(type);
    });

    it('may include job.bisect_range', async () => {
      const { body: job } = await getJob(id);
      expect(Array.isArray(job.bisect_range)).toBe(true);
      expect(job.bisect_range.length).toEqual(2);
      expect(semver.valid(job.bisect_range[0])).toBeTruthy();
      expect(semver.valid(job.bisect_range[1])).toBeTruthy();
    });

    it('may include job.bot_client_data', async () => {
      const { body: job } = await getJob(id);
      expect(job.bot_client_data).toBe(bot_client_data);
    });

    it('may include job.platform', async () => {
      const { body: job } = await getJob(id);
      expect(job.platform).toBe(platform);
    });

    it.todo('may include job.current');
    it.todo('may include job.last');
  });

  describe('/api/jobs? (GET)', () => {
    it('returns task ids', async () => {
      const { body: id } = await postNewBisectJob();
      const { body: jobs } = await getJobs();
      expect(jobs).toContainEqual(id);
    });

    describe('filters', () => {
      let id_undefined: JobId;
      let id_darwin: JobId;
      let id_linux: JobId;
      let id_win32: JobId;

      async function initPlatformJobs() {
        const responses = await Promise.all([
          postNewBisectJob(),
          postNewBisectJob({ platform: 'darwin' }),
          postNewBisectJob({ platform: 'linux' }),
          postNewBisectJob({ platform: 'win32' }),
        ]);
        [id_undefined, id_darwin, id_linux, id_win32] = responses.map(
          (response) => response.body,
        );
      }

      async function testQuery(platform: string[], expected: string[]) {
        const { body: jobs } = await getJobs({ platform: platform.join(',') });
        expect(jobs.sort()).toStrictEqual(expected.sort());
      }

      it('on single values', async () => {
        await initPlatformJobs();
        await testQuery(['linux'], [id_linux]);
      });

      it('on a set', async () => {
        await initPlatformJobs();
        await testQuery(
          ['darwin', 'linux', 'win32'],
          [id_darwin, id_linux, id_win32],
        );
      });

      it('on a negated single value', async () => {
        await initPlatformJobs();
        const platform = ['linux'];
        const expected = [id_undefined, id_win32, id_darwin].sort();
        const { body: jobs } = await getJobs({
          'platform!': platform.join(','),
        });
        expect(jobs.sort()).toStrictEqual(expected.sort());
      });

      it('on a negated set', async () => {
        await initPlatformJobs();
        const platform = ['linux', 'win32'];
        const expected = [id_undefined, id_darwin].sort();
        const { body: jobs } = await getJobs({
          'platform!': platform.join(','),
        });
        expect(jobs.sort()).toStrictEqual(expected.sort());
      });

      it('on undefined', async () => {
        await initPlatformJobs();
        await testQuery(['undefined'], [id_undefined]);
      });

      it('on an object path', async () => {
        const { body: world_1 } = await postNewBisectJob({
          bot_client_data: { hello: { world: 1 } },
        });
        // shouldn't match: 'world' has different value
        await postNewBisectJob({
          bot_client_data: { hello: { world: 2 } },
        });
        // shouldn't match: 'world' is missing
        await postNewBisectJob({
          bot_client_data: { hello: 3 },
        });
        const { body: jobs } = await getJobs({
          'bot_client_data.hello.world': 1,
        });
        expect(jobs).toStrictEqual([world_1]);
      });

      it('on an object path and a negated set', async () => {
        await postNewBisectJob({
          bot_client_data: { hello: { world: 1 } },
        });
        const { body: id1 } = await postNewBisectJob({
          bot_client_data: { hello: { world: 2 } },
        });
        // shouldn't match: 'world' is missing
        const { body: id2 } = await postNewBisectJob({
          bot_client_data: { hello: 3 },
        });
        const { body: jobs } = await getJobs({
          'bot_client_data.hello.world!': 1,
        });
        expect(jobs.sort()).toStrictEqual([id1, id2].sort());
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

    function patchJob(
      patchId: string,
      patchEtag: string,
      body: Readonly<PatchOp>[],
    ) {
      return fetch(new URL(`/api/jobs/${patchId}`, base_url), {
        body: JSON.stringify(body),
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
          'If-Match': patchEtag,
        },
        method: 'PATCH',
      });
    }

    it('adds properties', async () => {
      const bot_client_data = Math.random().toString();
      const response = await patchJob(id, etag, [
        { op: 'add', path: '/bot_client_data', value: bot_client_data },
      ]);
      expect(response.status).toBe(200);

      const { body: job } = await getJob(id);
      expect(job.bot_client_data).toBe(bot_client_data);
    });

    it('replaces properties', async () => {
      const new_gist = 'new_gist';
      const response = await patchJob(id, etag, [
        { op: 'replace', path: '/gist', value: new_gist },
      ]);
      expect(response.status).toBe(200);

      const { body: job } = await getJob(id);
      expect(job.gist).toBe(new_gist);
    });

    it('removes properties', async () => {
      // add a property
      {
        const bot_client_data = Math.random().toString();
        const response = await patchJob(id, etag, [
          { op: 'add', path: '/bot_client_data', value: bot_client_data },
        ]);
        expect(response.status).toBe(200);

        let job;
        ({ etag, body: job } = await getJob(id));
        expect(job.bot_client_data).toBe(bot_client_data);
      }

      // remove it
      {
        const response = await patchJob(id, etag, [
          { op: 'remove', path: '/bot_client_data' },
        ]);
        expect(response.status).toBe(200);
        const { body: job } = await getJob(id);
        expect(job).not.toHaveProperty('client_data');
      }
    });

    it('patches object types', async () => {
      const result: Result = {
        bisect_range: ['10.0.0', '10.0.1'],
        runner: mkuuid(),
        status: 'success',
        time_begun: Date.now(),
        time_ended: Date.now(),
      };
      const response = await patchJob(id, etag, [
        { op: 'add', path: '/last', value: result },
      ]);
      expect(response.status).toBe(200);

      const { body: job } = await getJob(id);
      expect(job.last).toStrictEqual(result);
    });

    describe('fails if', () => {
      it('the job is not found', async () => {
        const new_gist = 'new_gist';
        const response = await patchJob('unknown-job', etag, [
          { op: 'replace', path: '/gist', value: new_gist },
        ]);
        expect(response.status).toBe(404);
      });

      it('the etag does not match', async () => {
        const new_gist = 'new_gist';
        const response = await patchJob(id, 'unknown-etag', [
          { op: 'replace', path: '/gist', value: new_gist },
        ]);
        expect(response.status).toBe(412);

        const { body: job } = await getJob(id);
        expect(job.gist).not.toBe(new_gist);
      });

      it('the patch is malformed', async () => {
        const new_gist = 'new_gist';
        const body = [{ op: '💩', path: '/gist', value: new_gist }];
        const response = await patchJob(id, etag, body as any);
        expect(response.status).toBe(400);

        const { body: job } = await getJob(id);
        expect(job.gist).not.toBe(new_gist);
      });

      it('the patch changes readonly properties', async () => {
        const path = '/id';
        const new_id = 'poop';
        const response = await patchJob(id, etag, [
          { op: 'replace', path, value: new_id },
        ]);
        expect(response.status).toBe(400);
        expect(await response.text()).toContain(path);

        const { response: res } = await getJob(new_id);
        expect(res.status).toBe(404);
      });
    });

    it('sanitizes its return messages', async () => {
      const malicious_etag = `<a href="http://www.electronjs.org/">Click Me</a>`;
      const new_gist = 'new_gist';
      const response = await patchJob(id, malicious_etag, [
        { op: 'replace', path: '/gist', value: new_gist },
      ]);
      expect(response.status).toBe(412);
      expect(await response.text()).not.toMatch(malicious_etag);
    });
  });

  async function getLog(job_id: string) {
    const response = await fetch(new URL(`/log/${job_id}`, base_url), {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
    const text = await response.text();
    return { body: text, response };
  }

  describe('/log/$job_id (GET)', () => {
    it('errors if the task is unknown', async () => {
      const { response } = await getLog('unknown-job-id');
      expect(response.status).toBe(404);
    });
  });

  describe('/api/jobs/$job_id/log (PUT)', () => {
    function addLogMessages(job_id: string, body = '') {
      return fetch(new URL(`/api/jobs/${job_id}/log`, base_url), {
        body,
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        method: 'PUT',
      });
    }

    it('appends messages viewable in the job.log URL', async () => {
      const { body: job_id } = await postNewBisectJob();

      const lines = ['line 1', 'line 2', 'line 3'];
      for (const line of lines) {
        await addLogMessages(job_id, line);
      }

      const { body } = await getLog(job_id);
      for (const line of lines) {
        expect(body).toMatch(line);
      }
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
