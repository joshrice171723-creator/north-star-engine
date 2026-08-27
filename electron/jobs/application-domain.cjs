const APPLICATION_STATUSES = new Set(['drafting', 'documents_ready', 'in_progress', 'needs_user_input', 'ready_for_review', 'ready_to_submit', 'submitted', 'withdrawn', 'blocked']);
const TRANSITIONS = {
  drafting: new Set(['documents_ready', 'in_progress', 'needs_user_input', 'blocked', 'withdrawn']),
  documents_ready: new Set(['in_progress', 'needs_user_input', 'ready_for_review', 'blocked', 'withdrawn']),
  in_progress: new Set(['documents_ready', 'needs_user_input', 'ready_for_review', 'blocked', 'withdrawn']),
  needs_user_input: new Set(['drafting', 'documents_ready', 'in_progress', 'ready_for_review', 'blocked', 'withdrawn']),
  ready_for_review: new Set(['in_progress', 'needs_user_input', 'ready_to_submit', 'blocked', 'withdrawn']),
  ready_to_submit: new Set(['in_progress', 'needs_user_input', 'blocked', 'withdrawn']),
  submitted: new Set(), withdrawn: new Set(), blocked: new Set(['drafting', 'in_progress', 'needs_user_input', 'withdrawn']),
};
const bounded = (value, max = 1000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
function assertStatus(status) { if (!APPLICATION_STATUSES.has(status)) throw new Error('Invalid application status.'); return status; }
function assertTransition(current, next, { trustedCompletion = false } = {}) {
  assertStatus(current); assertStatus(next);
  if (next === 'submitted' && !trustedCompletion) throw new Error('Application submission is not available in this stage.');
  if (!TRANSITIONS[current].has(next)) throw new Error(`Cannot transition application from ${current} to ${next}.`);
}
function computeApplicationReadiness({ job = {}, profile = {}, resume = {} }) {
  const completed = ['job_saved']; const missing = []; const warnings = []; const blocked = [];
  if (bounded(job.url || job.applicationUrl || job.canonicalUrl)) completed.push('application_url'); else missing.push('application_url');
  for (const [key, value] of [['full_name', profile.fullName], ['email', profile.email], ['phone', profile.phone]]) (bounded(value) ? completed : missing).push(key);
  if (bounded(resume.rawText)) completed.push('master_resume'); else missing.push('master_resume');
  if (!bounded(profile.workAuthorization)) warnings.push('work_authorization_not_set');
  if (profile.requiresSponsorship === undefined || profile.requiresSponsorship === null) warnings.push('sponsorship_not_set');
  return { ready: !missing.length && !blocked.length, completed, missing, warnings, blocked };
}
function validateAnswer(input = {}) {
  const scope = input.scope || 'application'; const approvalStatus = input.approvalStatus || 'draft';
  if (!['application', 'global'].includes(scope)) throw new Error('Invalid answer scope.');
  if (!['draft', 'approved', 'rejected'].includes(approvalStatus)) throw new Error('Invalid answer approval status.');
  if (!bounded(input.questionKey, 160)) throw new Error('An answer question key is required.');
  if (!Array.isArray(input.provenance) || input.provenance.length > 20) throw new Error('Invalid answer provenance.');
  return { ...input, questionKey: bounded(input.questionKey, 160), questionText: bounded(input.questionText, 2000), answerText: bounded(input.answerText, 10000), scope, approvalStatus, normalizedCategory: bounded(input.normalizedCategory || 'unknown', 80), sensitivity: bounded(input.sensitivity || 'normal', 40), autofillPolicy: bounded(input.autofillPolicy || 'ask', 40), provenance: input.provenance.map((item) => bounded(String(item), 500)) };
}
module.exports = { APPLICATION_STATUSES, TRANSITIONS, assertStatus, assertTransition, computeApplicationReadiness, validateAnswer };
