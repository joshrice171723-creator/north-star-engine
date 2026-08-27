const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('autopilot owns queue progression and records final-submit intent before clicking', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const browser = fs.readFileSync(path.join(__dirname, '..', 'electron', 'jobs', 'application-browser.cjs'), 'utf8');
  const jobs = fs.readFileSync(path.join(__dirname, '..', 'src', 'JobsView.jsx'), 'utf8');
  assert.match(main, /autopilot: false/);
  assert.match(main, /scheduleAutopilotNext/);
  assert.match(main, /autopilotSubmission: \{ idempotencyKey/);
  assert.match(main, /confirmation\.state === 'confirmed' \? 'verifying_email_confirmation' : 'verifying_confirmation'/);
  assert.match(main, /attempt < 30/);
  assert.match(main, /attempt < 24/);
  assert.match(main, /replaySavedAutopilotLogin/);
  assert.match(browser, /const fillSavedCredentials = async/);
  assert.match(browser, /Credentials are passed from Electron main directly/);
  assert.match(jobs, /startApplicationWorkflowQueue\?\.\(\{ mode: 'entire_pipeline' \}\)/);
  assert.match(jobs, /<ApplicationQueueDrawer status=\{workflowQueueStatus\}/);
  assert.doesNotMatch(jobs, /startJobApplicationAutomationQueue\?\.\(\{ autopilot: true \}\)/);
  assert.doesNotMatch(jobs, /const assistantOpened = queuedJob/);
});
