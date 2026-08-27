'use strict';

function createStepVerifier({ observe } = {}) {
  if (typeof observe !== 'function') throw new Error('An observation adapter is required.');
  return async function verifyStepResult({ plan, execution, applicationId } = {}) {
    if (execution?.status === 'advanced') {
      return { status: 'verified', outcome: 'continue', confidence: 0.98, nextCheckpoint: 'employer_handoff', evidenceIds: [plan.targetFingerprint] };
    }
    if (execution?.status === 'unavailable') {
      return { status: 'verified', outcome: 'listing_unavailable', confidence: 0.99, reasonCode: execution.reason || 'job_listing_unavailable', evidenceIds: execution.signals || [] };
    }
    if (execution?.status === 'blocked') {
      return { status: 'inconclusive', code: execution.reason || 'handoff_blocked', message: 'The safe employer handoff was not available yet.', retryable: true };
    }
    const next = await observe({ applicationId });
    return next?.pageFingerprint === plan.targetFingerprint
      ? { status: 'inconclusive', code: 'page_unchanged', message: 'The page did not change after the safe action.', retryable: true }
      : { status: 'inconclusive', code: 'step_verification_inconclusive', message: 'The safe action result could not be verified.', retryable: true };
  };
}

module.exports = { createStepVerifier };
