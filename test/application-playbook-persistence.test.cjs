'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const BetterSqlite3 = require('better-sqlite3');
const { createDatabase } = require('../electron/database.cjs');

function tempRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'north-star-playbook-')); }
function stepInput(overrides = {}) { return { id: 'first-step', playbookId: 'playbook-1', stepKey: 'dice-handoff', stepOrder: 0, pageType: 'application_form', pageFingerprint: 'fp-1', actionType: 'handoff', target: { label: 'Apply now' }, verification: { required: true }, confidence: 0.9, successIncrement: 1, ...overrides }; }

test('logical playbook identity updates changed fingerprints and preserves separate steps', () => {
  const root = tempRoot(); const database = createDatabase({ userDataPath: root, seedPath: path.join(root, 'missing.csv') });
  try {
    database.applications.playbooks.save({ id: 'playbook-1', siteHost: 'dice.example', atsKey: 'dice', workflowKind: 'job_application' });
    database.applications.playbooks.saveStep(stepInput());
    database.applications.playbooks.saveStep(stepInput({ id: 'competing-step-id', pageFingerprint: 'fp-2' }));
    database.applications.playbooks.saveStep(stepInput({ id: 'next-step', stepKey: 'dice-profile', stepOrder: 1, pageFingerprint: 'profile-fp' }));
    const steps = database.applications.playbooks.steps('playbook-1');
    assert.equal(steps.length, 2);
    const handoff = steps.find((step) => step.stepKey === 'dice-handoff');
    assert.equal(handoff.id, 'first-step');
    assert.equal(handoff.pageFingerprint, 'fp-2');
    assert.equal(handoff.successCount, 2);
  } finally { database.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('deferred playbook learning survives until it is resolved', () => {
  const root = tempRoot(); const database = createDatabase({ userDataPath: root, seedPath: path.join(root, 'missing.csv') });
  try {
    const retry = database.applications.playbooks.learningRetries.queue({ applicationId: 'application-1', siteHost: 'dice.example', atsKey: 'dice', stepKey: 'dice-handoff', pageFingerprint: 'fp-1', plan: { stepId: 'dice-handoff', actionType: 'handoff' }, lastError: 'temporary failure' });
    assert.equal(database.applications.playbooks.learningRetries.listPending().length, 1);
    database.applications.playbooks.learningRetries.resolve(retry.id);
    assert.equal(database.applications.playbooks.learningRetries.listPending().length, 0);
  } finally { database.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('migration merges historical duplicate logical steps before enforcing identity', () => {
  const root = tempRoot(); const file = path.join(root, 'legacy.sqlite'); const sqlite = new BetterSqlite3(file);
  try {
    sqlite.exec(fs.readFileSync(path.join(__dirname, '..', 'electron', 'migrations', '0031_application_site_playbooks.sql'), 'utf8'));
    sqlite.prepare('INSERT INTO application_site_playbooks (id,site_host,ats_key,workflow_kind,version,status,confidence,playbook_json,source,success_count,failure_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run('legacy-playbook', 'dice.example', 'dice', 'job_application', 1, 'candidate', 0.8, '{}', 'test', 0, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    const insert = sqlite.prepare('INSERT INTO application_playbook_steps (id,playbook_id,step_order,step_key,page_type,page_fingerprint,action_type,target_json,arguments_json,verification_json,safety_class,confidence,success_count,failure_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    insert.run('old-step', 'legacy-playbook', 0, 'dice-handoff', 'form', 'old-fp', 'handoff', '{}', '{}', '{}', 'safe_navigation', 0.6, 2, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    insert.run('new-step', 'legacy-playbook', 1, 'dice-handoff', 'form', 'new-fp', 'handoff', '{}', '{}', '{}', 'safe_navigation', 0.9, 3, 2, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
    sqlite.exec(fs.readFileSync(path.join(__dirname, '..', 'electron', 'migrations', '0035_harden_playbook_learning.sql'), 'utf8'));
    const active = sqlite.prepare('SELECT * FROM application_playbook_steps WHERE deleted_at IS NULL').all();
    assert.equal(active.length, 1); assert.equal(active[0].id, 'new-step'); assert.equal(active[0].success_count, 5); assert.equal(active[0].failure_count, 3); assert.equal(active[0].confidence, 0.9);
    assert.throws(() => insert.run('duplicate-step', 'legacy-playbook', 2, 'dice-handoff', 'form', 'newest-fp', 'handoff', '{}', '{}', '{}', 'safe_navigation', 1, 1, 0, '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z'), /UNIQUE constraint failed/);
  } finally { sqlite.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
