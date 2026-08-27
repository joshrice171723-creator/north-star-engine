const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { createDatabase } = require('../electron/database.cjs');

test('an email moves to one selected pipeline job', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aicc-email-link-'));
  const db = createDatabase({ userDataPath, seedPath: path.join(userDataPath, 'missing.csv') });
  try {
    db.jobs.create({ id: 'first-job', company: 'Acme', roleTitle: 'Engineer' });
    db.jobs.create({ id: 'second-job', company: 'Globex', roleTitle: 'Designer' });
    const email = db.email.upsert({ provider: 'gmail', externalId: 'message-1', subject: 'Interview' });
    db.email.link({ emailId: email.id, jobId: 'first-job' });
    assert.deepEqual(db.email.link({ emailId: email.id, jobId: 'second-job' }).linkedJobIds, ['second-job']);
  } finally { db.close(); fs.rmSync(userDataPath, { recursive: true, force: true }); }
});

test('a user-excluded email stays hidden after sync updates and can be restored', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aicc-email-exclusion-'));
  const db = createDatabase({ userDataPath, seedPath: path.join(userDataPath, 'missing.csv') });
  try {
    const email = db.email.upsert({ provider: 'gmail', externalId: 'message-2', subject: 'Interview follow-up', body: 'Interview details' });
    db.email.setExcluded({ emailId: email.id, excluded: true });
    db.email.upsert({ provider: 'gmail', externalId: 'message-2', subject: 'Updated interview follow-up', body: 'Updated details', isJobRelated: true });
    assert.equal(db.email.list({ jobOnly: true }).some((entry) => entry.id === email.id), false);
    assert.equal(db.email.search('updated details').some((entry) => entry.emailId === email.id), false);
    assert.equal(db.email.list({ jobOnly: true, includeExcluded: true }).find((entry) => entry.id === email.id).isExcluded, true);
    assert.equal(db.email.setExcluded({ emailId: email.id, excluded: false }).isExcluded, false);
    assert.equal(db.email.list({ jobOnly: true }).some((entry) => entry.id === email.id), true);
  } finally { db.close(); fs.rmSync(userDataPath, { recursive: true, force: true }); }
});

test('sender controls preserve seen state, group identity, and blocking across sync updates', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aicc-email-sender-controls-'));
  const db = createDatabase({ userDataPath, seedPath: path.join(userDataPath, 'missing.csv') });
  try {
    const first = db.email.upsert({ provider: 'gmail', externalId: 'message-3', subject: 'First', from: 'Recruiting <recruiter@example.com>', isJobRelated: true });
    const second = db.email.upsert({ provider: 'gmail', externalId: 'message-4', subject: 'Second', from: 'recruiter@example.com', isJobRelated: true });
    assert.equal(first.senderKey, 'recruiter@example.com');
    assert.equal(second.isSeen, false);
    assert.equal(db.email.markSeen({ emailId: first.id }).isSeen, true);
    assert.equal(db.email.upsert({ provider: 'gmail', externalId: 'message-3', subject: 'Updated', from: 'Recruiting <recruiter@example.com>', isJobRelated: true }).isSeen, true);
    db.email.blockSender({ sender: 'Recruiting <recruiter@example.com>' });
    assert.equal(db.email.list({ jobOnly: true }).some((entry) => entry.senderKey === 'recruiter@example.com'), false);
    assert.equal(db.email.list({ jobOnly: true, includeBlocked: true }).every((entry) => entry.isExcluded), true);
    assert.equal(db.email.upsert({ provider: 'gmail', externalId: 'message-3', subject: 'Updated again', from: 'recruiter@example.com', isJobRelated: true }).isExcluded, true);
    db.email.unblockSender({ senderKey: 'recruiter@example.com' });
    assert.equal(db.email.list({ jobOnly: true }).length, 0);
    assert.equal(db.email.list({ jobOnly: true, includeExcluded: true }).length, 2);
  } finally { db.close(); fs.rmSync(userDataPath, { recursive: true, force: true }); }
});
