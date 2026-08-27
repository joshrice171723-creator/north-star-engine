const assert = require('node:assert/strict');
const test = require('node:test');
const { createN8nEventClient, createLangSmithRunClient, publicConfig } = require('../electron/job-search-integrations.cjs');

test('LangSmith tracing is opt-in and reports redacted run metadata', async () => {
  const calls = [];
  const client = { createRun: async (input) => calls.push(['create', input]), updateRun: async (id, input) => calls.push(['update', id, input]) };
  const tracer = createLangSmithRunClient({ env: { LANGCHAIN_API_KEY: 'test-key', LANGCHAIN_TRACING_V2: 'true', LANGCHAIN_PROJECT: 'test-project' }, client });
  await tracer.start({ runId: 'run-1', inputs: { targetRoleCount: 1 }, metadata: { workflow: 'job-search' } });
  await tracer.end({ runId: 'run-1', outputs: { selectedCount: 2 } });
  assert.equal(calls[0][1].project_name, 'test-project');
  assert.deepEqual(calls[0][1].inputs, { targetRoleCount: 1 });
  assert.equal(calls[1][2].outputs.selectedCount, 2);
  const disabled = createLangSmithRunClient({ env: { LANGCHAIN_API_KEY: 'test-key', LANGCHAIN_TRACING_V2: 'false' }, client });
  assert.equal(await disabled.start({ runId: 'run-2', inputs: { secret: 'not sent' } }), null);
});

test('integration status reports the four job-search building blocks', () => {
  const status = publicConfig({ OPENROUTER_API_KEY: 'configured', LANGCHAIN_API_KEY: 'configured', N8N_JOB_SEARCH_WEBHOOK_URL: 'https://n8n.example/webhook/jobs' });
  assert.equal(status.langChain.configured, true);
  assert.equal(status.langGraph.configured, true);
  assert.equal(status.langSmith.configured, true);
  assert.equal(status.n8n.configured, true);
});

test('n8n event client sends event metadata without caller secrets', async () => {
  let request;
  const client = createN8nEventClient({
    env: { N8N_JOB_SEARCH_WEBHOOK_URL: 'https://n8n.example/webhook/jobs' },
    fetchImpl: async (_url, options) => { request = JSON.parse(options.body); return { ok: true, status: 200 }; },
  });
  const result = await client.emit('job_search.completed', { runId: 'run-1', resultCount: 3 });
  assert.deepEqual(result, { sent: true, status: 200 });
  assert.equal(request.event, 'job_search.completed');
  assert.equal(request.runId, 'run-1');
  assert.equal(request.resultCount, 3);
  assert.equal(request.resume, undefined);
  assert.equal(request.credentials, undefined);
});

test('n8n event client does not make a request when the webhook is not configured', async () => {
  let called = false;
  const client = createN8nEventClient({ env: {}, fetchImpl: async () => { called = true; } });
  assert.deepEqual(await client.emit('job_search.started', { runId: 'run-2' }), { sent: false, reason: 'not_configured' });
  assert.equal(called, false);
});
