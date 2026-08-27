const test = require('node:test'); const assert = require('node:assert/strict');
const { classifyField, decideField } = require('../electron/jobs/application-policy.cjs');
const { buildFillPlan, validatePlanForFill } = require('../electron/jobs/application-fill-engine.cjs');
test('policy blocks protected controls and fails closed for unknown fields', () => {
  assert.equal(classifyField({ elementType: 'input', inputType: 'password', label: 'Password' }), 'authentication_captcha');
  assert.equal(decideField({ elementType: 'button', label: 'Submit application' }).action, 'blocked');
  assert.equal(classifyField({ elementType: 'button', label: 'Apply Now' }), 'navigation');
  assert.equal(decideField({ elementType: 'input', label: 'Unfamiliar field' }).action, 'ask');
});
test('machine-formatted ATS fields are classified without splitting a name', () => {
  const profile = { email: 'candidate@example.test', fullName: 'Ada Lovelace', firstName: 'Ada', lastName: 'Lovelace', state: 'Illinois' };
  assert.equal(decideField({ elementType: 'input', name: 'email_address' }, { profile }).action, 'fill');
  assert.equal(decideField({ elementType: 'input', name: 'first_name' }, { profile }).value, 'Ada');
  assert.equal(decideField({ elementType: 'input', name: 'last_name' }, { profile }).value, 'Lovelace');
  assert.equal(decideField({ elementType: 'input', name: 'state_province' }, { profile }).value, 'Illinois');
});
test('common ATS aliases map to the verified profile', () => {
  const profile = { firstName: 'Ada', lastName: 'Lovelace', phone: '555-0100', city: 'London', state: 'England', postalCode: 'NW1' };
  assert.equal(decideField({ elementType: 'input', label: 'Forename' }, { profile }).value, 'Ada');
  assert.equal(decideField({ elementType: 'input', label: 'Surname' }, { profile }).value, 'Lovelace');
  assert.equal(decideField({ elementType: 'input', label: 'Telephone number' }, { profile }).value, '555-0100');
  assert.equal(decideField({ elementType: 'input', label: 'Town / locality' }, { profile }).value, 'London');
  assert.equal(decideField({ elementType: 'input', label: 'Post code' }, { profile }).value, 'NW1');
});
test('current location uses the verified address composite', () => {
  const profile = { city: 'Ardmore', state: 'OK', postalCode: '73401', country: 'United States' };
  assert.equal(classifyField({ elementType: 'input', label: 'Current Location' }), 'identity_contact');
  assert.equal(decideField({ elementType: 'input', label: 'Current Location' }, { profile }).value, 'Ardmore, OK, 73401, United States');
});
test('user-approved reusable answers only fill an exact field match', () => {
  const profile = { reusableAnswers: [{ id: 'answer-1', questionKey: 'desired salary', questionText: 'Desired salary', answerText: '120000' }] };
  assert.equal(decideField({ elementType: 'input', label: 'Desired salary' }, { profile }).value, '120000');
  assert.equal(decideField({ elementType: 'input', label: 'Current salary' }, { profile }).action, 'ask');
});

test('AI answers can fill safe application questions while protected controls stay blocked', () => {
  const fields = [
    { fieldFingerprint: 'question-1', elementType: 'textarea', inputType: 'textarea', label: 'Why are you interested?', category: 'free_text' },
    { fieldFingerprint: 'upload-1', elementType: 'input', inputType: 'file', label: 'Upload resume', category: 'file_upload' },
    { fieldFingerprint: 'first-1', elementType: 'input', inputType: 'text', label: 'First Name', category: 'identity_contact' },
  ];
  const profile = { firstName: 'Ada' };
  const plan = buildFillPlan({ sessionId: 'session-1', applicationId: 'application-1', pageFingerprint: 'page-1', fields, profile, aiDecisions: { 'question-1': { action: 'fill', displayValue: 'I am interested in the role because it combines product work with software engineering.', reason: 'Supported by the resume.', evidence: ['resume.raw.1'] }, 'upload-1': { action: 'fill', displayValue: 'resume.pdf' } } });
  assert.equal(plan.fields.find((field) => field.fieldFingerprint === 'question-1').aiGenerated, true);
  assert.equal(plan.fields.find((field) => field.fieldFingerprint === 'question-1').action, 'fill');
  assert.equal(plan.fields.find((field) => field.fieldFingerprint === 'upload-1').action, 'blocked');
  const validated = validatePlanForFill({ plan, currentPageFingerprint: 'page-1', fields, profile });
  assert.equal(validated.find((field) => field.fieldFingerprint === 'question-1').action, 'fill');
});

test('plans replace stale completed identity fields with verified profile values', () => {
  const fields = [{ fieldFingerprint: 'completed', elementType: 'input', inputType: 'text', label: 'Portfolio', category: 'identity_contact', empty: false }];
  const plan = buildFillPlan({ sessionId: 'session-1', applicationId: 'application-1', pageFingerprint: 'page-1', fields, profile: { portfolioUrl: 'https://example.test' } });
  assert.equal(plan.fields[0].action, 'fill');
  assert.equal(plan.fields[0].displayValue, 'https://example.test');
});
