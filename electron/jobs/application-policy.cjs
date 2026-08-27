// This module is deliberately pure: remote pages and ATS adapters describe fields,
// but only this shared policy is allowed to decide whether a value is actionable.
const BLOCKED = new Set(['sensitive_voluntary_disclosure', 'legal_signature', 'authentication_captcha', 'file_upload', 'final_submit', 'navigation']);
const { answerPolicyForField } = require('./automation/answer-policy.cjs');
const fieldText = (field = {}) => `${field.label || ''} ${field.name || ''} ${field.id || ''} ${field.autocomplete || ''} ${field.inputType || ''}`.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_./-]+/g, ' ').toLowerCase();
const profileSource = (field) => {
  const text = fieldText(field);
  if (/current location|location/.test(text)) return 'location';
  if (/first name|given name|forename/.test(text)) return 'firstName';
  if (/last name|family name|surname|second name/.test(text)) return 'lastName';
  if (/email/.test(text)) return 'email';
  if (/phone|mobile|telephone|cell/.test(text)) return 'phone';
  if (/linkedin/.test(text)) return 'linkedinUrl';
  if (/github/.test(text)) return 'githubUrl';
  if (/portfolio|website/.test(text)) return 'portfolioUrl';
  if (/postal|zip|post code/.test(text)) return 'postalCode';
  if (/street|address line|address/.test(text)) return 'street';
  if (/city|town|locality/.test(text)) return 'city';
  if (/state|province|region|county/.test(text)) return 'state';
  if (/country/.test(text)) return 'country';
  return 'fullName';
};

const reusableAnswerFor = (field, answers = []) => {
  const key = String(field.label || field.name || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_./-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return answers.find((answer) => answer?.questionKey === key || fieldText({ label: answer?.questionText }).replace(/\s+/g, ' ').trim() === key);
};

function classifyField(field = {}) {
  const text = fieldText(field);
  if (field.inputType === 'password' || /password|captcha|verification code|one[- ]time|mfa/.test(text)) return 'authentication_captcha';
  // “Apply Now” starts the employer/ATS handoff; it does not submit the
  // completed application. Keep it in the safe navigation bucket so the
  // autonomous queue can cross the job-board boundary without treating it as
  // the irreversible final action.
  if (/submit|send application|complete application/.test(text) && field.elementType === 'button') return 'final_submit';
  if (/race|ethnicity|gender|veteran|disability|voluntary self/.test(text)) return 'sensitive_voluntary_disclosure';
  if (/signature|certify|attest|legal agreement|terms and conditions/.test(text)) return 'legal_signature';
  if (field.inputType === 'file') return 'file_upload';
  if (/email|phone|mobile|telephone|cell|first name|last name|given name|forename|family name|surname|full name|address|street|city|town|locality|current location|location|state|province|region|county|postal|zip|post code|country|linkedin|github|portfolio/.test(text)) return 'identity_contact';
  if (/authorized|sponsorship|visa/.test(text)) return 'work_authorization';
  if (/salary|compensation|relocat|travel|start date/.test(text)) return 'compensation';
  if (field.elementType === 'textarea' || /why are you|describe|cover letter|additional information|experience with|years? of experience|familiarity with|proficien(?:cy|t) in|knowledge of|worked with|have you used/.test(text)) return 'free_text';
  if (['button', 'submit'].includes(field.elementType) || (field.elementType === 'a' && /^(?:easy )?apply(?: now| for this job| on company site| externally)?$|^continue application$|^view application$/i.test(String(field.label || '').trim())) || /back|next|continue|save|proceed|review/.test(text)) return 'navigation';
  return 'unknown';
}

function decideField(field, { profile = {}, excluded = false } = {}) {
  const category = field.category || classifyField(field);
  if (BLOCKED.has(category)) return { action: 'blocked', reasonCode: category, value: null, provenance: [], confidence: 1 };
  if (excluded) return { action: 'leave_blank', reasonCode: 'user_excluded', value: null, provenance: [], confidence: 1 };
  if (category === 'identity_contact') {
    const source = profileSource(field); const value = source === 'location' ? [profile.city, profile.state, profile.postalCode, profile.country].filter(Boolean).join(', ') : profile[source];
    return value ? { action: 'fill', reasonCode: 'verified_profile', value, provenance: [`profile.${source}`], confidence: 1 } : { action: 'ask', reasonCode: 'missing_profile', value: null, provenance: [], confidence: 1 };
  }
  // Reusable answers are always written by the user in the local assistant.
  // They deliberately apply only to an exact normalized field label/name match.
  const hasJobSalaryContext = profile.jobContext && (profile.jobContext.salaryMin != null || profile.jobContext.salaryMax != null);
  const reusable = category === 'compensation' && hasJobSalaryContext ? null : reusableAnswerFor(field, profile.reusableAnswers);
  if (reusable?.answerText) return { action: 'fill', reasonCode: 'saved_reusable_answer', value: reusable.answerText, provenance: [`answer.${reusable.id}`], confidence: 1 };
  if (category === 'work_authorization') return profile.workAuthorization ? { action: 'suggest', reasonCode: 'verified_profile', value: profile.workAuthorization, provenance: ['profile.workAuthorization'], confidence: 1 } : { action: 'ask', reasonCode: 'missing_profile', value: null, provenance: [], confidence: 1 };
  const policyDecision = answerPolicyForField(field, { profile, job: profile.jobContext || {}, policies: profile.answerPolicies || [] });
  if (policyDecision.action === 'fill' || policyDecision.action === 'blocked') return { action: policyDecision.action, reasonCode: policyDecision.reasonCode, value: policyDecision.value, provenance: policyDecision.provenance, confidence: policyDecision.confidence };
  if (category === 'compensation' || category === 'free_text') return { action: 'ask', reasonCode: policyDecision.reasonCode || 'requires_approval', value: null, provenance: [], confidence: 0.8 };
  return { action: 'ask', reasonCode: 'unknown', value: null, provenance: [], confidence: 0 };
}

module.exports = { BLOCKED, fieldText, profileSource, reusableAnswerFor, classifyField, decideField };
