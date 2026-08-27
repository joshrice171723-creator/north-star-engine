const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeAutonomyLevel,
  isAutonomous,
  answerConfidenceThreshold,
  generatedCredentialsEnabled,
  preauthorizedAnswerFor,
  matchingAttestationTemplate,
  canAiAnswer,
} = require('../electron/jobs/automation/autonomy-policy.cjs');

test('autonomy level defaults to supervised and only accepts known levels', () => {
  assert.equal(normalizeAutonomyLevel(undefined), 'supervised');
  assert.equal(normalizeAutonomyLevel('AUTONOMOUS'), 'autonomous');
  assert.equal(normalizeAutonomyLevel('yolo'), 'supervised');
  assert.equal(isAutonomous({}), false);
  assert.equal(isAutonomous({ autonomyLevel: 'autonomous' }), true);
});

test('confidence threshold is clamped to a bounded safe range', () => {
  assert.equal(answerConfidenceThreshold({}), 0.7);
  assert.equal(answerConfidenceThreshold({ autonomyAnswerConfidence: 0.1 }), 0.5);
  assert.equal(answerConfidenceThreshold({ autonomyAnswerConfidence: 1 }), 0.95);
  assert.equal(answerConfidenceThreshold({ autonomyAnswerConfidence: 0.8 }), 0.8);
});

test('generated credentials are opt-in', () => {
  assert.equal(generatedCredentialsEnabled({}), false);
  assert.equal(generatedCredentialsEnabled({ generatedCredentialsEnabled: true }), true);
});

test('protected categories resolve only through an approved pre-authorization', () => {
  const field = { label: 'Current salary' };
  assert.equal(preauthorizedAnswerFor(field, {}), null);
  assert.equal(preauthorizedAnswerFor(field, { preAuthorizedPolicies: [{ category: 'current_salary' }] }), null);
  const decision = preauthorizedAnswerFor(field, { preAuthorizedPolicies: [{ category: 'current_salary', answerText: '$120,000' }] });
  assert.equal(decision.value, '$120,000');
  assert.deepEqual(decision.provenance, ['preauthorized_policy.current_salary']);
});

test('pre-authorization never applies outside its protected category list', () => {
  // Ordinary employer questions are the question-answerer's job; a policy
  // entry must not leak into them.
  assert.equal(preauthorizedAnswerFor({ label: 'Why are you a good fit?' }, { preAuthorizedPolicies: [{ category: 'free_text', answerText: 'Because' }] }), null);
});

test('attestation checkboxes match only pre-authorized template text', () => {
  const profile = { preAuthorizedAttestations: ['I am legally authorized to work in the United States.'] };
  assert.equal(matchingAttestationTemplate('', profile), null);
  assert.equal(matchingAttestationTemplate('I certify that I am legally authorized to work in the United States.', profile), 'I am legally authorized to work in the United States.');
  // Short templates cannot swallow unrelated agreements.
  assert.equal(matchingAttestationTemplate('I accept the terms.', { preAuthorizedAttestations: ['I accept'] }), null);
  // Unmatched novel attestations stay user-gated.
  assert.equal(matchingAttestationTemplate('I waive my right to sue.', profile), null);
});

test('AI answering excludes protected and identity categories', () => {
  assert.equal(canAiAnswer({ label: 'How many years of React experience do you have?', empty: true }), true);
  assert.equal(canAiAnswer({ label: 'Password', inputType: 'password' }), false);
  assert.equal(canAiAnswer({ label: 'MFA code', inputType: 'text' }), false);
  assert.equal(canAiAnswer({ label: 'Current salary' }), false);
  assert.equal(canAiAnswer({ label: 'First name' }), false);
  assert.equal(canAiAnswer({ label: 'Already filled', empty: false }), false);
});
