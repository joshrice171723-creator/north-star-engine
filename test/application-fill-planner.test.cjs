const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_RESUME_CHARS, parseFillPlanResponse, repairFillPlanMessages, isAiFillCandidate, aiCandidateFields, buildFillPlanMessages, normalizeFillPlanDecisions } = require('../electron/jobs/application-fill-planner.cjs');

test('fill-plan parser accepts a fenced JSON response', () => {
  assert.deepEqual(parseFillPlanResponse({ message: { content: '```json\n{"fields":[]}\n```' } }), { fields: [] });
});

test('AI candidates contain only empty supported non-protected controls', () => {
  assert.equal(isAiFillCandidate({ empty: true, elementType: 'textarea', inputType: 'textarea', category: 'free_text' }), true);
  assert.equal(isAiFillCandidate({ empty: true, elementType: 'input', inputType: 'date', category: 'compensation' }), true);
  assert.equal(isAiFillCandidate({ empty: false, elementType: 'input', inputType: 'text', category: 'unknown' }), false);
  assert.equal(isAiFillCandidate({ empty: true, elementType: 'input', inputType: 'password', category: 'authentication_captcha' }), false);
  assert.equal(isAiFillCandidate({ empty: true, elementType: 'input', inputType: 'text', category: 'identity_contact' }), false);
});

test('AI candidates exclude fields already resolved by local profile or answer policy', () => {
  const fields = [
    { fieldFingerprint: 'email', elementType: 'input', inputType: 'email', label: 'Email', category: 'identity_contact', empty: true },
    { fieldFingerprint: 'salary', elementType: 'input', inputType: 'text', label: 'Desired salary', category: 'compensation', empty: true },
    { fieldFingerprint: 'motivation', elementType: 'textarea', inputType: 'textarea', label: 'Why this role?', category: 'free_text', empty: true },
  ];
  const profile = { email: 'candidate@example.test', jobContext: { salaryMin: 100000, salaryMax: 150000 }, reusableAnswers: [], answerPolicies: [] };
  assert.deepEqual(aiCandidateFields(fields, profile).map((field) => field.fieldFingerprint), ['motivation']);
});

test('single-line experience questions remain AI candidates for resume-backed answers', () => {
  const fields = [{ fieldFingerprint: 'angular', elementType: 'input', inputType: 'text', label: 'What current version(s) of Angular do you have experience with?', category: 'free_text', empty: true }];
  assert.deepEqual(aiCandidateFields(fields, { reusableAnswers: [], answerPolicies: [] }).map((field) => field.fieldFingerprint), ['angular']);
});

test('fill-plan prompt supplies the full verified profile and job evidence with a coverage goal', () => {
  const messages = buildFillPlanMessages({ fields: [{ fieldFingerprint: 'field-a', elementType: 'select', options: ['Yes', 'No'] }], profile: { workAuthorization: 'US citizen', requiresSponsorship: false, desiredSalary: 120000 }, job: { company: 'Example', roleTitle: 'Engineer', description: 'Build systems.' }, resumeText: 'Candidate resume', coverLetterText: 'Candidate cover letter' });
  assert.match(messages[0].content, /Maximize the number/);
  assert.match(messages[0].content, /exactly one decision for every supplied fieldFingerprint/);
  assert.match(messages[1].content, /"workAuthorization":"US citizen"/);
  assert.match(messages[1].content, /"requiresSponsorship":false/);
  assert.match(messages[1].content, /Candidate cover letter/);
  assert.match(messages[1].content, /Build systems/);
});

test('fill-plan prompt can attach a bounded screenshot as supplemental evidence', () => {
  const messages = buildFillPlanMessages({ fields: [{ fieldFingerprint: 'field-a', elementType: 'input', inputType: 'text', label: 'Why this role?' }], profile: {}, resumeText: 'Candidate resume', screenshotDataUrl: 'data:image/jpeg;base64,ZmFrZQ==' });
  assert.equal(Array.isArray(messages[1].content), true);
  assert.equal(messages[1].content[0].type, 'text');
  assert.equal(messages[1].content[1].type, 'image_url');
  assert.match(messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);
});

test('decision normalization preserves scalar answers and retries incomplete or invalid select decisions', () => {
  const fields = [
    { fieldFingerprint: 'number', elementType: 'input', inputType: 'number' },
    { fieldFingerprint: 'boolean', elementType: 'input', inputType: 'text' },
    { fieldFingerprint: 'select', elementType: 'select', options: ['Yes', 'No'] },
    { fieldFingerprint: 'missing', elementType: 'textarea', inputType: 'textarea' },
  ];
  const result = normalizeFillPlanDecisions({ fields: [
    { fieldFingerprint: 'number', action: 'fill', displayValue: 7 },
    { fieldFingerprint: 'boolean', action: 'fill', displayValue: false },
    { fieldFingerprint: 'select', action: 'fill', displayValue: 'maybe' },
  ] }, fields);
  assert.equal(result.decisions.number.displayValue, '7');
  assert.equal(result.decisions.boolean.displayValue, 'false');
  assert.deepEqual(result.unresolvedFields.map((field) => field.fieldFingerprint), ['select', 'missing']);
});

test('decision normalization preserves AI drafts for user-approved answers', () => {
  const result = normalizeFillPlanDecisions({ fields: [{ fieldFingerprint: 'question', action: 'ask', suggestedValue: 'I have built workflow automation systems.', reason: 'Supported by resume evidence.' }] }, [{ fieldFingerprint: 'question', elementType: 'textarea', category: 'free_text' }]);
  assert.equal(result.decisions.question.action, 'ask');
  assert.equal(result.decisions.question.suggestedValue, 'I have built workflow automation systems.');
  assert.equal(result.unresolvedFields[0].fieldFingerprint, 'question');
});

test('fill-plan repair prompt bounds invalid output and excludes resume data', () => {
  const response = { message: { content: '{"fields":[' + 'x'.repeat(30_000) } };
  const messages = repairFillPlanMessages(response, [{ fieldFingerprint: 'field-a' }]);
  assert.equal(messages[1].content.includes('field-a'), true);
  assert.equal(messages[1].content.includes('x'.repeat(20_001)), false);
  assert.equal(MAX_RESUME_CHARS, 180_000);
});
