const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDatabase } = require('../electron/database.cjs');

function create() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'north-star-files-'));
  return { root, db: createDatabase({ userDataPath: root, applicationDocumentsPath: path.join(root, 'Documents'), seedPath: path.join(root, 'missing.csv') }) };
}
function saveResume(db, applicationId, id, version, sourcePath) {
  return db.applications.documents.save({ applicationId, id, documentType: 'resume', version, title: `Resume ${version}`, content: { headline: `Candidate ${version}` }, validation: { valid: true, errors: [] }, status: 'approved', exportedPdfPath: sourcePath });
}

test('opportunities have isolated selected files and replacing one preserves its prior version', () => {
  const { root, db } = create();
  try {
    db.jobs.create({ id: 'job-a', company: 'Same: Company', roleTitle: 'Engineer/AI' });
    db.jobs.create({ id: 'job-b', company: 'Same: Company', roleTitle: 'Engineer/AI' });
    const appA = db.applications.createOrResume({ jobId: 'job-a' });
    const appB = db.applications.createOrResume({ jobId: 'job-b' });
    assert.notEqual(appA.applicationFolderPath, appB.applicationFolderPath);
    assert.ok(fs.existsSync(path.join(appA.applicationFolderPath, 'Versions', 'Resumes')));
    const source1 = path.join(root, 'resume-1.pdf'); const source2 = path.join(root, 'resume-2.pdf');
    fs.writeFileSync(source1, 'version one'); fs.writeFileSync(source2, 'version two');
    const first = saveResume(db, appA.id, 'resume-a-1', 1, source1); db.applications.documents.select(first.id);
    assert.equal(fs.readFileSync(appA.selectedResumePath, 'utf8'), 'version one');
    const second = saveResume(db, appA.id, 'resume-a-2', 2, source2); db.applications.documents.select(second.id);
    assert.equal(fs.readFileSync(appA.selectedResumePath, 'utf8'), 'version two');
    assert.equal(fs.readFileSync(path.join(appA.applicationFolderPath, 'Versions', 'Resumes', 'Resume-v1.pdf'), 'utf8'), 'version one');
    assert.equal(db.applications.resolveFile(appB.id, 'resume').exists, false);
    db.close();
    const reopened = createDatabase({ userDataPath: root, applicationDocumentsPath: path.join(root, 'Documents'), seedPath: path.join(root, 'missing.csv') });
    assert.equal(reopened.applications.get(appA.id).selectedResumePath, appA.selectedResumePath);
    assert.equal(reopened.applications.resolveFile(appA.id, 'resume').path, appA.selectedResumePath);
    reopened.close();
  } finally { try { db.close(); } catch {} fs.rmSync(root, { recursive: true, force: true }); }
});

test('legacy persisted paths are relocated to the workspace application root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'north-star-migrate-')); const legacyRoot = path.join(root, 'Legacy Documents'); const workspaceRoot = path.join(root, 'Workspace');
  let db = createDatabase({ userDataPath: root, applicationDocumentsPath: legacyRoot, seedPath: path.join(root, 'missing.csv') });
  try {
    db.jobs.create({ id: 'legacy-job', company: 'OneStream', roleTitle: 'Engineer' }); const app = db.applications.createOrResume({ jobId: 'legacy-job' }); fs.writeFileSync(app.selectedResumePath, 'legacy selected resume'); db.close();
    db = createDatabase({ userDataPath: root, applicationDocumentsPath: workspaceRoot, seedPath: path.join(root, 'missing.csv') }); const migrated = db.applications.get(app.id);
    assert.equal(migrated.applicationFolderPath.startsWith(workspaceRoot), true); assert.equal(fs.readFileSync(migrated.selectedResumePath, 'utf8'), 'legacy selected resume');
  } finally { try { db.close(); } catch {} fs.rmSync(root, { recursive: true, force: true }); }
});
