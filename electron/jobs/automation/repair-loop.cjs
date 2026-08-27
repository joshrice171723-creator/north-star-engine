'use strict';

const ALLOWED_REPAIR_ACTIONS = new Set(['handoff', 'open_google_login', 'pause_for_user']);
const FORBIDDEN_ACTION = /submit|send|password|credential|captcha|mfa|demographic|salary|authorization/i;

function validateRepairPlan(plan = {}, observation = {}) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('A repair plan is required.');
  const actionType = String(plan.actionType || '').trim();
  const targetFingerprint = String(plan.targetFingerprint || '').trim();
  const targetLabel = String(plan.targetLabel || '').trim().slice(0, 160);
  const pageFingerprint = String(observation.pageFingerprint || '').trim();
  if (!ALLOWED_REPAIR_ACTIONS.has(actionType)) throw new Error('The repair proposed an unsafe action.');
  if (FORBIDDEN_ACTION.test(JSON.stringify(plan))) throw new Error('The repair proposed a protected or irreversible operation.');
  if (!pageFingerprint || targetFingerprint !== pageFingerprint) throw new Error('The repair target does not match the observed page.');
  if (actionType !== 'pause_for_user' && !targetLabel) throw new Error('A repaired navigation step needs an exact visible label.');
  return { ...plan, actionType, targetFingerprint: pageFingerprint, targetLabel, source: 'ai_repair', confidence: Math.max(0, Math.min(1, Number(plan.confidence) || 0)), requiresUser: actionType === 'pause_for_user' };
}

function createRepairLoop({ proposeRepair, executeSafeStep, verifyStepResult, recordRepair, maxAttempts = 1 } = {}) {
  if (typeof proposeRepair !== 'function' || typeof executeSafeStep !== 'function' || typeof verifyStepResult !== 'function') throw new Error('A repair loop requires proposal, execution, and verification handlers.');
  return {
    async handle({ applicationId, observation, failedPlan, failure, browserState, context = {} } = {}) {
      if (Number(context.repairAttempts || 0) >= Math.min(1, maxAttempts)) return { status: 'not_attempted', reasonCode: 'repair_budget_exhausted' };
      let proposal;
      try { proposal = await proposeRepair({ applicationId, observation, failedPlan, failure, context }); } catch (error) {
        recordRepair?.({ applicationId, observation, failedPlan, failure, status: 'failed', reasonCode: 'repair_planner_failed', error: error.message });
        return { status: 'failed', reasonCode: 'repair_planner_failed', requiresUser: true };
      }
      let plan;
      try { plan = validateRepairPlan(proposal, observation); } catch (error) {
        recordRepair?.({ applicationId, observation, failedPlan, failure, status: 'rejected', reasonCode: 'unsafe_repair_plan', error: error.message });
        return { status: 'rejected', reasonCode: 'unsafe_repair_plan', requiresUser: true };
      }
      const execution = await executeSafeStep(plan, { applicationId, browserState, repair: true });
      // Independent verification is mandatory before storing a repair as reusable.
      const verification = await verifyStepResult({ plan, execution, browserState, applicationId, repair: true });
      const verified = verification?.status === 'verified' && verification?.outcome === 'continue';
      const result = { status: verified ? 'repaired' : 'failed', plan, execution, verification, reasonCode: verified ? '' : 'repair_verification_failed', attempts: 1 };
      recordRepair?.({ applicationId, observation, failedPlan, failure, ...result });
      return result;
    },
  };
}

module.exports = { ALLOWED_REPAIR_ACTIONS, validateRepairPlan, createRepairLoop };
