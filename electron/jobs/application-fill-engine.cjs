const crypto = require('crypto');
const { BLOCKED, decideField } = require('./application-policy.cjs');
const planId = () => `fill-plan-${crypto.randomUUID()}`;

function buildFillPlan({ sessionId, applicationId, pageFingerprint, fields = [], profile = {}, excluded = [], aiDecisions = {}, diagnostics = {} }) {
  const excludedSet = new Set(excluded);
  return { id: planId(), sessionId, applicationId, pageFingerprint, createdAt: new Date().toISOString(), diagnostics, fields: fields.map((field) => {
    const deterministic = decideField(field, { profile, excluded: excludedSet.has(field.fieldFingerprint) });
    // Employer profiles can retain a value from an earlier application. Replace
    // completed identity fields with the current verified profile, while still
    // preserving non-identity values that the candidate already entered.
    if (deterministic.action !== 'blocked' && field.empty === false && deterministic.reasonCode !== 'verified_profile') return { fieldFingerprint: field.fieldFingerprint, category: field.category, label: field.label, action: 'leave_unchanged', displayValue: '', protectedValueRef: '', provenance: [], confidence: 1, reasonCode: 'already_completed', reason: 'Already completed on the employer page', aiGenerated: false };
    const ai = aiDecisions?.[field.fieldFingerprint];
    // AI may answer safe application questions, but identity fields remain tied
    // to the verified profile and protected categories can never be overridden.
    const useAi = Boolean(ai?.action === 'fill' && String(ai.displayValue || '').trim() && !BLOCKED.has(field.category) && field.category !== 'identity_contact');
    const decision = useAi ? { action: 'fill', value: String(ai.displayValue), provenance: ['ai.application_answer', ...(Array.isArray(ai.evidence) ? ai.evidence.slice(0, 5) : [])], confidence: Number.isFinite(Number(ai.confidence)) ? Number(ai.confidence) : 0.7, reasonCode: 'ai_generated_application_answer' } : deterministic;
    return { fieldFingerprint: field.fieldFingerprint, category: field.category, label: field.label, action: decision.action, displayValue: decision.value ? String(decision.value).slice(0, 5000) : '', protectedValueRef: '', provenance: decision.provenance, confidence: decision.confidence, reasonCode: decision.reasonCode, reason: useAi ? String(ai.reason || 'AI-generated answer').slice(0, 500) : decision.reasonCode, aiGenerated: useAi };
  }) };
}

function validatePlanForFill({ plan, currentPageFingerprint, fields = [], profile = {} }) {
  if (!plan || plan.pageFingerprint !== currentPageFingerprint) throw new Error('This fill plan is stale. Rescan and review the current form first.');
  const known = new Map(fields.map((field) => [field.fieldFingerprint, field]));
  return plan.fields.filter((entry) => entry.action === 'fill').map((entry) => {
    const field = known.get(entry.fieldFingerprint); if (!field) return { ...entry, action: 'blocked', reasonCode: 'field_changed' };
    // Defense in depth: classify again immediately before a future mutation.
    const decision = decideField(field, { profile });
    // Recompute from the current trusted profile to prevent a stale plan from
    // applying a value that was removed or changed after review.
    if (entry.aiGenerated) {
      return entry.action === 'fill' && entry.displayValue && !BLOCKED.has(field.category) ? entry : { ...entry, action: 'blocked', reasonCode: 'ai_answer_invalid' };
    }
    return decision.action === 'fill' && String(decision.value) === entry.displayValue ? entry : { ...entry, action: 'blocked', reasonCode: decision.reasonCode };
  });
}

module.exports = { buildFillPlan, validatePlanForFill };
