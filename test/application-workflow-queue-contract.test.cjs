const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('legacy application and preparation channels use the durable workflow owner', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8');
  assert.match(main, /createApplicationQueueService\(\{ repository: coachDatabase\.applications\.queue, worker: processDurableApplicationQueueItem \}\)/);
  assert.match(main, /automation-queue:start'[\s\S]{0,180}startDurableApplicationQueue\(input\)/);
  assert.match(main, /preparation-start'[\s\S]{0,1200}startDurableApplicationQueue/);
  assert.match(main, /selectAdapter\(\{ url: liveBrowser\?\.currentUrl \|\| claimed\.url, enableProviderAdapters: true \}\)/);
  assert.doesNotMatch(main, /stepKey: 'dice-handoff'.*atsKey: 'dice'/);
  assert.match(main, /for \(let page = 0; page < 12; page \+= 1\)/);
  assert.match(main, /state: 'creating_account'/);
  assert.doesNotMatch(main, /durableProgress: \(progress\) => control\.update/, 'the durable queue stops at Ready to apply and never streams browser progress');
  assert.match(main, /filter\(\(job\) => \['target', 'researching'\]\.includes\(job\.stage\)\)/);
  assert.match(main, /reportDurableProgress\('uploading_documents'/);
  assert.match(main, /reportDurableProgress\('ready_for_review'/);
  assert.match(main, /withApplicationTimeout\(applicationWorkflowOrchestrator\.runApplicationCheckpoint/);
  assert.match(main, /const flowDeadline = Date\.now\(\) \+ 45000/);
  assert.match(preload, /getApplicationWorkflowQueueStatus/);
  assert.match(preload, /startApplicationWorkflowQueue/);
  assert.match(preload, /listApplicationWorkflowEvidence/);
  assert.match(main, /workflow-queue:retry'[\s\S]{0,160}applicationQueueService\.retry/);
  assert.match(main, /workflow-queue:evidence'[\s\S]{0,180}listSubmissionEvidence/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'JobsView.jsx'), 'utf8'), /retryApplicationWorkflowQueueItem\?\.\(\{ applicationId: entry\.applicationId \}\)/);
});
