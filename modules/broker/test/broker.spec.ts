import fetch from 'node-fetch';
import { validate as is_uuid } from 'uuid';

import { Broker } from '../src/broker';
import { Server } from '../src/server';

describe('broker', () => {
  let broker: Broker;
  let server: Server;
  const port = 8088;

  beforeEach(() => {
    broker = new Broker();
    server = new Server({ broker, port });
    server.listen();
  });

  afterEach(() => {
    server.close();
  });

  describe('/api/jobs (POST)', () => {
    const gist = 'abcdabcdabcdabcdabcdabcdabcdabcdabcdabcd';
    const os = 'linux';

    it('creates a bisect job', async () => {
      const response = await fetch(`http://localhost:${port}/api/jobs`, {
        body: JSON.stringify({ gist, os }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const data = await response.json();
      expect(is_uuid(data)).toBe(true);
    });

    it.todo('rejects unknown operating systems');
    it.todo('remembers client_data');
    it.todo('requires a gist');
    it.todo('returns a job uuid');
  });

  describe('/api/jobs/$job_id (GET)', () => {
    it.todo('includes a gist');
    it.todo('includes a job id');
    it.todo('includes a log url');
    it.todo('includes a time_created value');
    it.todo('includes a type');
    it.todo('includes client_data when set');
    it.todo('may include a result_bisect value');
    it.todo('may include a time_finished value');
    it.todo('may include a time_started value');
    it.todo('may include an error value');
    it.todo('may include an os value');
  });

  describe('/api/jobs? (GET)', () => {
    it.todo('returns objects identical to /api/jobs/$job_id');
    describe('filters by job properties in query parameters', () => {
      it.todo('os');
      it.todo('runner');
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
