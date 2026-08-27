const FAILURE_CLASSES = Object.freeze(['network', 'provider_changed', 'authentication', 'activation_pending', 'unknown_question', 'captcha', 'duplicate', 'email_confirmation_missing', 'protected_action', 'unsupported_site', 'invalid_state', 'unknown']);
function classifyApplicationFailure(input = {}) {
  const code = String(input.code || input.reason || '').toLowerCase(); const message = String(input.message || '').toLowerCase();
  const match = code.includes('captcha') || message.includes('captcha') ? 'captcha' : code.includes('activation') ? 'activation_pending' : code.includes('question') ? 'unknown_question' : code.includes('duplicate') || message.includes('already applied') ? 'duplicate' : code.includes('email_confirmation') ? 'email_confirmation_missing' : code.includes('auth') || message.includes('password') || message.includes('sign in') ? 'authentication' : code.includes('unsupported_site') || code.includes('site_not_supported') ? 'unsupported_site' : code.includes('stale') || code.includes('changed') ? 'provider_changed' : code.includes('network') || code.includes('timeout') ? 'network' : code.includes('protected') || code.includes('submit') ? 'protected_action' : code.includes('state') ? 'invalid_state' : 'unknown';
  const retryable = ['network', 'provider_changed', 'activation_pending'].includes(match);
  return { class: match, retryable, reasonCode: String(input.code || match).slice(0, 120), message: String(input.message || '').slice(0, 500) };
}
function classifyWorkflowFailure(input = {}) {
  const classified = input.class ? input : classifyApplicationFailure(input);
  const outcome = classified.class === 'network' || classified.class === 'provider_changed' || classified.class === 'activation_pending'
    ? 'retryable_failure'
    : classified.class === 'unknown_question' || classified.class === 'authentication' || classified.class === 'captcha' || classified.class === 'protected_action'
      ? 'needs_user'
      : classified.class === 'unsupported_site' ? 'unsupported_site'
      : classified.class === 'invalid_state' ? 'terminal_failure' : 'terminal_failure';
  return { ...classified, outcome, requiresUser: outcome === 'needs_user' };
}
function classifySafePassFailure({ error = {}, plan = null, attempt = 0, maxAttempts = 2 } = {}) {
  const code = String(error.code || error.reason || '').toLowerCase();
  const message = String(error.message || '').toLowerCase();
  const protectedFields = Array.isArray(plan?.fields)
    ? plan.fields.filter((field) => ['ask', 'blocked'].includes(field?.action))
    : [];
  // A missing AI plan can mean the model/provider or a delayed page
  // observation failed before any employer question was discovered. Retry
  // those transient cases instead of creating an empty answer checkpoint;
  // missing documents and other non-transient setup errors still require
  // review below.
  const transientNoPlan = !plan && /ai|model|openrouter|fill[- ]?plan|response|network|timeout|stale|changed|inspect|form/.test(`${code} ${message}`);
  if (transientNoPlan) {
    const nextAttempt = Number(attempt) + 1;
    const exhausted = nextAttempt > Math.max(0, Number(maxAttempts) || 0);
    return { state: exhausted ? 'failed' : 'queued', reasonCode: exhausted ? 'safe_pass_retry_exhausted' : 'safe_pass_retryable', retryable: true, exhausted, failureClass: 'provider_changed', nextAttempt };
  }
  if (code.includes('protected') || protectedFields.length || !plan) {
    return { state: 'needs_user_answer', reasonCode: !plan ? 'safe_pass_requires_review' : 'safe_pass_requires_user', retryable: false, exhausted: false, protectedFieldCount: protectedFields.length };
  }
  const failure = classifyApplicationFailure(error);
  const nextAttempt = Number(attempt) + 1;
  const exhausted = !failure.retryable || nextAttempt > Math.max(0, Number(maxAttempts) || 0);
  return { state: exhausted ? 'failed' : 'queued', reasonCode: exhausted ? 'safe_pass_retry_exhausted' : 'safe_pass_retryable', retryable: failure.retryable, exhausted, failureClass: failure.class, nextAttempt };
}
function boundedRetry({ attempt = 0, maxAttempts = 2, failure = {} } = {}) { const classified = failure.class ? failure : classifyApplicationFailure(failure); const nextAttempt = Number(attempt) + 1; return { ...classified, attempt: nextAttempt, exhausted: !classified.retryable || nextAttempt > Math.max(0, Number(maxAttempts) || 0), nextRetryAt: classified.retryable && nextAttempt <= maxAttempts ? new Date(Date.now() + Math.min(15 * 60 * 1000, 1000 * 2 ** Math.min(nextAttempt, 5))).toISOString() : null }; }
module.exports = { FAILURE_CLASSES, classifyApplicationFailure, classifyWorkflowFailure, classifySafePassFailure, boundedRetry };
