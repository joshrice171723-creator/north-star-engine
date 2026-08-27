const test = require('node:test');
const assert = require('node:assert/strict');
const { generatePassword, validateGeneratedCredential } = require('../electron/jobs/automation/account-credentials.cjs');

test('generated passwords satisfy complexity and length requirements', () => {
  const password = generatePassword();
  assert.ok(password.length >= 16 && password.length <= 64);
  assert.match(password, /[a-z]/);
  assert.match(password, /[A-Z]/);
  assert.match(password, /[0-9]/);
});

test('generation is randomized across calls', () => {
  const seen = new Set(Array.from({ length: 20 }, () => generatePassword()));
  assert.equal(seen.size > 1, true);
});

test('credential validation rejects weak or malformed material', () => {
  assert.throws(() => validateGeneratedCredential({ username: 'not-an-email', password: generatePassword() }), /valid email/);
  assert.throws(() => validateGeneratedCredential({ username: 'a@b.co', password: 'short' }), /16 and 64/);
  assert.equal(validateGeneratedCredential({ username: '  User@Example.COM ', password: generatePassword() }).username, 'user@example.com');
});
