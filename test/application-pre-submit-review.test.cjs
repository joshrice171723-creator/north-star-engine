const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPreSubmitMessages, parsePreSubmitResponse, preSubmitApproved } = require('../electron/jobs/automation/pre-submit-review.cjs');

test('pre-submit prompt carries bounded labels and documents, never field values', () => {
  const messages = buildPreSubmitMessages({ pageTitle: 'Review your application', url: 'https://jobs.example/review', fields: [{ label: 'Submit application', elementType: 'button', category: 'final_submit' }], documents: ['resume.pdf', 'cover_letter.pdf'] });
  assert.equal(messages.length, 2);
  const user = messages[1].content;
  assert.match(user, /Review your application/);
  assert.match(user, /resume\.pdf/);
  assert.match(user, /submit|stop/);
});

test('only a confident submit decision approves the irreversible click', () => {
  assert.equal(preSubmitApproved(parsePreSubmitResponse({ message: { content: '{"decision":"submit","reason":"Review page with completed data","confidence":0.93}' } })), true);
  assert.equal(preSubmitApproved(parsePreSubmitResponse({ message: { content: '{"decision":"stop","reason":"payment requested","confidence":0.99}' } })), false);
  assert.equal(preSubmitApproved(parsePreSubmitResponse({ message: { content: '{"decision":"submit","reason":"","confidence":0.4}' } })), false);
});

test('unsupported decisions throw instead of defaulting to submit', () => {
  assert.throws(() => parsePreSubmitResponse({ message: { content: '{"decision":"maybe","confidence":1}' } }), /unsupported decision/);
  assert.throws(() => parsePreSubmitResponse({ message: { content: 'garbage' } }), /not valid JSON/);
});
