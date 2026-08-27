const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createDatabase } = require('../electron/database.cjs');
const { matchActivationEmails } = require('../electron/jobs/application-activation.cjs');

test('Stage 3 source contract keeps account passwords out of renderer and persists safe activation metadata', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const browser = fs.readFileSync(path.join(__dirname, '..', 'electron', 'jobs', 'application-browser.cjs'), 'utf8');
  assert.match(main, /credentialReference\(host, username\)/);
  assert.match(main, /jobs:applications:activation:check/);
  assert.doesNotMatch(main, /password: credential\?\.password/);
  assert.match(browser, /const activate = async/);
  assert.match(browser, /activation_control_ambiguous/);
  assert.doesNotMatch(browser, /requestSubmit\(|(?:document|form)\.submit\(/);
  assert.match(main, /autonomousApplicationQueueState\.activeApplicationId === applicationId && autonomousSafeFormPass/);
  const panel = fs.readFileSync(path.join(__dirname, '..', 'src', 'jobs', 'ApplicationBrowserPanel.jsx'), 'utf8');
  assert.match(panel, /setInterval\(\(\) => \{ checkActivation\(\)\.catch/);
});

test('account reuse and activation checkpoint survive a database restart without raw activation payloads', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aicc-stage3-'));
  try {
    const first = createDatabase({ userDataPath, seedPath: path.join(userDataPath, 'missing.csv') });
    first.jobs.create({ id: 'stage3-job', company: 'Fixture Employer', roleTitle: 'Engineer', url: 'https://fixture-employer.test/apply' });
    const application = first.applications.createOrResume({ jobId: 'stage3-job' });
    const account = first.applications.saveExternalAccount({ applicationId: application.id, host: 'fixture-employer.test', username: 'joshua@example.com', credentialRef: 'external-fixture', status: 'activation_required' });
    assert.equal(account.status, 'activation_required');
    assert.equal(first.applications.findExternalAccountByIdentity({ host: 'FIXTURE-EMPLOYER.TEST', username: 'JOSHUA@EXAMPLE.COM' }).credentialRef, 'external-fixture');
    const candidate = matchActivationEmails([{ id: 'activation-mail', externalId: 'activation-mail', subject: 'Activate your account', sender: 'no-reply@fixture-employer.test', recipients: 'joshua@example.com', receivedAt: '2026-08-23T12:00:00.000Z', body: 'https://fixture-employer.test/activate?token=never-store-this' }], { host: account.host, recipient: account.username });
    const attempt = first.applications.recordActivationAttempt({ id: `activation-${application.id}`, applicationId: application.id, host: account.host, recipient: account.username, status: 'used', messageId: candidate.messageId, activationUrlRedacted: candidate.activationUrlRedacted, codeHash: candidate.codeHash, signals: candidate.signals });
    assert.equal(attempt.status, 'used');
    assert.equal(attempt.activationUrlRedacted, 'https://fixture-employer.test/activate');
    assert.equal(Object.hasOwn(attempt, 'code'), false);
    first.close();
    const reopened = createDatabase({ userDataPath, seedPath: path.join(userDataPath, 'missing.csv') });
    assert.equal(reopened.applications.getExternalAccount(application.id).credentialRef, 'external-fixture');
    assert.equal(reopened.applications.getActivationAttempt(application.id).activationUrlRedacted, 'https://fixture-employer.test/activate');
    assert.equal(reopened.applications.getActivationAttempt(application.id).status, 'used');
    reopened.close();
  } finally { fs.rmSync(userDataPath, { recursive: true, force: true }); }
});
