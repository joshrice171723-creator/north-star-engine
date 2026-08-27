import React from 'react';
import { LoaderCircle, Pause, Play, RotateCcw, MessageCircle, ExternalLink } from 'lucide-react';
import './applicationAssistant.css';

const stageLabel = (stage) => ({
  target: 'Target',
  researching: 'Researching',
  preparing_documents: 'Preparing documents',
  validating_documents: 'Validating documents',
  queued: 'Queued',
  opening: 'Opening employer application',
  detecting_flow: 'Detecting application flow',
  waiting_for_login: 'Waiting for login',
  creating_account: 'Creating employer account',
  waiting_for_activation: 'Waiting for activation',
  filling_profile: 'Filling approved profile',
  answering_questions: 'Answering questions',
  waiting_for_answer: 'Needs your answer',
  uploading_documents: 'Uploading documents',
  navigating: 'Continuing application',
  ready_for_review: 'Ready for submission review',
  submitting: 'Submitting',
  verifying_browser: 'Verifying browser confirmation',
  verifying_email: 'Awaiting employer email',
  retry_wait: 'Waiting to retry',
  blocked: 'Blocked',
  applied: 'Applied',
  terminal: 'Finished without applying',
})[stage] || String(stage || 'Queued').replaceAll('_', ' ');
const retryLabel = (value) => value ? `Retry scheduled ${new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '';
const evidenceLabel = (entry) => entry.browserEvidenceId && entry.emailEvidenceId
  ? 'Browser and employer-email evidence verified'
  : entry.browserEvidenceId
    ? 'Browser receipt saved; awaiting employer email'
    : entry.emailEvidenceId
      ? 'Employer email matched; awaiting browser evidence'
      : '';

export default function ApplicationQueueDrawer({
  status,
  currentApplicationId,
  starting = false,
  onStart,
  onPause,
  onOpenJob,
  onAnswer,
  onRetry,
}) {
  const queue = Array.isArray(status?.queue) ? status.queue : [];
  const activeId = status?.activeApplicationId || currentApplicationId;
  const canStart = Boolean(status?.paused || queue.some((entry) => ['queued', 'retry_wait'].includes(entry.state)));
  return <section className="assistant-queue-drawer" aria-live="polite">
    <div className="assistant-queue-heading">
      <div>
        <span className="eyebrow">APPLICATION PREPARATION · UP TO READY TO APPLY</span>
        <b>{status?.activeStep || (status?.paused ? 'Paused' : 'Ready to continue')}</b>
      </div>
      <span className={`assistant-queue-status${status?.activeApplicationId ? ' active' : ''}`}>
        {status?.activeApplicationId ? <LoaderCircle size={12} /> : null}
        {status?.activeApplicationId ? 'Now working' : `${status?.counts?.total || queue.length} applications`}
      </span>
    </div>
    {status?.message && <p className="assistant-queue-message">{status.message}</p>}
    <div className="assistant-queue-controls">
      <button className="primary" disabled={starting || !canStart} onClick={() => onStart?.(currentApplicationId)}>
        <Play size={13} /> {starting ? 'Preparing jobs…' : 'Prepare all jobs'}
      </button>
      <button className="secondary" disabled={status?.paused && !status?.activeApplicationId} onClick={onPause}>
        <Pause size={13} /> Pause
      </button>
    </div>
    <div className="assistant-queue-counts">
      <span><b>{status?.counts?.queued || 0}</b> queued</span>
      <span><b>{status?.counts?.active || 0}</b> active</span>
      <span><b>{status?.counts?.blocked || 0}</b> need attention</span>
      <span><b>{status?.counts?.awaitingEmail || 0}</b> awaiting email</span>
      <span><b>{status?.counts?.applied || 0}</b> applied</span>
    </div>
    <div className="assistant-queue-list">
      {queue.length ? queue.map((entry) => {
        const active = entry.applicationId === activeId;
        const state = entry.state || entry.stage || entry.automationState;
        const needsAnswer = state === 'waiting_for_answer';
        const retryable = ['blocked', 'retry_wait'].includes(state) && entry.blocker?.code !== 'submission_outcome_uncertain';
        const needsOpen = ['waiting_for_login', 'waiting_for_activation', 'ready_for_review', 'verifying_browser'].includes(state);
        return <div className={`assistant-queue-row${active ? ' active' : ''}`} key={entry.applicationId || entry.jobId}>
          <button className="assistant-queue-job" onClick={() => onOpenJob?.(entry)}>
            <span>{entry.company || 'Unknown employer'} — {entry.roleTitle || 'Untitled role'}</span>
            <small>{[stageLabel(state), entry.blocker?.message, retryLabel(entry.nextRetryAt), evidenceLabel(entry)].filter(Boolean).join(' · ')}</small>
          </button>
          {needsAnswer && <button className="secondary assistant-queue-action" onClick={() => onAnswer?.(entry)}><MessageCircle size={12} /> Answer</button>}
          {retryable && <button className="secondary assistant-queue-action" onClick={() => onRetry?.(entry)}><RotateCcw size={12} /> Retry</button>}
          {needsOpen && <button className="secondary assistant-queue-action" onClick={() => onOpenJob?.(entry)}><ExternalLink size={12} /> {state === 'ready_for_review' ? 'Review' : state === 'waiting_for_login' ? 'Login' : 'Open'}</button>}
          {entry.blocker?.code && <details className="assistant-queue-diagnostics"><summary>Details</summary><code>{entry.blocker.code}</code></details>}
        </div>;
      }) : <small className="assistant-queue-empty">No application workflow jobs are waiting.</small>}
    </div>
  </section>;
}
