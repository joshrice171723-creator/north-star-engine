const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRecoveryMessages, parseRecoveryResponse, recoveryFields } = require('../electron/jobs/application-recovery-planner.cjs');

test('recovery planner sends bounded control metadata and not field values', () => {
  const messages = buildRecoveryMessages({ snapshot: { pageTitle: 'Listing', url: 'https://jobs.example/apply', fields: [{ label: 'Apply for this job', elementType: 'button', category: 'navigation', empty: false }, { label: 'Email', elementType: 'input', category: 'identity_contact', empty: false }] }, blockedReason: 'next_control_not_found' });
  assert.equal(messages.length, 2);
  assert.match(messages[1].content, /Apply for this job/);
  assert.doesNotMatch(messages[1].content, /value/);
  assert.equal(recoveryFields({ fields: [{ label: 'x', value: 'secret', options: ['one'] }] })[0].options[0], 'one');
  assert.equal(Object.hasOwn(recoveryFields({ fields: [{ label: 'x', value: 'secret' }] })[0], 'value'), false);
});

test('recovery planner accepts only bounded safe actions', () => {
  assert.deepEqual(parseRecoveryResponse({ message: { content: '{"action":"handoff","targetLabel":"Apply for this job","reason":"External application handoff","confidence":0.91}' } }), { action: 'handoff', targetLabel: 'Apply for this job', reason: 'External application handoff', confidence: 0.91 });
  assert.throws(() => parseRecoveryResponse({ message: { content: '{"action":"submit","targetLabel":"Submit application"}' } }), /unsupported action/);
});
