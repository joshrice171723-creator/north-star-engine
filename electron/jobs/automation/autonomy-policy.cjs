'use strict';

// Single owner of what the autonomous queue may do without user interaction.
// Deliberately pure: main.cjs and the browser layers supply fields, profile,
// and policies, but only this module decides whether an autonomous action is
// permitted. Supervised mode (the default) must behave exactly like the
// pre-autonomy implementation.

const { normalizeAnswerCategory } = require('./answer-policy.cjs');
const { classifyField } = require('../application-policy.cjs');

const AUTONOMY_LEVELS = Object.freeze(['supervised', 'autonomous']);
const DEFAULT_ANSWER_CONFIDENCE = 0.7;
// Categories that no autonomous path may ever fill or improvise. Final submit
// is not a field decision; it is gated separately by performAutonomousSubmission.
const NEVER_AUTONOMOUS_CATEGORIES = Object.freeze(new Set(['password', 'authentication_captcha', 'mfa']));
// Categories answered only from a one-time pre-authorized human policy, never
// from live AI generation.
const PREAUTHORIZED_ONLY_CATEGORIES = Object.freeze(new Set(['current_salary', 'legal_attestation', 'sensitive_voluntary_disclosure']));

function normalizeAutonomyLevel(value) {
  const level = String(value || '').trim().toLowerCase();
  return AUTONOMY_LEVELS.includes(level) ? level : 'supervised';
}

function isAutonomous(profile = {}) {
  return normalizeAutonomyLevel(profile.autonomyLevel) === 'autonomous';
}

function answerConfidenceThreshold(profile = {}) {
  const value = Number(profile.autonomyAnswerConfidence);
  if (!Number.isFinite(value)) return DEFAULT_ANSWER_CONFIDENCE;
  return Math.max(0.5, Math.min(0.95, value));
}

function generatedCredentialsEnabled(profile = {}) {
  return Boolean(profile.generatedCredentialsEnabled);
}

function listPreauthorizedPolicies(profile = {}) {
  const policies = Array.isArray(profile.preAuthorizedPolicies) ? profile.preAuthorizedPolicies : [];
  return policies
    .filter((policy) => policy && typeof policy === 'object')
    .map((policy) => ({
      category: String(policy.category || '').trim().toLowerCase(),
      answerText: String(policy.answerText ?? '').slice(0, MAX_PREAUTHORIZED_ANSWER_CHARS),
      approvedAt: String(policy.approvedAt || ''),
    }))
    .filter((policy) => policy.category);
}

const MAX_PREAUTHORIZED_ANSWER_CHARS = 2000;

function normalizedText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9%$. ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Deterministic policy lookup for protected categories. Returns null when the
 * category has no approved pre-authorization; callers must then keep the
 * existing ask/blocked behavior instead of improvising an answer.
 */
function preauthorizedAnswerFor(field, profile = {}) {
  const category = normalizeAnswerCategory(field);
  if (!PREAUTHORIZED_ONLY_CATEGORIES.has(category)) return null;
  const policy = listPreauthorizedPolicies(profile).find((entry) => entry.category === category && entry.answerText);
  return policy ? { category, value: policy.answerText, provenance: [`preauthorized_policy.${category}`], confidence: 1 } : null;
}

/**
 * A legal-attestation checkbox may be checked autonomously only when its
 * visible text matches a template the user explicitly pre-authorized. The
 * match is deterministic normalized containment with a minimum template length
 * so short templates cannot swallow unrelated agreements.
 */
function matchingAttestationTemplate(fieldText, profile = {}) {
  const templates = Array.isArray(profile.preAuthorizedAttestations) ? profile.preAuthorizedAttestations : [];
  const pageText = normalizedText(fieldText);
  if (!pageText) return null;
  for (const raw of templates) {
    const template = normalizedText(raw);
    if (template.length < 12) continue;
    if (pageText.includes(template) || template.includes(pageText)) return String(raw).slice(0, 2000);
  }
  return null;
}

/**
 * Whether an ordinary employer question may be answered by the AI
 * question-answerer. Protected categories are resolved through
 * preauthorizedAnswerFor before this is consulted.
 */
function canAiAnswer(field) {
  if (!field || field.empty === false || field.disabled || field.readOnly) return false;
  const category = normalizeAnswerCategory(field);
  if (NEVER_AUTONOMOUS_CATEGORIES.has(category)) return false;
  if (PREAUTHORIZED_ONLY_CATEGORIES.has(category)) return false;
  if (field.category === 'identity_contact' || classifyField(field) === 'identity_contact') return false;
  return true;
}

module.exports = {
  AUTONOMY_LEVELS,
  DEFAULT_ANSWER_CONFIDENCE,
  NEVER_AUTONOMOUS_CATEGORIES,
  PREAUTHORIZED_ONLY_CATEGORIES,
  normalizeAutonomyLevel,
  isAutonomous,
  answerConfidenceThreshold,
  generatedCredentialsEnabled,
  listPreauthorizedPolicies,
  preauthorizedAnswerFor,
  matchingAttestationTemplate,
  canAiAnswer,
};
