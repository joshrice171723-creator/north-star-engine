const assert = require('node:assert/strict');
const { test } = require('node:test');
const { sanitizeObservation, createTraceStore, replayWorkflowTrace } = require('../electron/jobs/automation/trace-store.cjs');
const fixture = require('./fixtures/application-replays/dice-recovery.json');

test('trace storage redacts credentials and removes query strings from observations', () => {
  const observation = sanitizeObservation({ pageFingerprint: 'form-v1', currentUrl: 'https://dice.com/apply?session=secret', password: 'do-not-store', fields: [{ label: 'Email' }] });
  assert.equal(observation.currentUrl, 'https://dice.com/apply');
  assert.equal(observation.password, undefined);
  const saved = [];
  createTraceStore({ repository: { saveWorkflowStep: (entry) => saved.push(entry), listWorkflowSteps: () => saved } }).recordStep({ applicationId: 'app-1', observation, plan: { actionType: 'fill', apiToken: 'hidden' }, execution: { status: 'executed' }, verification: { status: 'verified' } });
  assert.equal(saved[0].plan.apiToken, '[redacted]');
  assert.equal(saved[0].browserState, undefined);
});

test('fixture replay runs locally and reports site-change recovery metrics', async () => {
  const replay = await replayWorkflowTrace({ steps: fixture.steps, onStep: async (step) => ({ outcome: step.outcome, reasonCode: step.reasonCode }) });
  assert.equal(replay.metrics.stepCount, 2);
  assert.equal(replay.metrics.siteChanges, 1);
  assert.equal(replay.metrics.recoverySuccesses, 1);
  assert.deepEqual(replay.steps.map((step) => step.outcome), ['continue', 'continue']);
});
