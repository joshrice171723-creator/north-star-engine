const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createDatabase } = require('../electron/database.cjs');
const { applicationExportDirectory } = require('../electron/jobs/application-export.cjs');

const create = () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aicc-job-stage-'));
  return { userDataPath, db: createDatabase({ userDataPath, seedPath: path.join(userDataPath, 'missing.csv') }) };
};

test('Ready to apply can move back to Researching', () => {
  const { userDataPath, db } = create();
  try {
    db.jobs.create({ id: 'ready-job', company: 'Acme', roleTitle: 'Engineer', stage: 'ready' });
    const updated = db.jobs.create({ id: 'ready-job', company: 'Acme', roleTitle: 'Engineer', stage: 'researching' });
    assert.equal(updated.stage, 'researching');
  } finally {
    db.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('Applied cannot move back to Researching', () => {
  const { userDataPath, db } = create();
  try {
    db.jobs.create({ id: 'applied-job', company: 'Acme', roleTitle: 'Engineer', stage: 'applied' });
    assert.throws(
      () => db.jobs.create({ id: 'applied-job', company: 'Acme', roleTitle: 'Engineer', stage: 'researching' }),
      /A job cannot move backward from applied\./
    );
  } finally {
    db.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('selecting a master resume never exports its internal label as the heading', () => {
  const { userDataPath, db } = create();
  try {
    db.resumes.upsertMaster({ rawText: 'Joshua Rice\nSenior Software Engineer' });
    db.jobs.create({ id: 'master-resume-job', company: 'Acme', roleTitle: 'Engineer' });
    const application = db.applications.createOrResume({ jobId: 'master-resume-job' });
    const selected = db.applications.documents.selectMasterResume(application.id);

    assert.equal(selected.content.headline, 'Joshua Rice');
    assert.doesNotMatch(selected.plainText, /^master resume$/im);
  } finally {
    db.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('selecting an older master resume repairs the same version', () => {
  const { userDataPath, db } = create();
  try {
    const resume = db.resumes.upsertMaster({ rawText: 'Joshua Rice\nSenior Software Engineer' });
    db.jobs.create({ id: 'existing-master-job', company: 'Acme', roleTitle: 'Engineer' });
    const application = db.applications.createOrResume({ jobId: 'existing-master-job' });
    const original = db.applications.documents.save({ applicationId: application.id, documentType: 'resume', title: 'Master resume', content: { headline: 'Master resume', summary: [{ text: resume.rawText }] }, validation: { valid: true, errors: [] }, status: 'approved', modelName: 'master_resume', sourceResumeVersion: resume.version });
    const repaired = db.applications.documents.selectMasterResume(application.id);

    assert.equal(repaired.id, original.id);
    assert.equal(repaired.version, original.version);
    assert.equal(repaired.content.headline, 'Joshua Rice');
    assert.equal(repaired.exportedPdfPath, '');
  } finally {
    db.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('using a PDF master resume copies the source bytes into the application folder', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aicc-master-copy-'));
  const db = createDatabase({ userDataPath, applicationDocumentsPath: path.join(userDataPath, 'Documents'), masterResumeSourcePath: path.join(userDataPath, 'master-resume.pdf'), seedPath: path.join(userDataPath, 'missing.csv') });
  try {
    const sourcePath = path.join(userDataPath, 'master-resume.pdf');
    const sourceBytes = Buffer.from('%PDF-master-source-bytes');
    fs.writeFileSync(sourcePath, sourceBytes);
    db.resumes.upsertMaster({ rawText: 'Joshua Rice\nSenior Software Engineer', sourceType: 'pdf' });
    db.jobs.create({ id: 'master-copy-job', company: 'Acme', roleTitle: 'Engineer' });
    const application = db.applications.createOrResume({ jobId: 'master-copy-job' });
    const selected = db.applications.documents.selectMasterResume(application.id);

    assert.deepEqual(fs.readFileSync(db.applications.get(application.id).selectedResumePath), sourceBytes);
    assert.equal(selected.content.headline, 'Joshua Rice');
  } finally {
    try { db.close(); } catch {}
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('resetting application documents removes versions but preserves the master resume', () => {
  const { userDataPath, db } = create();
  try {
    db.resumes.upsertMaster({ rawText: 'Joshua Rice\nSenior Software Engineer', sourceFilename: 'resume.pdf', sourceType: 'pdf' });
    db.jobs.create({ id: 'reset-job', company: 'Acme', roleTitle: 'Engineer' });
    const application = db.applications.createOrResume({ jobId: 'reset-job' });
    fs.writeFileSync(path.join(application.applicationFolderPath, 'Resume - v1.pdf'), 'legacy-version');
    const legacyFolder = applicationExportDirectory(userDataPath, { company: 'Acme', roleTitle: 'Engineer' }, 'reset-job');
    fs.mkdirSync(legacyFolder, { recursive: true });
    fs.writeFileSync(path.join(legacyFolder, 'Cover Letter - v1.pdf'), 'legacy-job-version');
    db.applications.documents.selectMasterResume(application.id);
    db.applications.documents.save({ applicationId: application.id, documentType: 'cover_letter', title: 'Cover letter', content: { headline: 'Hello' }, validation: { valid: true, errors: [] }, status: 'draft' });

    const result = db.applications.resetDocuments(application.id);

    assert.equal(result.documentsRemoved, 2);
    assert.deepEqual(db.applications.documents.list(application.id), []);
    assert.equal(db.resumes.getMaster().sourceFilename, 'resume.pdf');
    assert.equal(fs.existsSync(path.join(application.applicationFolderPath, 'Resume - v1.pdf')), false);
    assert.equal(fs.existsSync(path.join(legacyFolder, 'Cover Letter - v1.pdf')), false);
  } finally {
    db.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});
