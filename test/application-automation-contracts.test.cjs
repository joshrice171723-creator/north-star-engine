'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { observePage } = require('../electron/jobs/automation/observation.cjs');
const { planNextStep, classifyPageType } = require('../electron/jobs/automation/planner.cjs');
const { createSafeExecutor } = require('../electron/jobs/automation/executor.cjs');
const { createStepVerifier } = require('../electron/jobs/automation/verifier.cjs');

test('phase two contracts observe bounded page state and plan an exact safe handoff', () => {
  const observation = observePage({ browserState: { currentUrl: 'https://dice.example/apply', currentHost: 'dice.example', snapshot: { pageTitle: 'Job', pageFingerprint: 'fp-1', fields: [{ category: 'navigation', label: 'Apply now' }], pageSignals: ['bounded'] } } });
  const plan = planNextStep({ observation });
  assert.equal(plan.actionType, 'handoff');
  assert.equal(plan.targetFingerprint, 'fp-1');
  assert.equal(plan.targetLabel, 'Apply now');
  assert.deepEqual(observation.pageSignals, ['bounded']);
});

test('phase two executor and verifier never expose a submit action', async () => {
  const calls = [];
  const browser = { advance: async (input) => { calls.push(input); return { status: 'advanced' }; } };
  const executor = createSafeExecutor({ browser });
  const plan = { actionType: 'handoff', targetFingerprint: 'fp-2' };
  const execution = await executor(plan);
  const verification = await createStepVerifier({ observe: async () => ({ pageFingerprint: 'fp-2' }) })({ plan, execution, applicationId: 'app-1' });
  assert.deepEqual(calls, [{ handoffOnly: true }]);
  assert.equal(verification.outcome, 'continue');
});

test('phase two verifier classifies unavailable listings as terminal queue transitions', async () => {
  const verifier = createStepVerifier({ observe: async () => ({ pageFingerprint: 'fp-3' }) });
  const result = await verifier({ plan: { targetFingerprint: 'fp-3' }, execution: { status: 'unavailable', reason: 'job_listing_unavailable', signals: ['closed'] }, applicationId: 'app-1' });
  assert.equal(result.outcome, 'listing_unavailable');
  assert.equal(result.status, 'verified');
});

test('phase two planner classifies login and protected form checkpoints without authorizing submission', () => {
  const login = { pageFingerprint: 'login-fp', pageTitle: 'Sign in', fields: [{ category: 'navigation', label: 'Continue with Google' }] };
  assert.equal(classifyPageType(login), 'login');
  assert.equal(planNextStep({ observation: login }).actionType, 'open_google_login');
  const form = { pageFingerprint: 'form-fp', pageTitle: 'Application', fields: [{ inputType: 'file', category: 'protected', label: 'Resume upload' }] };
  assert.equal(classifyPageType(form), 'application_form');
  assert.equal(planNextStep({ observation: form }).actionType, 'pause_for_user');
});
