#!/usr/bin/env node
'use strict';

// Read-only post-mortem for the durable job-application pipeline. Opens the
// live SQLite database in readonly mode (safe while the app is running) and
// prints the same failure analysis the queue UI shows, plus failure clusters
// and stage timings that are not surfaced anywhere else.
//
// Usage:
//   npm run diagnose                       # last 3 runs, human-readable
//   npm run diagnose -- --last 1 --json    # machine-readable rollup
//   npm run diagnose -- --run <runId>      # one specific run
//   npm run diagnose -- --application <id> # one application across runs
//   node scripts/diagnose-pipeline.cjs --db C:\path\to\executive-coach.sqlite

const path = require('node:path');
const Database = require('better-sqlite3');
const { summarizeRun, formatReport } = require('../electron/jobs/automation/pipeline-diagnostics.cjs');

function parseArgs(argv = []) {
  const options = { db: process.env.NORTH_STAR_DB || '', run: '', application: '', last: 3, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--db') options.db = argv[++index] || '';
    else if (flag === '--run') options.run = argv[++index] || '';
    else if (flag === '--application') options.application = argv[++index] || '';
    else if (flag === '--json') options.json = true;
    else if (flag === '--last') options.last = Math.max(1, Number(argv[++index]) || 3);
    else throw new Error(`Unknown option: ${flag}`);
  }
  return options;
}

function defaultDatabasePath() {
  const appData = process.env.APPDATA || process.env.HOME || '';
  return appData ? path.join(appData, 'ClaudeArchitectStudyCoachNative', 'executive-coach.sqlite') : 'executive-coach.sqlite';
}

const itemSelect = `SELECT i.*, a.job_id, j.company, j.role_title,
    (SELECT COUNT(*) FROM job_application_unknown_questions q WHERE q.application_id = i.application_id AND q.status = 'open') AS unknown_question_count
    FROM application_queue_items i
    JOIN job_applications a ON a.id = i.application_id
    JOIN job_opportunities j ON j.id = a.job_id`;

const parseJsonField = (value) => {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
};

function itemToDto(row) {
  return {
    id: row.id,
    runId: row.run_id,
    applicationId: row.application_id,
    company: row.company || '',
    roleTitle: row.role_title || '',
    state: row.state,
    attempt: Number(row.attempt) || 0,
    maxAttempts: Number(row.max_attempts) || 0,
    checkpoint: parseJsonField(row.checkpoint_json),
    blocker: parseJsonField(row.blocker_json),
    nextRetryAt: row.next_retry_at,
    lastError: row.last_error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 2; return; }
  const databasePath = options.db || defaultDatabasePath();
  let sqlite;
  try { sqlite = new Database(databasePath, { readonly: true, fileMustExist: true }); }
  catch (error) { console.error(`Could not open ${databasePath} read-only: ${error.message}`); process.exitCode = 2; return; }

  try {
    if (options.application) {
      const runs = sqlite.prepare('SELECT * FROM application_queue_runs ORDER BY updated_at DESC LIMIT ?').all(25);
      let printed = false;
      for (const run of runs) {
        const rows = sqlite.prepare(`${itemSelect} WHERE i.run_id = ? AND i.application_id = ?`).all(run.id, options.application);
        if (!rows.length) continue;
        printed = true;
        emit(summarizeRun(run, rows.map(itemToDto)), options);
      }
      if (!printed) console.log(`No queue items found for application ${options.application} in the last 25 runs.`);
      return;
    }
    const runs = options.run
      ? sqlite.prepare('SELECT * FROM application_queue_runs WHERE id = ?').all(options.run)
      : sqlite.prepare('SELECT * FROM application_queue_runs ORDER BY updated_at DESC LIMIT ?').all(options.last);
    if (!runs.length) console.log(options.run ? `Run ${options.run} was not found.` : 'No pipeline runs recorded yet.');
    for (const run of runs) {
      const rows = sqlite.prepare(`${itemSelect} WHERE i.run_id = ? ORDER BY i.position ASC`).all(run.id);
      emit(summarizeRun(run, rows.map(itemToDto)), options);
    }
  } finally { sqlite.close(); }
}

function emit(summary, options) {
  if (options.json) console.log(JSON.stringify(summary, null, options.application || options.run ? 2 : 1));
  else { console.log(formatReport(summary)); console.log(''); }
}

main();