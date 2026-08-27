const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createDatabase } = require('../electron/database.cjs');

test('saving an archived search match restores its existing pipeline stage', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aicc-job-archive-'));
  const db = createDatabase({ userDataPath, seedPath: path.join(userDataPath, 'missing.csv') });
  try {
    db.jobs.create({ id: 'dice-archived-match', company: 'Acme', roleTitle: 'AI Engineer', stage: 'ready' });
    db.jobs.delete('dice-archived-match');

    const restored = db.jobs.create({ id: 'dice-archived-match', company: 'Acme', roleTitle: 'AI Engineer', stage: 'target' });

    assert.equal(restored.stage, 'ready');
    assert.equal(db.jobs.list().find((job) => job.id === 'dice-archived-match')?.stage, 'ready');
  } finally {
    db.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});
