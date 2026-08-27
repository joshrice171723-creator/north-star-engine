const test = require('node:test'); const assert = require('node:assert/strict');
const { buildFillPlan, validatePlanForFill } = require('../electron/jobs/application-fill-engine.cjs');
test('fill plans fail closed when stale or protected', () => {
  const fields = [{ fieldFingerprint: 'name', category: 'identity_contact', label: 'Email', name: 'email', elementType: 'input' }, { fieldFingerprint: 'submit', category: 'final_submit', label: 'Submit', elementType: 'button' }];
  const plan = buildFillPlan({ sessionId: 's', applicationId: 'a', pageFingerprint: 'page', fields, profile: { email: 'safe@example.test' } });
  assert.equal(plan.fields.find((field) => field.fieldFingerprint === 'submit').action, 'blocked');
  assert.equal(validatePlanForFill({ plan, currentPageFingerprint: 'page', fields, profile: { email: 'safe@example.test' } })[0].action, 'fill');
  assert.throws(() => validatePlanForFill({ plan, currentPageFingerprint: 'changed', fields }));
});
