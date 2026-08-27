const test = require('node:test');
const assert = require('node:assert/strict');
const { matchSubmissionConfirmation } = require('../electron/jobs/application-confirmation-email.cjs');
const { classifyApplicationFailure, classifyWorkflowFailure, classifySafePassFailure, boundedRetry } = require('../electron/jobs/application-reliability.cjs');

test('submission confirmation requires explicit language and current job evidence', () => {
  const base = { id: 'email-1', recipients: 'josh@example.com', receivedAt: '2026-08-23T15:05:00Z', subject: 'Application received', body: 'Thank you for applying to Acme for the Forward Deployed Engineer role. Confirmation number: ABC-123.' };
  const match = matchSubmissionConfirmation({ email: base, candidateEmail: 'josh@example.com', application: { applicationUrl: 'https://jobs.example.com/apply' }, job: { company: 'Acme', roleTitle: 'Forward Deployed Engineer' }, requestedAt: '2026-08-23T15:00:00Z', now: '2026-08-23T15:10:00Z' });
  assert.deepEqual(match.signals, ['explicit_submission_language', 'employer_match', 'role_match']);
  assert.equal(match.confirmationNumber, 'ABC-123');
  assert.equal(matchSubmissionConfirmation({ email: { ...base, subject: 'Weekly job alert', body: 'Thank you for applying? Unsubscribe from alerts.' }, candidateEmail: 'josh@example.com', job: { company: 'Acme', roleTitle: 'Forward Deployed Engineer' } }), null);
  assert.equal(matchSubmissionConfirmation({ email: base, candidateEmail: 'other@example.com', job: { company: 'Acme', roleTitle: 'Forward Deployed Engineer' } }), null);
});

test('submission matching rejects account mail and accepts delayed numbered confirmation once', () => {
  const context = { candidateEmail: 'josh@example.com', application: { applicationUrl: 'https://jobs.example.com/apply' }, job: { company: 'Acme', roleTitle: 'Forward Deployed Engineer' }, requestedAt: '2026-08-23T15:00:00Z', now: '2026-08-23T17:00:00Z' };
  assert.equal(matchSubmissionConfirmation({ ...context, email: { id: 'activation', recipients: 'josh@example.com', receivedAt: '2026-08-23T15:01:00Z', subject: 'Activate your account', body: 'Verify your email address to finish creating your Acme account.' } }), null);
  const delayed = matchSubmissionConfirmation({ ...context, email: { id: 'delayed-confirmation', recipients: 'josh@example.com', receivedAt: '2026-08-23T16:45:00Z', subject: 'Application received', body: 'Thank you for applying to Acme for the Forward Deployed Engineer role. Application ID: FDE-2048.' } });
  assert.equal(delayed.confirmationNumber, 'FDE-2048');
  assert.equal(delayed.emailId, 'delayed-confirmation');
});

test('failure classification is bounded and retry policy never retries protected actions', () => {
  assert.deepEqual(classifyApplicationFailure({ code: 'network_timeout', message: 'Timed out' }), { class: 'network', retryable: true, reasonCode: 'network_timeout', message: 'Timed out' });
  assert.equal(boundedRetry({ attempt: 0, maxAttempts: 2, failure: { code: 'network_timeout' } }).exhausted, false);
  assert.equal(boundedRetry({ attempt: 0, maxAttempts: 2, failure: { code: 'captcha_detected' } }).exhausted, true);
});

test('workflow failure classification preserves retryable and user-decision distinctions', () => {
  assert.equal(classifyWorkflowFailure({ code: 'network_timeout' }).outcome, 'retryable_failure');
  assert.equal(classifyWorkflowFailure({ code: 'unsupported_site' }).outcome, 'unsupported_site');
  assert.equal(classifyWorkflowFailure({ code: 'captcha_detected' }).outcome, 'needs_user');
  assert.equal(classifyWorkflowFailure({ code: 'unknown_question' }).requiresUser, true);
});

test('safe-pass failures use AI-repair results before queueing and stop protected-field churn', () => {
  assert.deepEqual(classifySafePassFailure({ error: { code: 'protected_action' }, plan: { fields: [] } }), { state: 'needs_user_answer', reasonCode: 'safe_pass_requires_user', retryable: false, exhausted: false, protectedFieldCount: 0 });
  assert.equal(classifySafePassFailure({ error: { code: 'network_timeout' }, plan: { fields: [] }, attempt: 1 }).state, 'queued');
  assert.equal(classifySafePassFailure({ error: { code: 'network_timeout' }, attempt: 2 }).reasonCode, 'safe_pass_retry_exhausted');
  assert.equal(classifySafePassFailure({ error: { code: 'ai_plan_missing' } }).state, 'queued');
  assert.equal(classifySafePassFailure({ error: { message: 'The selected resume and cover letter could not both be resolved.' } }).state, 'needs_user_answer');
  assert.equal(classifySafePassFailure({ error: { code: 'unknown' }, plan: { fields: [{ action: 'blocked' }] } }).state, 'needs_user_answer');
});
