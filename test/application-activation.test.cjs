const test = require('node:test');
const assert = require('node:assert/strict');
const { activationCandidateFromEmail, matchActivationEmails, credentialReference, redactActivationUrl } = require('../electron/jobs/application-activation.cjs');

test('activation matcher accepts a host-matched HTTPS link without persisting its token', () => {
  const candidate = activationCandidateFromEmail({ id: 'gmail-1', subject: 'Activate your account', sender: 'no-reply@fixture-employer.test', recipients: 'Joshua@example.com', receivedAt: '2026-08-23T12:00:00.000Z', body: 'Please activate: https://fixture-employer.test/activate?token=secret-token#one' }, { host: 'fixture-employer.test', recipient: 'joshua@example.com', requestedAt: '2026-08-23T11:00:00.000Z' });
  assert.equal(candidate.activationUrl, 'https://fixture-employer.test/activate?token=secret-token#one');
  assert.equal(candidate.activationUrlRedacted, 'https://fixture-employer.test/activate');
  assert.equal(candidate.code, '');
  assert.doesNotMatch(JSON.stringify({ ...candidate, activationUrl: undefined }), /secret-token/);
});

test('activation matcher accepts a bounded code and rejects unrelated or stale mail', () => {
  const email = { id: 'gmail-2', subject: 'Email verification', sender: 'support@fixture-employer.test', recipients: 'joshua@example.com', receivedAt: '2026-08-23T12:00:00.000Z', body: 'Your verification code is Q7R9T2.' };
  const candidate = activationCandidateFromEmail(email, { host: 'fixture-employer.test', recipient: 'joshua@example.com', requestedAt: '2026-08-23T11:00:00.000Z' });
  assert.equal(candidate.code, 'Q7R9T2');
  assert.equal(candidate.codeHash.length, 64);
  assert.equal(activationCandidateFromEmail({ ...email, receivedAt: '2026-08-22T12:00:00.000Z' }, { host: 'fixture-employer.test', recipient: 'joshua@example.com', requestedAt: '2026-08-23T11:00:00.000Z' }), null);
  assert.equal(activationCandidateFromEmail({ ...email, subject: 'Weekly job alert', body: 'Activate your preferences at https://fixture-employer.test/activate' }, { host: 'fixture-employer.test', recipient: 'joshua@example.com' }), null);
});

test('activation matching is deterministic and account references are host/user scoped', () => {
  const emails = [
    { id: 'older', subject: 'Verify email', sender: 'support@fixture-employer.test', recipients: 'joshua@example.com', receivedAt: '2026-08-23T11:00:00.000Z', body: 'Code: ABC123' },
    { id: 'newer', subject: 'Activate account', sender: 'no-reply@fixture-employer.test', recipients: 'joshua@example.com', receivedAt: '2026-08-23T12:00:00.000Z', body: 'https://fixture-employer.test/verify?id=1' },
  ];
  assert.equal(matchActivationEmails(emails, { host: 'fixture-employer.test', recipient: 'joshua@example.com' }).messageId, 'newer');
  assert.equal(credentialReference('https://Fixture-Employer.test', 'Joshua@example.com'), credentialReference('fixture-employer.test', 'joshua@example.com'));
  assert.notEqual(credentialReference('other-employer.test', 'joshua@example.com'), credentialReference('fixture-employer.test', 'joshua@example.com'));
  assert.equal(redactActivationUrl('https://fixture-employer.test/verify?id=1#token'), 'https://fixture-employer.test/verify');
});
