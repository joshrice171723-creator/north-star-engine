const assert = require('node:assert/strict');
const test = require('node:test');
const { parseGreenhouseBoardUrl, normalizeGreenhouseJob, searchGreenhouseBoard } = require('../electron/greenhouse-provider.cjs');

test('Greenhouse board URLs normalize to the board token', () => {
  assert.deepEqual(parseGreenhouseBoardUrl('https://job-boards.greenhouse.io/xai'), { boardToken: 'xai', boardUrl: 'https://job-boards.greenhouse.io/xai' });
  assert.throws(() => parseGreenhouseBoardUrl('https://example.com/xai'), /public Greenhouse board URL/);
  assert.throws(() => parseGreenhouseBoardUrl('https://job-boards.greenhouse.io/xai/jobs/123'), /job listing/);
});

test('Greenhouse jobs normalize into the shared matcher contract', () => {
  const job = normalizeGreenhouseJob({ id: 42, title: 'AI Engineer', updated_at: '2026-08-14T12:00:00Z', location: { name: 'Remote' }, absolute_url: 'https://job-boards.greenhouse.io/xai/jobs/42', content: '<p>Build <strong>machine learning</strong> systems.</p>' }, 'xai');
  assert.equal(job.providerKey, 'greenhouse');
  assert.equal(job.externalId, '42');
  assert.equal(job.remoteType, 'remote');
  assert.match(job.description, /Build machine learning systems/);
  assert.equal(job.applicationUrl, job.canonicalUrl);
});

test('Greenhouse board search uses the public API without credentials', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    assert.match(String(url), /boards-api\.greenhouse\.io\/v1\/boards\/xai\/jobs\?content=true/);
    assert.equal(options.headers.Accept, 'application/json');
    return { ok: true, status: 200, json: async () => ({ meta: { total: 1 }, jobs: [{ id: 7, title: 'Inference Engineer', location: { name: 'Palo Alto, CA' }, content: '<p>Serve AI models.</p>' }] }) };
  };
  try {
    const result = await searchGreenhouseBoard('https://job-boards.greenhouse.io/xai');
    assert.equal(result.error, null);
    assert.equal(result.boardToken, 'xai');
    assert.equal(result.totalAvailable, 1);
    assert.equal(result.jobs[0].title, 'Inference Engineer');
  } finally { global.fetch = originalFetch; }
});
