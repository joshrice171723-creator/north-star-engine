'use strict';

const crypto = require('crypto');

const CANONICAL_APPLICATION_STATES = Object.freeze([
  'queued', 'researching', 'preparing_documents', 'validating_documents', 'opening', 'detecting_flow',
  'waiting_for_login', 'creating_account', 'waiting_for_activation', 'filling_profile', 'answering_questions',
  'waiting_for_answer', 'uploading_documents', 'navigating', 'ready_for_review', 'submitting',
  'verifying_browser', 'verifying_email', 'applied', 'retry_wait', 'blocked', 'terminal', 'ready_to_apply',
]);
const ACTIVE_STATES = new Set(['researching', 'preparing_documents', 'validating_documents', 'opening', 'detecting_flow', 'creating_account', 'filling_profile', 'answering_questions', 'uploading_documents', 'navigating', 'submitting', 'verifying_browser']);
const TERMINAL_STATES = new Set(['applied', 'terminal', 'ready_to_apply']);
const HUMAN_LABELS = Object.freeze({
  queued: 'Queued', researching: 'Researching the role', preparing_documents: 'Preparing documents', validating_documents: 'Validating documents', opening: 'Opening employer application', detecting_flow: 'Detecting application flow', waiting_for_login: 'Waiting for login', creating_account: 'Creating employer account', waiting_for_activation: 'Waiting for account activation', filling_profile: 'Filling approved profile details', answering_questions: 'Answering application questions', waiting_for_answer: 'Waiting for your answer', uploading_documents: 'Uploading approved documents', navigating: 'Continuing application form', ready_for_review: 'Ready for submission review', submitting: 'Submitting application', verifying_browser: 'Verifying browser confirmation', verifying_email: 'Waiting for employer email confirmation', applied: 'Applied and verified', retry_wait: 'Waiting to retry', blocked: 'Needs attention', terminal: 'Finished without applying', ready_to_apply: 'Ready to apply',
});

function assertCanonicalApplicationState(state) {
  if (!CANONICAL_APPLICATION_STATES.includes(state)) throw new Error(`Invalid application queue state: ${state}`);
  return state;
}

function createApplicationQueueService({ repository, worker = null, now = () => new Date().toISOString(), ownerId = `main-${process.pid}-${crypto.randomUUID()}`, leaseMs = 120000 } = {}) {
  if (!repository?.ensureRun || !repository?.claimNext) throw new Error('ApplicationQueueService requires a durable queue repository.');
  let processing = null;
  let queueWorker = worker;
  let currentRunId = repository.getActiveRun()?.id || repository.getLatestRun?.()?.id || null;
  let retryTimer = null;
  let retryTimerRunId = null;
  const manuallyPausedRuns = new Set();

  const clearRetryTimer = () => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    retryTimerRunId = null;
  };
  const retryDelayMs = (item) => item.attempt <= 1 ? 5000 : 30000;
  const retryAt = (item) => new Date(new Date(now()).getTime() + retryDelayMs(item)).toISOString();

  const decorateStatus = (run = (currentRunId ? repository.getRun(currentRunId) : repository.getActiveRun())) => {
    if (!run) return { runId: null, running: false, paused: true, mode: 'entire_pipeline', activeItemId: null, activeApplicationId: null, activeStage: '', activeStep: '', message: '', queue: [], counts: { total: 0, queued: 0, active: 0, blocked: 0, awaitingEmail: 0, applied: 0, terminal: 0, readyToApply: 0 } };
    // Ready to apply is the destination of preparation, not queue work. Keep
    // the durable item for history, but do not surface it in the live drawer.
    const items = repository.listItems(run.id).filter((item) => item.state !== 'ready_to_apply').map((item) => ({ ...item, automationState: item.state, automationCheckpoint: item.checkpoint, pauseReason: item.blocker?.message || '', eligible: item.state === 'queued', activeStep: HUMAN_LABELS[item.state] || item.state, progressLabel: HUMAN_LABELS[item.state] || item.state, isActive: item.id === run.activeItemId || ACTIVE_STATES.has(item.state) }));
    const active = items.find((item) => item.id === run.activeItemId) || items.find((item) => item.isActive) || null;
    return { runId: run.id, running: run.status === 'running', paused: run.status !== 'running', mode: run.mode, activeItemId: run.activeItemId, activeApplicationId: active?.applicationId || null, activeJobId: active?.jobId || null, activeStage: active?.state || '', activeStep: active?.progressLabel || '', message: run.message || '', queue: items.sort((left, right) => Number(right.isActive) - Number(left.isActive) || left.position - right.position), counts: { total: items.length, queued: items.filter((item) => ['queued', 'retry_wait'].includes(item.state)).length, active: items.filter((item) => item.isActive).length, blocked: items.filter((item) => ['blocked', 'waiting_for_login', 'waiting_for_activation', 'waiting_for_answer', 'ready_for_review'].includes(item.state)).length, awaitingEmail: items.filter((item) => item.state === 'verifying_email').length, applied: items.filter((item) => item.state === 'applied').length, terminal: items.filter((item) => item.state === 'terminal').length } };
  };

  async function processLoop(runId) {
    try {
      while (repository.getRun(runId)?.status === 'running') {
        const item = repository.claimNext(runId, { ownerId, leaseMs });
        if (!item) break;
        if (typeof queueWorker !== 'function') {
          repository.updateItem(item.id, { state: 'blocked', blocker: { code: 'queue_worker_unavailable', message: 'The application worker is not ready.', requiresUser: false }, leaseOwner: null, leaseExpiresAt: null });
          break;
        }
        try {
          const result = await queueWorker(item, { update: (change) => repository.updateItem(item.id, change), status: () => decorateStatus(repository.getRun(runId)) });
          const state = assertCanonicalApplicationState(result?.state || 'blocked');
          const exhausted = state === 'retry_wait' && item.attempt >= item.maxAttempts;
          repository.updateItem(item.id, {
            ...result,
            state: exhausted ? 'blocked' : state,
            nextRetryAt: state === 'retry_wait' && !exhausted ? (result?.nextRetryAt || retryAt(item)) : null,
            blocker: exhausted ? { code: 'retry_attempts_exhausted', message: 'North Star could not safely complete this application after the allowed retries. Review the details before trying again.', requiresUser: true } : result?.blocker,
            leaseOwner: null,
            leaseExpiresAt: null,
            completedAt: TERMINAL_STATES.has(state) ? now() : null,
          });
        } catch (error) {
          const retryable = error?.retryable === true && item.attempt < item.maxAttempts;
          repository.updateItem(item.id, { state: retryable ? 'retry_wait' : 'blocked', nextRetryAt: retryable ? retryAt(item) : null, blocker: retryable ? {} : { code: error?.code || 'application_worker_failed', message: String(error?.message || error).slice(0, 1000), requiresUser: Boolean(error?.requiresUser) }, lastError: String(error?.message || error), leaseOwner: null, leaseExpiresAt: null });
        }
        repository.updateRun(runId, { activeItemId: null });
      }
      const items = repository.listItems(runId);
      const retrying = items.filter((item) => item.state === 'retry_wait' && item.nextRetryAt).sort((left, right) => String(left.nextRetryAt).localeCompare(String(right.nextRetryAt)));
      const unfinished = items.some((item) => !TERMINAL_STATES.has(item.state) && !['blocked', 'waiting_for_login', 'waiting_for_activation', 'waiting_for_answer', 'ready_for_review', 'verifying_email'].includes(item.state));
      if (repository.getRun(runId)?.status === 'running') {
        repository.updateRun(runId, unfinished ? { status: 'paused', activeItemId: null, pausedAt: now(), message: retrying.length ? `Waiting to retry at ${retrying[0].nextRetryAt}.` : 'Queue paused with work remaining.' } : { status: 'completed', activeItemId: null, completedAt: now(), message: 'All actionable application work is complete.' });
      }
      if (retrying.length && !manuallyPausedRuns.has(runId)) scheduleRetry(runId, retrying[0].nextRetryAt);
    } finally { processing = null; }
  }

  function scheduleRetry(runId, nextRetryAt) {
    clearRetryTimer();
    const delay = Math.max(0, new Date(nextRetryAt).getTime() - new Date(now()).getTime());
    retryTimerRunId = runId;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      retryTimerRunId = null;
      if (manuallyPausedRuns.has(runId) || currentRunId !== runId || processing) return;
      const run = repository.getRun(runId);
      if (!run || run.status !== 'paused') return;
      repository.updateRun(runId, { status: 'running', pausedAt: null, message: 'Retrying queued application work.' });
      processing = processLoop(runId);
    }, delay);
  }

  function start({ applicationIds, mode = 'entire_pipeline' } = {}) {
    const run = repository.ensureRun({ applicationIds, mode });
    currentRunId = run.id;
    manuallyPausedRuns.delete(run.id);
    if (retryTimerRunId === run.id) clearRetryTimer();
    repository.updateRun(run.id, { status: 'running', startedAt: run.startedAt || now(), pausedAt: null, completedAt: null, message: 'Application preparation is running.' });
    if (!processing) processing = processLoop(run.id);
    return decorateStatus(repository.getRun(run.id));
  }
  function pause() {
    const run = repository.getActiveRun();
    if (!run) return decorateStatus(null);
    manuallyPausedRuns.add(run.id);
    if (retryTimerRunId === run.id) clearRetryTimer();
    repository.updateRun(run.id, { status: 'paused', pausedAt: now(), message: 'Queue paused. The current safe checkpoint will finish without starting another item.' });
    return decorateStatus(repository.getRun(run.id));
  }
  function retry(applicationId) {
    const run = (currentRunId && repository.getRun(currentRunId)) || repository.getActiveRun();
    if (!run) throw new Error('No application queue run is available.');
    const item = repository.getItemForApplication(run.id, applicationId);
    if (!item || !['blocked', 'retry_wait', 'waiting_for_answer', 'waiting_for_login', 'waiting_for_activation'].includes(item.state)) throw new Error('Only a blocked or waiting application can be retried.');
    repository.updateItem(item.id, { state: 'queued', blocker: {}, nextRetryAt: null, lastError: '' });
    manuallyPausedRuns.delete(run.id);
    repository.updateRun(run.id, { status: 'running', pausedAt: null, completedAt: null, message: 'Retrying the selected application.' });
    if (!processing) processing = processLoop(run.id);
    return decorateStatus(repository.getRun(run.id));
  }
  function recover() { const result = repository.recoverInterrupted(); currentRunId = result.run?.id || currentRunId; return result; }
  function setWorker(nextWorker) { queueWorker = nextWorker; }
  function updateApplication(applicationId, input) {
    const item = repository.findLatestItemForApplication(applicationId);
    if (!item) return null;
    repository.updateItem(item.id, input);
    return decorateStatus(repository.getRun(item.runId));
  }

  return { start, pause, retry, recover, status: () => decorateStatus(), setWorker, waitForIdle: async () => processing, updateItem: (itemId, input) => repository.updateItem(itemId, input), updateApplication };
}

module.exports = { CANONICAL_APPLICATION_STATES, HUMAN_LABELS, assertCanonicalApplicationState, createApplicationQueueService };
