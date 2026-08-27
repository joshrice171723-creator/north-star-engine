const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRepairPlan, createRepairLoop } = require('../electron/jobs/automation/repair-loop.cjs');

const observation = { pageFingerprint: 'changed-form', pageTitle: 'Employer application', fields: [{ category: 'navigation', label: 'Continue' }] };

test('repair validation accepts only exact, reversible page actions', () => {
  assert.equal(validateRepairPlan({ actionType: 'handoff', targetFingerprint: 'changed-form', targetLabel: 'Continue', confidence: 0.91 }, observation).source, 'ai_repair');
  assert.throws(() => validateRepairPlan({ actionType: 'submit', targetFingerprint: 'changed-form', targetLabel: 'Submit' }, observation), /unsafe|protected/i);
  assert.throws(() => validateRepairPlan({ actionType: 'handoff', targetFingerprint: 'old-form', targetLabel: 'Continue' }, observation), /match/i);
});

test('repair loop is bounded and persists only independently verified repairs', async () => {
  const repairs = [];
  const loop = createRepairLoop({
    proposeRepair: async () => ({ actionType: 'handoff', targetFingerprint: 'changed-form', targetLabel: 'Continue', confidence: 0.9 }),
    executeSafeStep: async () => ({ status: 'advanced' }),
    verifyStepResult: async () => ({ status: 'verified', outcome: 'continue', evidenceIds: ['next-page'] }),
    recordRepair: (repair) => repairs.push(repair),
  });
  const result = await loop.handle({ applicationId: 'app-1', observation, failedPlan: { actionType: 'handoff' }, failure: { reasonCode: 'site_change' } });
  assert.equal(result.status, 'repaired');
  assert.equal(repairs[0].status, 'repaired');
  assert.equal((await loop.handle({ applicationId: 'app-1', observation, context: { repairAttempts: 1 } })).status, 'not_attempted');
});
