describe('broker', () => {
  describe('/api/jobs (POST)', () => {
    it.todo('creates a job');
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
});
