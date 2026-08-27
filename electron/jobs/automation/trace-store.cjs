'use strict';

const SENSITIVE_KEY = /pass(word)?|token|secret|api[_-]?key|cookie|authorization|mfa|verification[_-]?code/i;
const MAX_STRING = 2000;

function sanitizeTraceValue(value, depth = 0) {
  if (depth > 5) return '[depth-limited]';
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.slice(0, MAX_STRING);
  if (Array.isArray(value)) return value.slice(0, 40).map((entry) => sanitizeTraceValue(entry, depth + 1));
  if (typeof value !== 'object') return String(value).slice(0, MAX_STRING);
  return Object.fromEntries(Object.entries(value).slice(0, 80).map(([key, entry]) => [key, SENSITIVE_KEY.test(key) ? '[redacted]' : sanitizeTraceValue(entry, depth + 1)]));
}

function sanitizeObservation(observation = {}) {
  return sanitizeTraceValue({ observationId: observation.observationId, pageFingerprint: observation.pageFingerprint, pageType: observation.pageType, site: observation.site, atsKey: observation.atsKey, currentUrl: observation.currentUrl ? String(observation.currentUrl).split('?')[0].slice(0, 500) : '', signals: observation.signals, fields: observation.fields, result: observation.result });
}

function createTraceStore({ repository } = {}) {
  if (!repository || typeof repository.saveWorkflowStep !== 'function') throw new Error('A trace repository is required.');
  return { recordStep(input = {}) { const trace = { ...input, observation: sanitizeObservation(input.observation), plan: sanitizeTraceValue(input.plan || {}), execution: sanitizeTraceValue(input.execution || {}), verification: sanitizeTraceValue(input.verification || {}) }; delete trace.browserState; return repository.saveWorkflowStep(trace); }, listSteps(applicationId) { return repository.listWorkflowSteps(applicationId); } };
}

async function replayWorkflowTrace({ steps = [], onStep } = {}) {
  if (!Array.isArray(steps)) throw new Error('Replay steps must be an array.');
  const metrics = { stepCount: 0, plannerFailures: 0, executorFailures: 0, verifierFailures: 0, siteChanges: 0, humanInterventions: 0, recoverySuccesses: 0 }; const replayed = [];
  for (const step of steps) {
    metrics.stepCount += 1; const reason = String(step.reasonCode || '');
    if (/plan|planner/i.test(reason)) metrics.plannerFailures += 1;
    if (/execut|browser/i.test(reason)) metrics.executorFailures += 1;
    if (/verif/i.test(reason)) metrics.verifierFailures += 1;
    if (/fingerprint|site_change|layout/i.test(reason)) metrics.siteChanges += 1;
    if (step.requiresUser || step.outcome === 'needs_user') metrics.humanInterventions += 1;
    const replay = typeof onStep === 'function' ? await onStep(sanitizeTraceValue(step)) : { outcome: step.outcome, reasonCode: step.reasonCode };
    if (replay?.outcome === 'continue' && /repair|recover/i.test(String(step.source || '') + reason)) metrics.recoverySuccesses += 1;
    replayed.push({ idempotencyKey: step.idempotencyKey, outcome: replay?.outcome || step.outcome || '', reasonCode: replay?.reasonCode || reason });
  }
  return { metrics, steps: replayed };
}

module.exports = { sanitizeTraceValue, sanitizeObservation, createTraceStore, replayWorkflowTrace };
