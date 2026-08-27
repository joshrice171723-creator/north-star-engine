const test = require('node:test');
const assert = require('node:assert/strict');
const { salaryExpectation, answerPolicyForField } = require('../electron/jobs/automation/answer-policy.cjs');
const { decideField } = require('../electron/jobs/application-policy.cjs');

test('salary policy calculates from the advertised range and uses the required fallback', () => {
  assert.equal(salaryExpectation({ advertisedMinimum: 100000, advertisedMaximum: 150000 }), 110000);
  assert.equal(salaryExpectation({ advertisedMinimum: 150000, advertisedMaximum: 200000 }), 160000);
  assert.equal(salaryExpectation({}), 120000);
});

test('salary fields use the current job range instead of a stale reusable answer', () => {
  const decision = decideField({ elementType: 'input', label: 'Desired salary' }, { profile: { jobContext: { salaryMin: 100000, salaryMax: 150000 }, reusableAnswers: [{ questionKey: 'desired salary', answerText: '90000' }] } });
  assert.equal(decision.action, 'fill');
  assert.equal(decision.value, '110000');
  assert.deepEqual(decision.provenance, ['job.salaryRange', 'policy.salaryExpectation']);
});

test('current salary and protected fields remain user-gated', () => {
  assert.equal(answerPolicyForField({ label: 'Current salary' }).action, 'ask');
  assert.equal(answerPolicyForField({ label: 'Legal attestation' }).action, 'ask');
  assert.equal(answerPolicyForField({ label: 'MFA code', inputType: 'text' }).action, 'blocked');
});

test('common employer wording maps salary requirements and skills experience to safe categories', () => {
  assert.equal(answerPolicyForField({ label: 'What are your salary requirements?' }).category, 'salary_expectation');
  assert.equal(answerPolicyForField({ label: 'What is your experience with Service Oriented Architecture?' }).category, 'free_text');
  assert.equal(answerPolicyForField({ label: 'What current version(s) of Angular do you have experience with?' }).category, 'free_text');
});
