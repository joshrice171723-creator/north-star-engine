'use strict';

function createSafeExecutor({ browser } = {}) {
  if (!browser || typeof browser.advance !== 'function') throw new Error('A browser adapter is required.');
  return async function executeSafeStep(plan) {
    if (plan.actionType === 'pause_for_user') return { status: 'blocked', reason: 'protected_action' };
    if (!['handoff', 'open_google_login'].includes(plan.actionType)) return { status: 'blocked', reason: 'unsupported_safe_action' };
    // applicationBrowser.advance owns the exact-label, visible-only safety
    // check. This adapter only permits non-submission navigation actions.
    return browser.advance(plan.actionType === 'handoff' ? { handoffOnly: true } : { googleLoginOnly: true });
  };
}

module.exports = { createSafeExecutor };
