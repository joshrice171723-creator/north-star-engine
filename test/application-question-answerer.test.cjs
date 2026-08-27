const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAnswerMessages, parseAnswerResponse, reusableQuestionKeyForLabel } = require('../electron/jobs/automation/question-answerer.cjs');

const FIELDS = [
  { fieldFingerprint: 'f1', label: 'How many years of React experience do you have?', elementType: 'input', inputType: 'text', required: true, options: [] },
  { fieldFingerprint: 'f2', label: 'Are you legally authorized to work in the US?', elementType: 'select', inputType: 'select', required: true, options: ['Yes', 'No'] },
  { fieldFingerprint: 'f3', label: 'Current salary', elementType: 'input', inputType: 'text', required: false, options: [] },
];

test('answer prompt carries bounded field metadata and evidence but never values', () => {
  const messages = buildAnswerMessages({ fields: FIELDS, profile: { yearsExperience: 6 }, resumeText: 'Senior engineer...', job: { roleTitle: 'Frontend Engineer', company: 'Example' } });
  assert.equal(messages.length, 2);
  const user = typeof messages[1].content === 'string' ? messages[1].content : JSON.stringify(messages[1].content);
  assert.match(user, /How many years of React experience/);
  assert.match(user, /"yearsExperience":6/);
  assert.doesNotMatch(user, /fieldValue/);
});

test('accepted answers require exact option match and threshold confidence', () => {
  const response = { message: { content: JSON.stringify({ fields: [
    { fieldFingerprint: 'f1', answer: 'Six years building React applications.', confidence: 0.9, reason: 'Resume states 6 years.' },
    { fieldFingerprint: 'f2', answer: 'Yes', confidence: 0.95, reason: 'Work authorization verified in profile.' },
    { fieldFingerprint: 'f3', answer: '$90,000', confidence: 0.99 },
    { fieldFingerprint: 'f2', answer: 'Maybe', confidence: 0.99 },
    { fieldFingerprint: 'unknown-fp', answer: 'x', confidence: 0.99 },
  ] }) } };
  const { accepted, rejected } = parseAnswerResponse(response, FIELDS, 0.7);
  assert.deepEqual(accepted.map((entry) => entry.fieldFingerprint).sort(), ['f1', 'f2']);
  assert.equal(accepted.find((entry) => entry.fieldFingerprint === 'f1').value, 'Six years building React applications.');
  // Current salary is a preauthorized-only category; the parser rejects it
  // even though the model returned a confident answer.
  assert.deepEqual(rejected.map((entry) => entry.reasonCode).sort(), ['option_mismatch', 'protected_category']);
});

test('protected content inside an accepted-looking answer is rejected', () => {
  const response = { message: { content: '{"fields":[{"fieldFingerprint":"f1","answer":"my captcha is 123456","confidence":0.99}]}' } };
  const { accepted, rejected } = parseAnswerResponse(response, FIELDS, 0.5);
  assert.equal(accepted.length, 0);
  assert.equal(rejected[0].reasonCode, 'protected_category');
});

test('invalid JSON throws instead of silently answering nothing', () => {
  assert.throws(() => parseAnswerResponse({ message: { content: 'not json' } }, FIELDS), /not valid JSON/);
});

test('reusable key normalization matches the application-policy lookup format', () => {
  assert.equal(reusableQuestionKeyForLabel('Years_of-React Experience'), 'years of react experience');
});
