const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

test('background preparation drains Researching before Target and stops on blockers', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(source, /jobs\.find\(\(entry\) => entry\.stage === 'researching'\) \|\| jobs\.find\(\(entry\) => entry\.stage === 'target'\)/);
  assert.match(source, /if \(!coachDatabase \|\| applicationPreparationState\.activeJobId \|\| applicationPreparationState\.paused\) return false;/);
  assert.match(source, /!applicationPreparationState\.blockers\[job\.id\]/);
  assert.match(source, /applicationPreparationState\.retryAt = 0/);
  assert.match(source, /eventType: 'preparation_failed'/);
  assert.match(source, /function syncPreparationActivity\(\)/);
  assert.match(source, /applicationPreparationTimer = null;/);
  assert.match(source, /preparation-start/);
  assert.match(source, /preparation-pause/);
  assert.match(source, /preparation_retry_requested/);
  assert.match(source, /applicationPreparationState\.running/);
  assert.match(source, /ApplicationPreparationPausedError/);
  assert.match(source, /eventType: 'preparation_paused'/);
  assert.match(source, /application_document_\$\{documentType\}_repair_/);
  assert.match(source, /counts: \{ total, completed, failed, remaining/);
  assert.doesNotMatch(source, /setInterval\(\(\) => \{ runApplicationPreparationQueue/);
});
