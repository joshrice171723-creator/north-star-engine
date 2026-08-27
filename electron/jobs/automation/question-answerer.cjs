'use strict';

// Bounded OpenRouter answering stage for ordinary employer questions the
// deterministic policy could not resolve. Protected categories never reach
// this module: autonomy-policy.canAiAnswer filters them out first, and
// parseAnswerResponse re-validates every returned value against the supplied
// field metadata before any caller may write it into a form.

const { normalizeAnswerCategory } = require('./answer-policy.cjs');
const { NEVER_AUTONOMOUS_CATEGORIES, PREAUTHORIZED_ONLY_CATEGORIES } = require('./autonomy-policy.cjs');

const MAX_FIELDS = 40;
const MAX_OPTIONS = 20;
const MAX_ANSWER_CHARS = 2000;
const MAX_RESUME_CHARS = 60_000;
const MAX_JOB_CONTEXT_CHARS = 20_000;

const safeText = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function answerableFieldProjection(fields = []) {
  return (Array.isArray(fields) ? fields : []).slice(0, MAX_FIELDS).map((field) => ({
    fieldFingerprint: safeText(field.fieldFingerprint, 240),
    label: safeText(field.label, 180),
    elementType: safeText(field.elementType, 30),
    inputType: safeText(field.inputType, 40),
    required: Boolean(field.required),
    options: Array.isArray(field.options) ? field.options.slice(0, MAX_OPTIONS).map((option) => safeText(option, 120)) : [],
  })).filter((field) => field.fieldFingerprint && field.label);
}

function verifiedProfileProjection(profile = {}) {
  return {
    yearsExperience: profile.yearsExperience,
    workAuthorization: profile.workAuthorization,
    requiresSponsorship: profile.requiresSponsorship,
    securityClearance: profile.securityClearance,
    desiredSalary: profile.desiredSalary,
    minimumSalary: profile.minimumSalary,
    noticePeriod: profile.noticePeriod,
    availableStartDate: profile.availableStartDate,
    relocationWillingness: profile.relocationWillingness,
    travelWillingness: profile.travelWillingness,
    remotePreference: profile.remotePreference,
    preferredJobTypes: profile.preferredJobTypes,
  };
}

function buildAnswerMessages({ fields = [], profile = {}, resumeText = '', job = {} } = {}) {
  const system = `You answer employer application questions for a job candidate. Return one complete JSON object only:
{"fields":[{"fieldFingerprint":"...","answer":"string","reason":"","confidence":0.0}]}

RULES
- Answer ONLY from VERIFIED_PROFILE_DATA, SELECTED_RESUME_TEXT, and SAVED_JOB_CONTEXT. Never invent employers, dates, certifications, or numbers not supported by that evidence.
- For a field with options, answer must be an exact copy of one supplied option. If no option fits the evidence, omit the field entirely instead of guessing.
- If the evidence cannot support a truthful answer for a text field, omit the field entirely.
- Never answer password, CAPTCHA, MFA/one-time-code, legal attestation, demographic disclosure, salary-history, or final-submit fields even if supplied.
- Keep each reason under 160 characters. confidence is between 0 and 1 and must reflect how well the evidence supports the answer.`;
  const payload = {
    verifiedProfile: verifiedProfileProjection(profile),
    savedJobContext: {
      roleTitle: safeText(job.roleTitle, 300),
      company: safeText(job.company, 300),
      employmentType: safeText(job.employmentType, 120),
      salaryMin: job.salaryMin ?? null,
      salaryMax: job.salaryMax ?? null,
      description: safeText(job.description, MAX_JOB_CONTEXT_CHARS),
    },
    selectedResumeText: String(resumeText || '').slice(0, MAX_RESUME_CHARS),
    fields: answerableFieldProjection(fields),
  };
  return [
    { role: 'system', content: system },
    { role: 'user', content: `APPLICATION_QUESTION_DATA:\n${JSON.stringify(payload)}\nEND_APPLICATION_QUESTION_DATA` },
  ];
}

function responseText(response = {}) {
  const content = response?.message?.content;
  const raw = Array.isArray(content) ? content.map((part) => typeof part === 'string' ? part : part?.text || '').join('') : String(content || '');
  const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
  return start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
}

/**
 * Validate an AI answer response against the exact supplied fields. Returns
 * accepted fills (validated values) plus rejected entries with reasons so
 * callers keep full visibility; nothing here trusts model output by default.
 */
function parseAnswerResponse(response, fields = [], minConfidence = 0.7) {
  let parsed;
  try { parsed = JSON.parse(responseText(response)); } catch (error) { throw new Error(`AI answer response was not valid JSON: ${error.message}`); }
  const known = new Map(answerableFieldProjection(fields).map((field) => [field.fieldFingerprint, field]));
  const threshold = Math.max(0.5, Math.min(0.95, Number(minConfidence) || 0.7));
  const accepted = [];
  const rejected = [];
  for (const entry of Array.isArray(parsed?.fields) ? parsed.fields : []) {
    const fingerprint = safeText(entry?.fieldFingerprint, 240);
    const field = known.get(fingerprint);
    if (!field) continue;
    const answer = safeText(entry?.answer, MAX_ANSWER_CHARS);
    const confidence = Number.isFinite(Number(entry?.confidence)) ? Number(entry.confidence) : 0;
    const reject = (reasonCode) => rejected.push({ fieldFingerprint: fingerprint, label: field.label, reasonCode, confidence });
    // Defense in depth: even a misrouted protected field can never be filled here.
    const category = normalizeAnswerCategory({ ...field, questionText: field.label });
    if (NEVER_AUTONOMOUS_CATEGORIES.has(category) || PREAUTHORIZED_ONLY_CATEGORIES.has(category)) { reject('protected_category'); continue; }
    if (!answer) { reject('empty_answer'); continue; }
    if (/password|captcha|one[- ]time|verification code|mfa/i.test(`${field.label} ${answer}`)) { reject('protected_category'); continue; }
    if (field.options.length && !field.options.some((option) => option.toLowerCase() === answer.toLowerCase())) { reject('option_mismatch'); continue; }
    if (confidence < threshold) { reject('low_confidence'); continue; }
    accepted.push({ fieldFingerprint: fingerprint, label: field.label, value: answer, confidence: Math.min(1, confidence), reason: safeText(entry?.reason, 160) });
  }
  return { accepted, rejected };
}

/** Normalized key matching application-policy.reusableAnswerFor lookups. */
function reusableQuestionKeyForLabel(label) {
  return safeText(label, 160).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_./-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

module.exports = { MAX_ANSWER_CHARS, buildAnswerMessages, parseAnswerResponse, answerableFieldProjection, reusableQuestionKeyForLabel };


