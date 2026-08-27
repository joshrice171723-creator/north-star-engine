'use strict';

const crypto = require('crypto');

const jsonObject = (value) => {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
};
const bounded = (value, max = 2000) => String(value ?? '').slice(0, max);
const createId = (prefix) => `${prefix}-${crypto.randomUUID()}`;

function createApplicationQueueRepository({ sqlite, now = () => new Date().toISOString() } = {}) {
  if (!sqlite?.prepare) throw new Error('The application queue repository requires SQLite.');

  const runToDto = (row) => row ? ({
    id: row.id,
    mode: row.mode,
    status: row.status,
    activeItemId: row.active_item_id,
    message: row.message,
    startedAt: row.started_at,
    pausedAt: row.paused_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }) : null;
  const itemToDto = (row) => row ? ({
    id: row.id,
    runId: row.run_id,
    applicationId: row.application_id,
    jobId: row.job_id,
    company: row.company || '',
    roleTitle: row.role_title || '',
    unknownQuestionCount: Number(row.unknown_question_count) || 0,
    position: Number(row.position) || 0,
    state: row.state,
    attempt: Number(row.attempt) || 0,
    maxAttempts: Number(row.max_attempts) || 0,
    checkpoint: jsonObject(row.checkpoint_json),
    blocker: jsonObject(row.blocker_json),
    authorization: jsonObject(row.authorization_json),
    browserEvidenceId: row.browser_evidence_id,
    emailEvidenceId: row.email_evidence_id,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    nextRetryAt: row.next_retry_at,
    lastError: row.last_error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }) : null;
  const itemSelect = `SELECT i.*, a.job_id, j.company, j.role_title,
    (SELECT COUNT(*) FROM job_application_unknown_questions q WHERE q.application_id = i.application_id AND q.status = 'open') AS unknown_question_count
    FROM application_queue_items i
    JOIN job_applications a ON a.id = i.application_id
    JOIN job_opportunities j ON j.id = a.job_id`;

  function getRun(runId) {
    return runToDto(sqlite.prepare('SELECT * FROM application_queue_runs WHERE id = ?').get(bounded(runId, 160)));
  }
  function getActiveRun() {
    return runToDto(sqlite.prepare("SELECT * FROM application_queue_runs WHERE status IN ('running','paused') ORDER BY updated_at DESC LIMIT 1").get());
  }
  function getLatestRun() {
    return runToDto(sqlite.prepare('SELECT * FROM application_queue_runs ORDER BY updated_at DESC LIMIT 1').get());
  }
  function listItems(runId) {
    return sqlite.prepare(`${itemSelect} WHERE i.run_id = ? ORDER BY i.position ASC, i.created_at ASC`).all(bounded(runId, 160)).map(itemToDto);
  }
  function getItem(itemId) {
    return itemToDto(sqlite.prepare(`${itemSelect} WHERE i.id = ?`).get(bounded(itemId, 160)));
  }
  function getItemForApplication(runId, applicationId) {
    return itemToDto(sqlite.prepare(`${itemSelect} WHERE i.run_id = ? AND i.application_id = ?`).get(bounded(runId, 160), bounded(applicationId, 160)));
  }
  function findLatestItemForApplication(applicationId) {
    return itemToDto(sqlite.prepare(`${itemSelect} WHERE i.application_id = ? ORDER BY i.updated_at DESC LIMIT 1`).get(bounded(applicationId, 160)));
  }
  function ensureRun({ applicationIds = [], mode = 'entire_pipeline' } = {}) {
    const ids = [...new Set(applicationIds.map((value) => bounded(value, 160)).filter(Boolean))];
    if (!ids.length) throw new Error('At least one application is required to start the queue.');
    return sqlite.transaction(() => {
      const stamp = now();
      let run = sqlite.prepare("SELECT * FROM application_queue_runs WHERE status IN ('running','paused') ORDER BY updated_at DESC LIMIT 1").get();
      if (!run) {
        run = { id: createId('application-run'), mode: bounded(mode, 80) || 'entire_pipeline', status: 'paused', active_item_id: null, message: '', started_at: null, paused_at: stamp, completed_at: null, created_at: stamp, updated_at: stamp };
        sqlite.prepare('INSERT INTO application_queue_runs (id,mode,status,active_item_id,message,started_at,paused_at,completed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(...Object.values(run));
      }
      let position = Number(sqlite.prepare('SELECT COALESCE(MAX(position), -1) AS value FROM application_queue_items WHERE run_id = ?').get(run.id).value) + 1;
      const insert = sqlite.prepare("INSERT INTO application_queue_items (id,run_id,application_id,position,state,attempt,max_attempts,checkpoint_json,blocker_json,authorization_json,browser_evidence_id,email_evidence_id,lease_owner,lease_expires_at,next_retry_at,last_error,started_at,completed_at,created_at,updated_at) VALUES (?,?,?,?, 'queued',0,3,'{}','{}','{}',NULL,NULL,NULL,NULL,NULL,'',NULL,NULL,?,?) ON CONFLICT(run_id,application_id) DO NOTHING");
      for (const applicationId of ids) {
        const exists = sqlite.prepare('SELECT 1 FROM job_applications WHERE id = ? AND deleted_at IS NULL').get(applicationId);
        if (!exists) throw new Error(`Application not found: ${applicationId}`);
        const inserted = insert.run(createId('application-item'), run.id, applicationId, position, stamp, stamp);
        if (inserted.changes) position += 1;
      }
      sqlite.prepare('UPDATE application_queue_runs SET mode = ?, updated_at = ? WHERE id = ?').run(bounded(mode, 80) || run.mode, stamp, run.id);
      return getRun(run.id);
    })();
  }
  function updateRun(runId, input = {}) {
    const current = getRun(runId);
    if (!current) throw new Error('Application queue run not found.');
    const stamp = now();
    const status = input.status || current.status;
    sqlite.prepare('UPDATE application_queue_runs SET status=?, active_item_id=?, message=?, started_at=?, paused_at=?, completed_at=?, updated_at=? WHERE id=?').run(
      status,
      input.activeItemId === undefined ? current.activeItemId : input.activeItemId,
      input.message === undefined ? current.message : bounded(input.message, 1000),
      input.startedAt === undefined ? current.startedAt : input.startedAt,
      input.pausedAt === undefined ? current.pausedAt : input.pausedAt,
      input.completedAt === undefined ? current.completedAt : input.completedAt,
      stamp,
      current.id,
    );
    return getRun(current.id);
  }
  function updateItem(itemId, input = {}) {
    const current = getItem(itemId);
    if (!current) throw new Error('Application queue item not found.');
    const checkpoint = input.checkpoint === undefined ? current.checkpoint : input.checkpoint;
    const blocker = input.blocker === undefined ? current.blocker : input.blocker;
    const authorization = input.authorization === undefined ? current.authorization : input.authorization;
    sqlite.prepare(`UPDATE application_queue_items SET state=?,attempt=?,checkpoint_json=?,blocker_json=?,authorization_json=?,browser_evidence_id=?,email_evidence_id=?,lease_owner=?,lease_expires_at=?,next_retry_at=?,last_error=?,started_at=?,completed_at=?,updated_at=? WHERE id=?`).run(
      input.state || current.state,
      Number.isInteger(input.attempt) ? input.attempt : current.attempt,
      JSON.stringify(checkpoint || {}),
      JSON.stringify(blocker || {}),
      JSON.stringify(authorization || {}),
      input.browserEvidenceId === undefined ? current.browserEvidenceId : input.browserEvidenceId,
      input.emailEvidenceId === undefined ? current.emailEvidenceId : input.emailEvidenceId,
      input.leaseOwner === undefined ? current.leaseOwner : input.leaseOwner,
      input.leaseExpiresAt === undefined ? current.leaseExpiresAt : input.leaseExpiresAt,
      input.nextRetryAt === undefined ? current.nextRetryAt : input.nextRetryAt,
      input.lastError === undefined ? current.lastError : bounded(input.lastError, 2000),
      input.startedAt === undefined ? current.startedAt : input.startedAt,
      input.completedAt === undefined ? current.completedAt : input.completedAt,
      now(),
      current.id,
    );
    return getItem(current.id);
  }
  function claimNext(runId, { ownerId, leaseMs = 120000 } = {}) {
    if (!ownerId) throw new Error('A queue lease owner is required.');
    return sqlite.transaction(() => {
      const stamp = now();
      const row = sqlite.prepare(`${itemSelect} WHERE i.run_id = ? AND i.state IN ('queued','retry_wait') AND (i.next_retry_at IS NULL OR i.next_retry_at <= ?) AND i.lease_owner IS NULL ORDER BY i.position ASC, i.created_at ASC LIMIT 1`).get(bounded(runId, 160), stamp);
      if (!row) return null;
      const leaseExpiresAt = new Date(new Date(stamp).getTime() + leaseMs).toISOString();
      const changed = sqlite.prepare("UPDATE application_queue_items SET state='opening',attempt=attempt+1,lease_owner=?,lease_expires_at=?,started_at=COALESCE(started_at,?),updated_at=? WHERE id=? AND lease_owner IS NULL").run(ownerId, leaseExpiresAt, stamp, stamp, row.id);
      if (!changed.changes) return null;
      sqlite.prepare('UPDATE application_queue_runs SET active_item_id=?,updated_at=? WHERE id=?').run(row.id, stamp, runId);
      return getItem(row.id);
    })();
  }
  function recoverInterrupted() {
    return sqlite.transaction(() => {
      const stamp = now();
      const risky = sqlite.prepare("SELECT id FROM application_queue_items WHERE lease_owner IS NOT NULL AND state IN ('submitting','verifying_browser')").all();
      for (const { id } of risky) updateItem(id, { state: 'blocked', blocker: { code: 'submission_outcome_uncertain', message: 'Submission may have occurred before North Star restarted. Review browser and email evidence; do not resubmit automatically.', requiresUser: true }, leaseOwner: null, leaseExpiresAt: null });
      sqlite.prepare("UPDATE application_queue_items SET state='queued',lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE lease_owner IS NOT NULL AND state NOT IN ('submitting','verifying_browser')").run(stamp);
      sqlite.prepare("UPDATE application_queue_runs SET status='paused',active_item_id=NULL,message='Queue recovered after restart. Review uncertain submissions before resuming.',paused_at=?,updated_at=? WHERE status='running'").run(stamp, stamp);
      return { recovered: true, uncertainSubmissionCount: risky.length, run: getActiveRun() };
    })();
  }

  return { getRun, getActiveRun, getLatestRun, listItems, getItem, getItemForApplication, findLatestItemForApplication, ensureRun, updateRun, updateItem, claimNext, recoverInterrupted };
}

module.exports = { createApplicationQueueRepository };
