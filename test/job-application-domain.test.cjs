const assert = require('node:assert/strict');
const test = require('node:test');
const { assertTransition, computeApplicationReadiness } = require('../electron/jobs/application-domain.cjs');

test('application transitions fail closed and renderer cannot submit', () => {
  assert.throws(() => assertTransition('drafting', 'submitted'), /submission is not available/);
  assert.throws(() => assertTransition('drafting', 'ready_to_submit'), /Cannot transition/);
  assert.doesNotThrow(() => assertTransition('drafting', 'needs_user_input'));
});

test('readiness reports missing candidate facts deterministically', () => {
  assert.deepEqual(computeApplicationReadiness({ job: {}, profile: {}, resume: {} }), { ready: false, completed: ['job_saved'], missing: ['application_url', 'full_name', 'email', 'phone', 'master_resume'], warnings: ['work_authorization_not_set', 'sponsorship_not_set'], blocked: [] });
});
