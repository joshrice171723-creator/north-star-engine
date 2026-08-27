const assert = require('node:assert/strict');
const test = require('node:test');
const { buildAdzunaParams, normalizeAdzunaItem, searchAdzuna } = require('../electron/adzuna-provider.cjs');

test('Adzuna request uses documented US search parameters', () => {
  const params = buildAdzunaParams({ positionTitle: 'Data Scientist' }, { locationName: 'Dallas, TX' }, 2, { minimumSalary: 90000 });
  assert.equal(params.get('what'), 'Data Scientist');
  assert.equal(params.get('where'), 'Dallas, TX');
  assert.equal(params.get('salary_min'), '90000');
  assert.equal(params.get('page'), null);
  assert.equal(params.get('content-type'), 'application/json');
  assert.equal(params.get('app_id'), null);
  assert.equal(params.get('app_key'), null);
});

test('Adzuna normalization returns the shared job shape', () => {
  const job = normalizeAdzunaItem({ id: 42, title: 'ML Engineer', description: 'Build machine learning systems.', redirect_url: 'https://example.test/job/42', company: { display_name: 'Example' }, location: { display_name: 'Dallas, TX' }, salary_min: 100000, salary_max: 130000, created: '2026-08-08T00:00:00Z' }, { laneId: 'lane-1' });
  assert.equal(job.providerKey, 'adzuna');
  assert.equal(job.externalId, '42');
  assert.equal(job.company, 'Example');
  assert.equal(job.salaryMin, 100000);
  assert.equal(job.searchEvidence.laneId, 'lane-1');
});

test('Adzuna search returns safe diagnostics and never exposes credentials', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.match(String(url), /app_id=app-1/);
    assert.match(String(url), /app_key=key-1/);
    return { ok: true, status: 200, json: async () => ({ count: 1, results: [{ id: 1, title: 'Software Engineer', redirect_url: 'https://example.test/1' }] }) };
  };
  try {
    const result = await searchAdzuna({ credentials: { adzunaAppId: 'app-1', adzunaApiKey: 'key-1' }, lane: { positionTitle: 'Software Engineer' }, scope: {}, page: 1 });
    assert.equal(result.resultCount, 1);
    assert.equal(result.diagnostics.httpStatus, 200);
    assert.doesNotMatch(JSON.stringify(result), /app-1|key-1/);
  } finally { global.fetch = originalFetch; }
});

test('Adzuna HTTP errors include safe provider detail without credentials', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: 'Invalid location parameter' }) });
  try {
    const result = await searchAdzuna({ credentials: { adzunaAppId: 'app-1', adzunaApiKey: 'key-1' }, lane: { positionTitle: 'Software Engineer' }, scope: { locationName: 'TX' }, page: 1 });
    assert.equal(result.error.code, 'provider_error');
    assert.match(result.error.message, /Invalid location parameter/);
    assert.equal(result.diagnostics.errorSummary, 'Invalid location parameter');
    assert.doesNotMatch(JSON.stringify(result), /app-1|key-1/);
  } finally { global.fetch = originalFetch; }
});