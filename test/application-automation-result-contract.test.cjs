const assert = require('node:assert/strict');
const { test } = require('node:test');
const { makeWorkflowResult, validateWorkflowResult } = require('../electron/jobs/automation/result-contract.cjs');

test('workflow result normalizes the canonical fields and keeps evidence bounded', () => {
  const result = makeWorkflowResult({ applicationId: 'app-1', jobId: 'job-1', stepId: 'step-1', stepType: 'listing_check', outcome: 'listing_unavailable', confidence: 0.99, reasonCode: 'job_listing_unavailable', evidenceIds: ['trace-1', 'trace-2'] });
  assert.equal(result.status, 'planned');
  assert.equal(result.source, 'deterministic_policy');
  assert.deepEqual(result.evidenceIds, ['trace-1', 'trace-2']);
});

test('workflow result rejects unknown outcomes and unsafe confidence values', () => {
  assert.throws(() => validateWorkflowResult({ applicationId: 'a', jobId: 'j', stepId: 's', stepType: 'x', status: 'verified', outcome: 'submit_now', confidence: 1 }), /outcome/);
  assert.throws(() => validateWorkflowResult({ applicationId: 'a', jobId: 'j', stepId: 's', stepType: 'x', status: 'verified', outcome: 'continue', confidence: 1.2 }), /confidence/);
});
