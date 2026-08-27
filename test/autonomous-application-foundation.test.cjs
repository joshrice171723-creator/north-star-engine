const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createDatabase } = require('../electron/database.cjs');
const { AUTONOMOUS_APPLICATION_STATES } = require('../electron/jobs/application-automation.cjs');
const { reusableAnswerFor } = require('../electron/jobs/application-policy.cjs');

test('autonomous application state and unknown questions survive a database reopen', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aicc-autonomous-'));
  try {
    const db = createDatabase({ userDataPath, seedPath: path.join(userDataPath, 'missing.csv') });
    db.jobs.create({ id: 'autonomous-job', company: 'Acme', roleTitle: 'Engineer', url: 'https://example.test/apply' });
    const app = db.applications.createOrResume({ jobId: 'autonomous-job' });
    assert.equal(app.automationState, 'queued');
    assert.ok(AUTONOMOUS_APPLICATION_STATES.includes('needs_user_answer'));
    const unknown = db.applications.saveUnknownQuestion({ applicationId: app.id, providerHost: 'jobs.example.test', pageFingerprint: 'fp-1', controlLabel: 'Veteran status', controlType: 'select', questionKey: 'veteran_status', questionText: 'Do you identify as a veteran?', options: ['Yes', 'No'] });
    assert.equal(unknown.status, 'open');
    assert.equal(db.applications.get(app.id).automationState, 'needs_user_answer');
    db.close();
    const reopened = createDatabase({ userDataPath, seedPath: path.join(userDataPath, 'missing.csv') });
    assert.equal(reopened.applications.listUnknownQuestions(app.id)[0].questionText, 'Do you identify as a veteran?');
    const answer = reopened.applications.resolveUnknownQuestion({ id: unknown.id, answerText: 'No', provenance: ['user-provided'] });
    assert.equal(answer.answerText, 'No');
    assert.equal(reopened.applications.listUnknownQuestions(app.id).length, 0);
    assert.equal(reopened.applications.get(app.id).automationState, 'queued');
    reopened.close();
  } finally { fs.rmSync(userDataPath, { recursive: true, force: true }); }
});

test('answers from safe-pass questions are reusable by the visible control label', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aicc-safe-pass-answer-'));
  try {
    const db = createDatabase({ userDataPath, seedPath: path.join(userDataPath, 'missing.csv') });
    db.jobs.create({ id: 'safe-pass-job', company: 'Acme', roleTitle: 'Engineer', url: 'https://example.test/apply' });
    const app = db.applications.createOrResume({ jobId: 'safe-pass-job' });
    const unknown = db.applications.saveUnknownQuestion({ applicationId: app.id, providerHost: 'jobs.example.test', pageFingerprint: 'fp-2', controlLabel: 'Why do you want this role?', controlType: 'textarea', questionKey: 'safe-pass:field-123', questionText: 'What answer should be entered for “Why do you want this role?”?' });
    const answer = db.applications.resolveUnknownQuestion({ id: unknown.id, answerText: 'The role matches my experience.' });
    assert.equal(answer.questionKey, 'why do you want this role?');
    assert.equal(answer.questionText, 'Why do you want this role?');
    assert.equal(db.applications.listAnswers(app.id)[0].answerText, 'The role matches my experience.');
    assert.equal(reusableAnswerFor({ label: 'Why do you want this role?' }, db.applications.listAnswers(app.id)).answerText, 'The role matches my experience.');
    db.close();
  } finally { try { db.close(); } catch {} fs.rmSync(userDataPath, { recursive: true, force: true }); }
});
