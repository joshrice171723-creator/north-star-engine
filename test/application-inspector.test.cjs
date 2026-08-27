const test = require('node:test'); const assert = require('node:assert/strict');
const { normalizeSnapshot, INSPECTION_SCRIPT } = require('../electron/jobs/application-inspector.cjs');
test('inspector bounds descriptors and never retains password values', () => {
  const snapshot = normalizeSnapshot({ url: 'https://example.test/app?token=secret', fields: [{ elementType: 'input', inputType: 'password', label: 'Password', value: 'secret' }, ...Array.from({ length: 350 }, () => ({ elementType: 'input', label: 'Name' }))] });
  assert.equal(snapshot.fields.length, 300); assert.equal(snapshot.fields[0].category, 'authentication_captcha'); assert.equal('value' in snapshot.fields[0], false);
});
test('inspector preserves stable identifiers and classifies accessible labels', () => {
  const snapshot = normalizeSnapshot({ url: 'https://example.test/app', fields: [{ elementType: 'input', inputType: 'text', label: 'Email address', id: 'email-field', autocomplete: 'email' }] });
  assert.equal(snapshot.fields[0].id, 'email-field');
  assert.equal(snapshot.fields[0].category, 'identity_contact');
  assert.equal(snapshot.fields[0].fieldFingerprint.length, 32);
});
test('page inspection determines select completion from its value, not its option text', () => {
  assert.match(INSPECTION_SCRIPT, /return !String\(el\.value \|\| ''\)\.trim\(\)/);
  assert.doesNotMatch(INSPECTION_SCRIPT, /el\.value \|\| el\.textContent/);
});
