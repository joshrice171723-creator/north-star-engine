const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDatabase } = require('../electron/database.cjs');
const { normalizePhoneNumber, extractPhoneNumber, extractGoogleVoiceItemNumber } = require('../electron/google-voice.cjs');

const create = () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aicc-google-voice-'));
  return { userDataPath, db: createDatabase({ userDataPath, seedPath: path.join(userDataPath, 'missing.csv') }) };
};

test('phone numbers normalize across Google Voice display formats', () => {
  assert.equal(normalizePhoneNumber('+1 (214) 555-0199'), '2145550199');
  assert.equal(normalizePhoneNumber('214-555-0199'), '2145550199');
  assert.equal(extractPhoneNumber('(580) 204-4040'), '5802044040');
  assert.equal(extractPhoneNumber('New message from +1 (214) 555-0199'), '2145550199');
  assert.equal(extractGoogleVoiceItemNumber('https://voice.google.com/u/0/messages?itemId=t.%2B15802044040'), '5802044040');
});

test('assigned Google Voice activity updates one job and deduplicates polling', () => {
  const { userDataPath, db } = create();
  try {
    db.jobs.create({ id: 'voice-job', company: 'Acme', roleTitle: 'Engineer', contactName: 'Jordan Lee' });
    const assigned = db.jobs.activity.assignGoogleVoiceConversation('voice-job', { phoneNumber: '+1 214 555 0199', title: 'Hiring manager', content: 'I assigned this conversation.' });
    assert.equal(assigned.metadata.phoneNumber, '2145550199');
    assert.equal(assigned.metadata.contactName, 'Jordan Lee');
    const first = db.jobs.activity.ingestGoogleVoiceActivity({ phoneNumber: '(214) 555-0199', title: 'New message', content: 'Can we talk tomorrow?', activityType: 'message' });
    assert.equal(first.matched, true);
    assert.equal(first.activities.length, 1);
    assert.equal(first.activities[0].metadata.contactName, 'Jordan Lee');
    const second = db.jobs.activity.ingestGoogleVoiceActivity({ phoneNumber: '+1 214 555 0199', title: 'New message', content: 'Can we talk tomorrow?', activityType: 'message' });
    assert.equal(second.duplicate, true);
    assert.equal(db.jobs.activity.list('voice-job').filter((item) => item.activityType === 'google_voice_conversation').length, 2);
    const email = db.email.upsert({ provider: 'gmail', externalId: 'voice-job-email', from: 'recruiter@example.com', subject: 'Next steps', isJobRelated: true });
    db.email.link({ emailId: email.id, jobId: 'voice-job' });
    assert.deepEqual({
      voice: db.jobs.list().find((job) => job.id === 'voice-job').unreadVoiceActivityCount,
      email: db.jobs.list().find((job) => job.id === 'voice-job').unreadEmailCount,
    }, { voice: 1, email: 1 });
    db.jobs.activity.markSeen('voice-job');
    db.email.markJobSeen('voice-job');
    assert.deepEqual({
      voice: db.jobs.list().find((job) => job.id === 'voice-job').unreadVoiceActivityCount,
      email: db.jobs.list().find((job) => job.id === 'voice-job').unreadEmailCount,
    }, { voice: 0, email: 0 });
    assert.equal(db.jobs.list().find((job) => job.id === 'voice-job').updatedAt > assigned.createdAt, true);
  } finally {
    db.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('shared phone numbers are left unmatched for safety', () => {
  const { userDataPath, db } = create();
  try {
    db.jobs.create({ id: 'voice-job-a', company: 'Acme', roleTitle: 'Engineer' });
    db.jobs.create({ id: 'voice-job-b', company: 'Beta', roleTitle: 'Designer' });
    db.jobs.activity.assignGoogleVoiceConversation('voice-job-a', { phoneNumber: '2145550199', content: 'First assignment.' });
    db.jobs.activity.assignGoogleVoiceConversation('voice-job-b', { phoneNumber: '2145550199', content: 'Second assignment.' });
    const result = db.jobs.activity.ingestGoogleVoiceActivity({ phoneNumber: '2145550199', content: 'Shared number message.' });
    assert.equal(result.reason, 'ambiguous_phone');
    assert.equal(result.activities.length, 0);
  } finally {
    db.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});
