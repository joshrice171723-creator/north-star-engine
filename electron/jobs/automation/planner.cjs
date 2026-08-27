'use strict';

const HANDOFF_LABEL = /^(?:easy )?apply(?: now| for this job| on company site| externally)?$|^continue application$|^view application$/i;
const LOGIN_LABEL = /^(continue with google|sign in|log in|login)$/i;

function classifyPageType(observation = {}) {
  if (observation.pageSignals?.length) return 'unavailable_listing';
  const labels = (observation.fields || []).map((field) => String(field.label || '')).join(' ');
  const text = `${observation.pageTitle || ''} ${observation.currentUrl || ''} ${labels}`;
  if (/captcha|verify you are human/i.test(text)) return 'captcha';
  if (/sign in|log in|login|account chooser/i.test(text)) return 'login';
  if (/thank you|application received|confirmation/i.test(text)) return 'confirmation';
  if ((observation.fields || []).some((field) => field.inputType === 'file' || field.category === 'protected')) return 'application_form';
  if ((observation.fields || []).some((field) => field.category === 'navigation' && HANDOFF_LABEL.test(String(field.label || '')))) return 'job_listing';
  return 'unknown';
}

function planNextStep({ observation, playbook = null, currentCheckpoint = {}, mode = 'deterministic' } = {}) {
  const pageFingerprint = String(observation?.pageFingerprint || '').trim();
  if (!pageFingerprint) throw new Error('Cannot plan a browser step without a page fingerprint.');
  if (playbook?.step?.pageFingerprint === pageFingerprint) {
    // A stored step is still passed through the normal safe executor and
    // verifier; the registry supplies a target, never permission to submit.
    return { stepId: playbook.step.stepKey, stepType: playbook.step.pageType || 'safe_navigation', actionType: playbook.step.actionType, targetFingerprint: pageFingerprint, targetLabel: playbook.step.target?.label || '', source: 'playbook', confidence: Number(playbook.step.confidence) || 0, requiresUser: playbook.step.safetyClass !== 'safe_navigation', pageType: playbook.step.pageType || 'unknown' };
  }
  const pageType = classifyPageType(observation);
  const navigation = (observation.fields || []).find((field) => field.category === 'navigation' && HANDOFF_LABEL.test(String(field.label || '')));
  const login = (observation.fields || []).find((field) => field.category === 'navigation' && LOGIN_LABEL.test(String(field.label || '')));
  if (pageType === 'captcha' || pageType === 'confirmation') return { stepId: currentCheckpoint.stepKey || pageType, stepType: pageType, actionType: 'pause_for_user', targetFingerprint: pageFingerprint, source: 'deterministic_policy', confidence: 0.99, requiresUser: true };
  return {
    stepId: currentCheckpoint.stepKey || 'dice-handoff',
    stepType: pageType === 'login' ? 'login_path' : 'safe_navigation',
    actionType: pageType === 'login' && login ? 'open_google_login' : pageType === 'application_form' ? 'pause_for_user' : 'handoff',
    targetFingerprint: pageFingerprint,
    targetLabel: login?.label || navigation?.label || '',
    source: mode === 'playbook' ? 'playbook' : 'deterministic_policy',
    confidence: navigation || login ? 0.98 : 0.72,
    requiresUser: pageType === 'application_form',
    pageType,
  };
}

module.exports = { planNextStep, classifyPageType, HANDOFF_LABEL };
