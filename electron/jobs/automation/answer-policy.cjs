const DEFAULT_SALARY_FALLBACK = 120000;
const AUTOFILL_POLICIES = new Set(['always', 'batch_review', 'ask', 'never']);
const ALWAYS_CATEGORIES = new Set(['identity_contact', 'availability', 'relocation', 'work_authorization', 'sponsorship', 'salary_expectation']);
const NEVER_CATEGORIES = new Set(['password', 'authentication_captcha', 'mfa', 'final_submit', 'legal_signature']);

function salaryExpectation({ advertisedMinimum, advertisedMaximum, fallbackTarget = DEFAULT_SALARY_FALLBACK } = {}) {
  const minimum = Number(advertisedMinimum); const maximum = Number(advertisedMaximum);
  if (Number.isFinite(minimum) && Number.isFinite(maximum) && minimum > 0 && maximum >= minimum) return Math.round(minimum + 0.2 * (maximum - minimum));
  return Number.isFinite(Number(fallbackTarget)) && Number(fallbackTarget) > 0 ? Math.round(Number(fallbackTarget)) : DEFAULT_SALARY_FALLBACK;
}

function normalizeAnswerCategory(field = {}) {
  const text = `${field.label || ''} ${field.name || ''} ${field.questionText || ''}`.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_./-]+/g, ' ').toLowerCase();
  if (/password/.test(text)) return 'password';
  if (/captcha/.test(text)) return 'authentication_captcha';
  if (/mfa|one time code|verification code/.test(text)) return 'mfa';
  if (/current salary|previous salary|salary history/.test(text)) return 'current_salary';
  if (/desired salary|salary expectation|compensation expectation|expected salary|salary requirements?|compensation requirements?/.test(text)) return 'salary_expectation';
  if (/relocat/.test(text)) return 'relocation';
  if (/travel/.test(text)) return 'travel';
  if (/sponsor|authorized|visa|work authorization/.test(text)) return /sponsor/.test(text) ? 'sponsorship' : 'work_authorization';
  if (/start date|available|notice period/.test(text)) return 'availability';
  // Employer forms frequently phrase ordinary skills questions as
  // "experience with X" or "familiarity with X" instead of using a
  // textarea-specific label. Treat those as safe evidence-backed questions
  // so the resume/cover-letter planner can answer them.
  if (/experience with|years? of experience|familiarity with|proficien(?:cy|t) in|knowledge of|worked with|have you used/.test(text)) return 'free_text';
  return field.category || 'unknown';
}

function policyFor({ category, policy } = {}) {
  const normalized = String(category || 'unknown');
  if (NEVER_CATEGORIES.has(normalized)) return { autofillPolicy: 'never', reasonCode: 'policy_never' };
  if (policy && policy.approvalStatus === 'approved' && AUTOFILL_POLICIES.has(policy.autofillPolicy)) return { autofillPolicy: policy.autofillPolicy, reasonCode: 'saved_answer_policy' };
  if (ALWAYS_CATEGORIES.has(normalized)) return { autofillPolicy: normalized === 'salary_expectation' ? 'always' : 'always', reasonCode: 'approved_profile_policy' };
  if (normalized === 'current_salary' || normalized === 'legal_attestation' || normalized === 'sensitive_voluntary_disclosure') return { autofillPolicy: 'ask', reasonCode: 'policy_requires_user' };
  return { autofillPolicy: 'ask', reasonCode: 'policy_requires_review' };
}

function answerPolicyForField(field, { profile = {}, job = {}, policies = [] } = {}) {
  const category = normalizeAnswerCategory(field);
  const policy = policies.find((entry) => entry?.normalizedCategory === category && entry?.deletedAt == null && entry?.approvalStatus !== 'rejected');
  const mode = policyFor({ category, policy });
  if (mode.autofillPolicy === 'never') return { category, action: 'blocked', value: null, provenance: [], confidence: 1, reasonCode: mode.reasonCode };
  if (category === 'salary_expectation' && mode.autofillPolicy === 'always') return { category, action: 'fill', value: String(salaryExpectation({ advertisedMinimum: job.salaryMin, advertisedMaximum: job.salaryMax, fallbackTarget: policy?.valueRules?.fallbackTarget })), provenance: ['job.salaryRange', 'policy.salaryExpectation'], confidence: 1, reasonCode: 'salary_policy_calculated' };
  if (mode.autofillPolicy === 'always' && policy?.answerText) return { category, action: 'fill', value: policy.answerText, provenance: [`answer.${policy.answerId}`], confidence: 1, reasonCode: mode.reasonCode };
  if (mode.autofillPolicy === 'always' && category === 'availability' && profile.availableStartDate) return { category, action: 'fill', value: profile.availableStartDate, provenance: ['profile.availableStartDate'], confidence: 1, reasonCode: mode.reasonCode };
  if (mode.autofillPolicy === 'always' && category === 'relocation' && profile.relocationWillingness) return { category, action: 'fill', value: profile.relocationWillingness, provenance: ['profile.relocationWillingness'], confidence: 1, reasonCode: mode.reasonCode };
  return { category, action: 'ask', value: null, provenance: [], confidence: 1, reasonCode: mode.reasonCode };
}

module.exports = { DEFAULT_SALARY_FALLBACK, salaryExpectation, normalizeAnswerCategory, policyFor, answerPolicyForField };
