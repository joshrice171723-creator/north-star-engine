const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDatabase } = require('../electron/database.cjs');

function create() {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'north-star-autonomous-queue-'));
  return { userDataPath, db: createDatabase({ userDataPath, seedPath: path.join(userDataPath, 'missing.csv'), applicationDocumentsPath: userDataPath }) };
}

test('Stage 1 claims one eligible ready application and recovers its opening checkpoint', () => {
  const { userDataPath, db } = create();
  try {
    db.jobs.create({ id: 'queue-ready', company: 'Acme', roleTitle: 'Engineer', url: 'https://jobs.example.test/apply', stage: 'researching' });
    db.jobs.create({ id: 'queue-ineligible', company: 'No HTTPS', roleTitle: 'Engineer', url: 'http://jobs.example.test/apply', stage: 'ready' });
    const app = db.applications.createOrResume({ jobId: 'queue-ready' });
    const resume = db.applications.documents.save({ applicationId: app.id, documentType: 'resume', title: 'Resume', content: { headline: 'Engineer' }, validation: { valid: true, errors: [] }, status: 'approved' });
    const cover = db.applications.documents.save({ applicationId: app.id, documentType: 'cover_letter', title: 'Cover letter', content: { headline: 'Engineer' }, validation: { valid: true, errors: [] }, status: 'approved' });
    db.applications.documents.select(resume.id);
    db.applications.documents.select(cover.id);
    const ineligible = db.applications.createOrResume({ jobId: 'queue-ineligible' });

    const queue = db.applications.listAutomationQueue();
    assert.equal(queue.find((entry) => entry.applicationId === app.id).eligible, true);
    assert.equal(queue.find((entry) => entry.applicationId === ineligible.id).eligible, false);
    const claimed = db.applications.claimNextAutomation();
    assert.equal(claimed.id, app.id);
    assert.equal(claimed.automationState, 'opening');
    assert.equal(claimed.automationAttempt, 1);
    assert.equal(claimed.automationCheckpoint.stage1Boundary, 'browser_execution_deferred_to_stage_2');
    assert.equal(db.applications.claimNextAutomation(), null);

    db.close();
    const reopened = createDatabase({ userDataPath, seedPath: path.join(userDataPath, 'missing.csv'), applicationDocumentsPath: userDataPath });
    assert.equal(reopened.applications.recoverAutomation(), 1);
    const recovered = reopened.applications.get(app.id);
    assert.equal(recovered.automationState, 'queued');
    assert.equal(recovered.automationCheckpoint.recoveredFrom, 'opening');
    reopened.close();
  } finally {
    try { db.close(); } catch {}
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('document preparation hands a Ready application to the claimable queue', () => {
  const { userDataPath, db } = create();
  try {
    db.jobs.create({ id: 'legacy-ready', company: 'Acme', roleTitle: 'Engineer', url: 'https://jobs.example.test/apply', stage: 'researching' });
    const app = db.applications.createOrResume({ jobId: 'legacy-ready' });
    const resume = db.applications.documents.save({ applicationId: app.id, documentType: 'resume', title: 'Resume', content: { headline: 'Engineer' }, validation: { valid: true, errors: [] }, status: 'approved' });
    const cover = db.applications.documents.save({ applicationId: app.id, documentType: 'cover_letter', title: 'Cover letter', content: { headline: 'Engineer' }, validation: { valid: true, errors: [] }, status: 'approved' });
    db.applications.documents.select(resume.id);
    db.applications.documents.select(cover.id);
    assert.equal(db.applications.get(app.id).automationState, 'queued');
    assert.equal(db.applications.get(app.id).automationCheckpoint.readyHandoff, 'documents_selected');
    assert.equal(db.applications.claimNextAutomation().id, app.id);
  } finally {
    try { db.close(); } catch {}
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('a failed checkpoint can be deliberately returned to the queue for retry', () => {
  const { userDataPath, db } = create();
  try {
    db.jobs.create({ id: 'retry-job', company: 'Acme', roleTitle: 'Engineer', url: 'https://jobs.example.test/apply', stage: 'researching' });
    const app = db.applications.createOrResume({ jobId: 'retry-job' });
    const resume = db.applications.documents.save({ applicationId: app.id, documentType: 'resume', title: 'Resume', content: { headline: 'Engineer' }, validation: { valid: true, errors: [] }, status: 'approved' });
    const cover = db.applications.documents.save({ applicationId: app.id, documentType: 'cover_letter', title: 'Cover letter', content: { headline: 'Engineer' }, validation: { valid: true, errors: [] }, status: 'approved' });
    db.applications.documents.select(resume.id);
    db.applications.documents.select(cover.id);
    db.jobs.create({ id: 'other-retry-job', company: 'Other', roleTitle: 'Engineer', url: 'https://other.example.test/apply', stage: 'researching' });
    const other = db.applications.createOrResume({ jobId: 'other-retry-job' });
    const otherResume = db.applications.documents.save({ applicationId: other.id, documentType: 'resume', title: 'Resume', content: { headline: 'Engineer' }, validation: { valid: true, errors: [] }, status: 'approved' });
    const otherCover = db.applications.documents.save({ applicationId: other.id, documentType: 'cover_letter', title: 'Cover letter', content: { headline: 'Engineer' }, validation: { valid: true, errors: [] }, status: 'approved' });
    db.applications.documents.select(otherResume.id);
    db.applications.documents.select(otherCover.id);
    db.applications.updateAutomationState({ applicationId: app.id, state: 'failed', checkpoint: { failureClass: 'transient', retryable: true } });
    assert.equal(db.applications.listAutomationQueue().find((entry) => entry.applicationId === app.id).automationState, 'failed');
    const retried = db.applications.releaseAutomation({ applicationId: app.id, state: 'queued', checkpoint: { manualRetryAt: '2026-08-23T00:00:00.000Z' } });
    assert.equal(retried.automationState, 'queued');
    assert.equal(db.applications.claimNextAutomation({ applicationId: app.id }).id, app.id);
  } finally {
    try { db.close(); } catch {}
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('legacy safe-pass blockers are normalized into visible review checkpoints', () => {
  const { userDataPath, db } = create();
  try {
    db.jobs.create({ id: 'legacy-blocker-job', company: 'Acme', roleTitle: 'Engineer', url: 'https://jobs.example.test/apply', stage: 'ready' });
    const app = db.applications.createOrResume({ jobId: 'legacy-blocker-job' });
    db.applications.updateAutomationState({ applicationId: app.id, state: 'queued', checkpoint: { reasonCode: 'protected_action' } });
    const entry = db.applications.listAutomationQueue().find((item) => item.applicationId === app.id);
    assert.equal(entry.automationState, 'needs_user_answer');
    assert.equal(entry.pauseReason, 'safe_pass_requires_review');
  } finally {
    try { db.close(); } catch {}
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('an optional cover-letter warning without a question returns to the queue', () => {
  const { userDataPath, db } = create();
  try {
    db.jobs.create({ id: 'optional-cover-job', company: 'Acme', roleTitle: 'Engineer', url: 'https://jobs.example.test/apply', stage: 'ready' });
    const app = db.applications.createOrResume({ jobId: 'optional-cover-job' });
    db.applications.updateAutomationState({ applicationId: app.id, state: 'needs_user_answer', checkpoint: { stage: 'form_review', reasonCode: 'safe_pass_requires_review', lastError: 'Document upload incomplete: cover_letter:missing' } });
    const entry = db.applications.listAutomationQueue().find((item) => item.applicationId === app.id);
    assert.equal(entry.automationState, 'queued');
    assert.equal(entry.pauseReason, 'optional_cover_letter_warning');
    assert.equal(entry.unknownQuestionCount, 0);
  } finally {
    try { db.close(); } catch {}
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('required document failures are retry review, not answer questions', () => {
  const { userDataPath, db } = create();
  try {
    db.jobs.create({ id: 'required-upload-job', company: 'Acme', roleTitle: 'Engineer', url: 'https://jobs.example.test/apply', stage: 'ready' });
    const app = db.applications.createOrResume({ jobId: 'required-upload-job' });
    db.applications.updateAutomationState({ applicationId: app.id, state: 'needs_user_answer', checkpoint: { stage: 'form_review', reasonCode: 'safe_pass_requires_review', lastError: 'Document upload incomplete: resume:missing, cover_letter:missing' } });
    const entry = db.applications.listAutomationQueue().find((item) => item.applicationId === app.id);
    assert.equal(entry.automationState, 'failed');
    assert.equal(entry.pauseReason, 'required_document_upload_failed');
    assert.equal(entry.unknownQuestionCount, 0);
  } finally {
    try { db.close(); } catch {}
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('a verified safe pass with no unresolved fields returns to the queue', () => {
  const { userDataPath, db } = create();
  try {
    db.jobs.create({ id: 'no-question-job', company: 'Acme', roleTitle: 'Engineer', url: 'https://jobs.example.test/apply', stage: 'ready' });
    const app = db.applications.createOrResume({ jobId: 'no-question-job' });
    db.applications.updateAutomationState({ applicationId: app.id, state: 'needs_user_answer', checkpoint: { stage: 'form_review', reasonCode: 'safe_pass_requires_review', unresolvedFields: [], uploadResults: [{ documentType: 'resume', status: 'uploaded' }, { documentType: 'cover_letter', status: 'uploaded' }] } });
    const entry = db.applications.listAutomationQueue().find((item) => item.applicationId === app.id);
    assert.equal(entry.automationState, 'queued');
    assert.equal(entry.pauseReason, 'safe_pass_no_question_retry');
    assert.equal(entry.unknownQuestionCount, 0);
  } finally {
    try { db.close(); } catch {}
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});
