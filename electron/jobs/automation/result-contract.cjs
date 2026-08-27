'use strict';

const WORKFLOW_OUTCOMES = Object.freeze(new Set([
  'continue',
  'needs_user',
  'listing_unavailable',
  'retryable_failure',
  'unsupported_site',
  'terminal_failure',
  'ready_for_review',
  'submitted_pending_verification',
  'completed',
]));

const STEP_STATUSES = Object.freeze(new Set([
  'planned',
  'executed',
  'verified',
  'failed',
  'inconclusive',
  'skipped',
]));

const SOURCES = Object.freeze(new Set(['playbook', 'ai', 'deterministic_policy']));
const bounded = (value, max = 160) => String(value ?? '').trim().slice(0, max);

function assertEnum(value, allowed, label) {
  if (!allowed.has(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

function validateWorkflowResult(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('A workflow result is required.');
  for (const field of ['applicationId', 'jobId', 'stepId', 'stepType']) {
    if (!bounded(input[field])) throw new Error(`A workflow result ${field} is required.`);
  }
  assertEnum(input.status, STEP_STATUSES, 'workflow step status');
  assertEnum(input.outcome, WORKFLOW_OUTCOMES, 'workflow outcome');
  assertEnum(input.source || 'deterministic_policy', SOURCES, 'workflow result source');
  const confidence = Number(input.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('Workflow confidence must be between 0 and 1.');
  const evidenceIds = Array.isArray(input.evidenceIds) ? input.evidenceIds.slice(0, 20).map((value) => bounded(value, 160)).filter(Boolean) : [];
  return {
    applicationId: bounded(input.applicationId),
    jobId: bounded(input.jobId),
    stepId: bounded(input.stepId),
    stepType: bounded(input.stepType, 80),
    status: input.status,
    outcome: input.outcome,
    reasonCode: bounded(input.reasonCode, 120),
    confidence,
    retryable: Boolean(input.retryable),
    requiresUser: Boolean(input.requiresUser),
    pageFingerprint: bounded(input.pageFingerprint, 240),
    evidenceIds,
    nextCheckpoint: bounded(input.nextCheckpoint, 160),
    source: input.source || 'deterministic_policy',
  };
}

function makeWorkflowResult(input = {}) {
  return validateWorkflowResult({ status: 'planned', confidence: 0, ...input });
}

module.exports = { WORKFLOW_OUTCOMES, STEP_STATUSES, SOURCES, validateWorkflowResult, makeWorkflowResult };
