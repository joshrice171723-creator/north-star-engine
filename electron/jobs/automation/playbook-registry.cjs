'use strict';

const crypto = require('node:crypto');

const MATCHABLE_STATUSES = new Set(['candidate', 'verified']);
const VERIFIED_THRESHOLD = 0.85;

function boundedJson(value, fallback = '{}') {
  try { return JSON.stringify(value && typeof value === 'object' ? value : JSON.parse(fallback)); } catch { return fallback; }
}

function createId(prefix) { return `${prefix}-${crypto.randomUUID()}`; }

function createPlaybookRegistry({ repository, confidenceThreshold = VERIFIED_THRESHOLD } = {}) {
  if (!repository || typeof repository.listPlaybooks !== 'function' || typeof repository.savePlaybook !== 'function' || typeof repository.savePlaybookStep !== 'function') throw new Error('The playbook registry requires a storage repository.');

  function match({ siteHost = '', atsKey = '', workflowKind = 'job_application', pageFingerprint = '', stepKey = '' } = {}) {
    const candidates = repository.listPlaybooks({ siteHost, atsKey, workflowKind }).filter((playbook) => MATCHABLE_STATUSES.has(playbook.status));
    for (const playbook of candidates) {
      const step = repository.listPlaybookSteps(playbook.id).find((entry) => (!stepKey || entry.stepKey === stepKey) && entry.pageFingerprint === pageFingerprint);
      if (step) return { ...playbook, step, reusableWithoutRepair: playbook.status === 'verified' && Number(playbook.confidence) >= confidenceThreshold && Number(step.confidence) >= confidenceThreshold };
    }
    return null;
  }

  function recordVerifiedSuccess({ applicationId = '', siteHost, atsKey = '', workflowKind = 'job_application', pageFingerprint, plan, source = 'ai_repair', countSuccess = true } = {}) {
    if (!siteHost || !pageFingerprint || !plan?.actionType) throw new Error('A successful playbook step requires site, fingerprint, and action.');
    try {
      const existing = repository.listPlaybooks({ siteHost, atsKey, workflowKind }).find((entry) => entry.status !== 'disabled' && entry.version === 1);
      const timestamp = new Date().toISOString(); const stepKey = plan.stepId || plan.stepKey || plan.actionType;
      const playbook = repository.savePlaybook({ id: existing?.id || createId('playbook'), siteHost, atsKey, workflowKind, version: existing?.version || 1, status: existing?.status === 'verified' ? 'verified' : 'candidate', confidence: Math.max(Number(existing?.confidence) || 0, Number(plan.confidence) || 0), playbookJson: existing?.playbookJson || {}, source, successCount: (Number(existing?.successCount) || 0) + (countSuccess ? 1 : 0), lastSuccessAt: timestamp, createdAt: existing?.createdAt || timestamp, updatedAt: timestamp });
      // Fingerprints intentionally do not participate in logical-step lookup.
      // A changed layout refreshes this row instead of creating a duplicate step.
      const priorStep = repository.listPlaybookSteps(playbook.id).find((entry) => entry.stepKey === stepKey);
      repository.savePlaybookStep({ id: priorStep?.id || createId('playbook-step'), playbookId: playbook.id, stepOrder: Number(priorStep?.stepOrder) || 0, stepKey, pageType: plan.pageType || plan.stepType || '', pageFingerprint, actionType: plan.actionType, target: { label: plan.targetLabel || '' }, arguments: {}, verification: { required: true }, safetyClass: 'safe_navigation', confidence: Math.max(Number(priorStep?.confidence) || 0, Number(plan.confidence) || 0), successIncrement: countSuccess ? 1 : 0, createdAt: priorStep?.createdAt || timestamp, updatedAt: timestamp });
      return playbook;
    } catch (error) {
      if (typeof repository.queuePlaybookLearningRetry === 'function') {
        try { repository.queuePlaybookLearningRetry({ applicationId, siteHost, atsKey, workflowKind, stepKey: plan.stepId || plan.stepKey || plan.actionType, pageFingerprint, plan, source, lastError: String(error?.message || error) }); } catch {}
      }
      throw error;
    }
  }

  function retryDeferredLearning({ limit = 10 } = {}) {
    if (typeof repository.listPendingPlaybookLearningRetries !== 'function' || typeof repository.resolvePlaybookLearningRetry !== 'function') return { attempted: 0, resolved: 0, failed: 0 };
    const pending = repository.listPendingPlaybookLearningRetries(limit) || []; let resolved = 0; let failed = 0;
    for (const retry of pending) {
      try { recordVerifiedSuccess({ applicationId: retry.applicationId, siteHost: retry.siteHost, atsKey: retry.atsKey, workflowKind: retry.workflowKind, pageFingerprint: retry.pageFingerprint, plan: retry.plan, source: retry.source, countSuccess: false }); repository.resolvePlaybookLearningRetry(retry.id); resolved += 1; } catch { failed += 1; }
    }
    return { attempted: pending.length, resolved, failed };
  }

  return { match, recordVerifiedSuccess, retryDeferredLearning };
}

module.exports = { createPlaybookRegistry, VERIFIED_THRESHOLD, boundedJson };
