const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('submission approval is snapshot-bound and delayed Gmail sync reconciles evidence', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /submissionReviewSnapshot\(applicationId\)/);
  assert.match(main, /createHash\('sha256'\)/);
  assert.match(main, /current\.fingerprint !== authorization\.fingerprint/);
  assert.match(main, /Persist intent before the irreversible click/);
  assert.match(main, /reasonCode: 'submission_outcome_uncertain'/);
  assert.match(main, /reconcilePendingSubmissionEvidence\(\)/);
  assert.match(main, /scheduleSubmissionEmailVerification\(applicationId\)/);
  assert.match(main, /browserState: 'confirmed'/);
  assert.doesNotMatch(main, /completeSubmission\(\{ applicationId: app\.id, browserState: 'confirmed'/);
});
