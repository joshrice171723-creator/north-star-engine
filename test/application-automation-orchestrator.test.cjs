const assert = require('node:assert/strict');
const { test } = require('node:test');
const { makeIdempotencyKey } = require('../electron/jobs/automation/idempotency.cjs');
const { createApplicationOrchestrator } = require('../electron/jobs/automation/orchestrator.cjs');

const base = { id: 'app-1', jobId: 'job-1', automationState: 'queued', atsKey: 'dice' };

test('idempotency keys are stable for the same checkpoint action and distinct across targets', () => {
  const first = makeIdempotencyKey({ applicationId: 'app-1', checkpointVersion: 2, actionType: 'click_apply', targetFingerprint: 'page-a' });
  assert.equal(first, makeIdempotencyKey({ applicationId: 'app-1', checkpointVersion: 2, actionType: 'click_apply', targetFingerprint: 'page-a' }));
  assert.notEqual(first, makeIdempotencyKey({ applicationId: 'app-1', checkpointVersion: 2, actionType: 'click_apply', targetFingerprint: 'page-b' }));
});

test('orchestrator executes and records one safe step, then replays a completed idempotency key', async () => {
  const calls = [];
  const repository = {
    getApplication: () => base,
    getJob: () => ({ id: 'job-1', stage: 'ready' }),
    findCompletedStep: (key) => calls.find((entry) => entry[0] === 'step' && entry[1] === key)?.[2] || null,
    recordStep: (entry) => calls.push(['step', entry.idempotencyKey, entry]),
    updateApplicationState: (input) => { calls.push(['state', input]); return { ...base, automationState: input.state }; },
    recordEvent: (input) => calls.push(['event', input]),
  };
  const orchestrator = createApplicationOrchestrator({
    repository,
    observePage: async () => ({ pageFingerprint: 'page-a', pageType: 'application_form' }),
    planNextStep: async () => ({ actionType: 'fill_approved_field', targetFingerprint: 'page-a', stepType: 'fill_field', confidence: 0.98 }),
    executeSafeStep: async (plan) => { calls.push(['execute', plan.idempotencyKey]); return { status: 'executed' }; },
    verifyStepResult: async () => ({ status: 'verified', outcome: 'continue', confidence: 0.98 }),
  });
  const first = await orchestrator.runApplicationCheckpoint({ applicationId: 'app-1', checkpoint: { version: 1 } });
  assert.equal(first.status, 'continued');
  assert.equal(calls.filter(([kind]) => kind === 'execute').length, 1);
  const second = await orchestrator.runApplicationCheckpoint({ applicationId: 'app-1', checkpoint: { version: 1 } });
  assert.equal(second.status, 'replayed');
  assert.equal(calls.filter(([kind]) => kind === 'execute').length, 1);
});

test('playbook persistence failure does not fail a verified workflow checkpoint', async () => {
  const calls = [];
  const orchestrator = createApplicationOrchestrator({
    repository: { getApplication: () => base, getJob: () => ({ id: 'job-1', stage: 'ready' }), recordStep: () => {}, recordEvent: (entry) => calls.push(entry), updateApplicationState: () => base },
    playbookRegistry: { recordVerifiedSuccess: () => { throw new Error('learning storage unavailable'); } },
    observePage: async () => ({ pageFingerprint: 'page-a', pageType: 'application_form', site: 'dice.example' }),
    planNextStep: async () => ({ actionType: 'handoff', targetFingerprint: 'page-a', stepType: 'safe_navigation', confidence: 0.98 }),
    executeSafeStep: async () => ({ status: 'executed' }),
    verifyStepResult: async () => ({ status: 'verified', outcome: 'continue', confidence: 0.98 }),
  });
  const result = await orchestrator.runApplicationCheckpoint({ applicationId: 'app-1', checkpoint: { version: 1 } });
  assert.equal(result.status, 'continued');
  assert.equal(result.learning.status, 'deferred');
  assert.equal(calls[0].eventType, 'playbook_persistence_failed');
});
