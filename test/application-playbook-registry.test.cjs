'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlaybookRegistry } = require('../electron/jobs/automation/playbook-registry.cjs');
const { planNextStep } = require('../electron/jobs/automation/planner.cjs');

function storage() {
  const playbooks = [];
  const steps = [];
  return {
    playbooks,
    steps,
    listPlaybooks: ({ siteHost, atsKey, workflowKind }) => playbooks.filter((entry) => entry.siteHost === siteHost && entry.atsKey === atsKey && entry.workflowKind === workflowKind),
    listPlaybookSteps: (playbookId) => steps.filter((entry) => entry.playbookId === playbookId),
    savePlaybook: (entry) => { const index = playbooks.findIndex((current) => current.id === entry.id); if (index >= 0) playbooks[index] = { ...playbooks[index], ...entry }; else playbooks.push(entry); return playbooks.find((current) => current.id === entry.id); },
    savePlaybookStep: (entry) => { const index = steps.findIndex((current) => current.id === entry.id); if (index >= 0) steps[index] = { ...steps[index], ...entry }; else steps.push(entry); return entry; },
  };
}

test('first verified step creates a candidate and second matching page loads it', () => {
  const repository = storage();
  const registry = createPlaybookRegistry({ repository });
  registry.recordVerifiedSuccess({ siteHost: 'dice.example', atsKey: 'dice', pageFingerprint: 'fp-1', plan: { stepId: 'dice-handoff', stepType: 'safe_navigation', actionType: 'handoff', targetLabel: 'Apply now', confidence: 0.98 } });
  const match = registry.match({ siteHost: 'dice.example', atsKey: 'dice', pageFingerprint: 'fp-1', stepKey: 'dice-handoff' });
  assert.equal(repository.playbooks[0].status, 'candidate');
  assert.equal(match.step.actionType, 'handoff');
  assert.equal(match.reusableWithoutRepair, false);
  assert.equal(planNextStep({ observation: { pageFingerprint: 'fp-1' }, playbook: match }).source, 'playbook');
});

test('a changed fingerprint does not load a stale playbook step', () => {
  const repository = storage();
  const registry = createPlaybookRegistry({ repository });
  registry.recordVerifiedSuccess({ siteHost: 'dice.example', atsKey: 'dice', pageFingerprint: 'fp-1', plan: { stepId: 'dice-handoff', actionType: 'handoff', confidence: 0.98 } });
  assert.equal(registry.match({ siteHost: 'dice.example', atsKey: 'dice', pageFingerprint: 'fp-changed', stepKey: 'dice-handoff' }), null);
  registry.recordVerifiedSuccess({ siteHost: 'dice.example', atsKey: 'dice', pageFingerprint: 'fp-changed', plan: { stepId: 'dice-handoff', actionType: 'handoff', confidence: 0.99 } });
  assert.equal(repository.steps.length, 1);
  assert.equal(repository.steps[0].pageFingerprint, 'fp-changed');
  assert.equal(repository.steps[0].successIncrement, 1);
});

test('deferred learning retries resolve the same logical step without recounting success', () => {
  const repository = storage(); const pending = []; let failSave = true;
  const saveStep = repository.savePlaybookStep;
  repository.savePlaybookStep = (entry) => { if (failSave) throw new Error('temporary persistence failure'); return saveStep(entry); };
  repository.queuePlaybookLearningRetry = (entry) => { pending.push({ id: `retry-${pending.length + 1}`, ...entry }); return pending.at(-1); };
  repository.listPendingPlaybookLearningRetries = () => pending.filter((entry) => !entry.resolved);
  repository.resolvePlaybookLearningRetry = (id) => { const retry = pending.find((entry) => entry.id === id); retry.resolved = true; return retry; };
  const registry = createPlaybookRegistry({ repository });
  const input = { applicationId: 'app-1', siteHost: 'dice.example', atsKey: 'dice', pageFingerprint: 'fp-1', plan: { stepId: 'dice-handoff', actionType: 'handoff', confidence: 0.98 } };
  assert.throws(() => registry.recordVerifiedSuccess(input), /temporary persistence failure/);
  assert.equal(pending.length, 1);
  failSave = false;
  assert.deepEqual(registry.retryDeferredLearning(), { attempted: 1, resolved: 1, failed: 0 });
  assert.equal(repository.steps.length, 1);
  assert.equal(repository.playbooks[0].successCount, 1);
  assert.equal(pending[0].resolved, true);
});
