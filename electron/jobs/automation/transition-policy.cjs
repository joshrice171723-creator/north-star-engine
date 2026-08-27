'use strict';

const { validateWorkflowResult } = require('./result-contract.cjs');

const OUTCOME_POLICY = Object.freeze({
  continue: { applicationState: null, jobStage: null, queueBehavior: 'keep_active' },
  needs_user: { applicationState: 'needs_user_answer', jobStage: null, queueBehavior: 'visible_review' },
  listing_unavailable: { applicationState: 'blocked', jobStage: 'rejected', queueBehavior: 'remove_from_ready_queue' },
  retryable_failure: { applicationState: 'queued', jobStage: null, queueBehavior: 'retry_same_application' },
  unsupported_site: { applicationState: 'blocked', jobStage: null, queueBehavior: 'visible_review' },
  terminal_failure: { applicationState: 'failed', jobStage: null, queueBehavior: 'failed_review' },
  ready_for_review: { applicationState: 'ready_to_submit', jobStage: null, queueBehavior: 'batch_review' },
  submitted_pending_verification: { applicationState: 'verifying_confirmation', jobStage: null, queueBehavior: 'awaiting_confirmation' },
  completed: { applicationState: 'submitted', jobStage: 'applied', queueBehavior: 'completed' },
});

function policyFor(outcome) {
  const policy = OUTCOME_POLICY[outcome];
  if (!policy) throw new Error(`No transition policy exists for ${outcome}.`);
  return { outcome, ...policy };
}

function transitionPlan(resultInput, { currentApplicationState = 'queued' } = {}) {
  const result = validateWorkflowResult(resultInput);
  const policy = policyFor(result.outcome);
  return {
    ...policy,
    applicationState: policy.applicationState || currentApplicationState,
    checkpoint: {
      ...(result.nextCheckpoint ? { stage: result.nextCheckpoint } : {}),
      reasonCode: result.reasonCode || null,
      pageFingerprint: result.pageFingerprint || null,
      evidenceIds: result.evidenceIds,
      outcome: result.outcome,
    },
  };
}

/**
 * Apply one outcome through repository callbacks so renderer and site adapters
 * cannot invent queue state transitions. The unavailable path archives only
 * after the application is marked blocked, preserving the audit boundary.
 */
function applyTransition(resultInput, { application, job, repository } = {}) {
  const result = validateWorkflowResult(resultInput);
  if (!repository || typeof repository.updateApplicationState !== 'function') throw new Error('A transition repository is required.');
  const plan = transitionPlan(result, { currentApplicationState: application?.automationState || 'queued' });
  const alreadyApplied = application?.automationState === plan.applicationState
    && (!plan.jobStage || job?.stage === plan.jobStage);
  if (alreadyApplied) return { result, plan, status: 'already_applied', application, job };

  const nextApplication = repository.updateApplicationState({
    applicationId: result.applicationId,
    state: plan.applicationState,
    checkpoint: plan.checkpoint,
  });
  let nextJob = job || null;
  if (plan.jobStage === 'rejected') {
    if (typeof repository.archiveUnavailableJob !== 'function') throw new Error('Unavailable-listing transitions require an archive callback.');
    nextJob = repository.archiveUnavailableJob(result.jobId);
  }
  if (typeof repository.recordEvent === 'function') repository.recordEvent({
    applicationId: result.applicationId,
    eventType: 'workflow_transition_applied',
    summary: `Workflow outcome applied: ${result.outcome}.`,
    metadata: { outcome: result.outcome, reasonCode: result.reasonCode || '', queueBehavior: plan.queueBehavior },
  });
  return { result, plan, status: 'applied', application: nextApplication, job: nextJob };
}

module.exports = { OUTCOME_POLICY, policyFor, transitionPlan, applyTransition };
