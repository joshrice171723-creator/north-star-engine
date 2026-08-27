const redactConfirmationUrl = (value) => { try { const url = new URL(value); return `${url.origin}${url.pathname}`; } catch { return ''; } };
function finalReadiness({ fields = [], pageStale = false, captcha = false } = {}) {
  const blockers = []; const warnings = [];
  for (const field of fields) { if (field.required && field.empty && !['legal_signature', 'sensitive_voluntary_disclosure'].includes(field.category)) blockers.push(field.label || field.name || 'Required field'); if (field.category === 'legal_signature' || field.category === 'sensitive_voluntary_disclosure') warnings.push(field.label || field.name || 'Manual field'); }
  if (pageStale) blockers.push('Form state is stale'); if (captcha) blockers.push('CAPTCHA or authentication requires manual completion');
  return { ready: blockers.length === 0, blockers, warnings };
}
function detectConfirmation({ url = '', title = '', text = '', confirmationNumber = '' } = {}) { const sample = `${url} ${title} ${text}`.slice(0, 2000).toLowerCase(); const success = /thank you|application (was )?submitted|confirmation/.test(sample); return { state: confirmationNumber || success ? 'confirmed' : 'ambiguous', signals: success ? ['bounded_confirmation_language'] : [], confirmationNumber: String(confirmationNumber || '').slice(0, 160), confirmationUrlRedacted: redactConfirmationUrl(url), observedAt: new Date().toISOString() }; }
module.exports = { redactConfirmationUrl, finalReadiness, detectConfirmation };
