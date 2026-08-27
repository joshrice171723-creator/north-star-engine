const assert = require('node:assert/strict');
const { test } = require('node:test');
const { OUTCOME_POLICY, applyTransition, transitionPlan } = require('../electron/jobs/automation/transition-policy.cjs');

const result = (outcome, overrides = {}) => ({ applicationId: 'app-1', jobId: 'job-1', stepId: 'step-1', stepType: 'listing_check', status: 'verified', outcome, confidence: 0.99, ...overrides });

test('every canonical outcome has an explicit queue policy', () => {
  assert.deepEqual(Object.keys(OUTCOME_POLICY).sort(), ['completed', 'continue', 'listing_unavailable', 'needs_user', 'ready_for_review', 'retryable_failure', 'submitted_pending_verification', 'terminal_failure', 'unsupported_site'].sort());
  assert.equal(transitionPlan(result('continue'), { currentApplicationState: 'detecting_form' }).applicationState, 'detecting_form');
  assert.equal(transitionPlan(result('completed')).jobStage, 'applied');
});

test('unavailable listing centrally blocks the application and archives the job', () => {
  const calls = [];
  const applied = applyTransition(result('listing_unavailable', { reasonCode: 'job_listing_unavailable', nextCheckpoint: 'terminal_archive' }), {
    application: { automationState: 'opening' },
    job: { stage: 'ready' },
    repository: {
      updateApplicationState(input) { calls.push(['application', input]); return { automationState: input.state }; },
      archiveUnavailableJob(jobId) { calls.push(['job', jobId]); return { id: jobId, stage: 'rejected' }; },
      recordEvent(input) { calls.push(['event', input]); },
    },
  });
  assert.equal(applied.status, 'applied');
  assert.deepEqual(calls.map(([kind]) => kind), ['application', 'job', 'event']);
  assert.equal(calls[0][1].state, 'blocked');
  assert.equal(calls[0][1].checkpoint.stage, 'terminal_archive');
  assert.equal(calls[1][1], 'job-1');
});

test('reapplying an already terminal outcome is idempotent', () => {
  let updates = 0;
  const applied = applyTransition(result('listing_unavailable'), {
    application: { automationState: 'blocked' },
    job: { stage: 'rejected' },
    repository: { updateApplicationState() { updates += 1; }, archiveUnavailableJob() { updates += 1; } },
  });
  assert.equal(applied.status, 'already_applied');
  assert.equal(updates, 0);
});
