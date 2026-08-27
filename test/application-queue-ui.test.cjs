const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const jobsView = fs.readFileSync(path.join(root, 'src', 'JobsView.jsx'), 'utf8');
const queueDrawer = fs.readFileSync(path.join(root, 'src', 'jobs', 'ApplicationQueueDrawer.jsx'), 'utf8');
const browserPanel = fs.readFileSync(path.join(root, 'src', 'jobs', 'ApplicationBrowserPanel.jsx'), 'utf8');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');

test('one application queue shell wraps the pipeline and owns lifecycle controls', () => {
  assert.match(jobsView, /className="jobs-pipeline-shell"><ApplicationQueueDrawer/);
  assert.match(queueDrawer, /Prepare all jobs/);
  assert.match(queueDrawer, /<Pause size=\{13\} \/> Pause/);
  assert.doesNotMatch(browserPanel, /ApplicationQueueDrawer/);
  assert.doesNotMatch(queueDrawer, /ready_to_apply/);
});

test('queue rows expose canonical blocker actions and readable diagnostics', () => {
  assert.match(queueDrawer, /waiting_for_answer/);
  assert.match(queueDrawer, /> Answer</);
  assert.match(queueDrawer, /> Retry</);
  assert.match(queueDrawer, /ready_for_review' \? 'Review'/);
  assert.match(queueDrawer, /waiting_for_login' \? 'Login'/);
  assert.match(queueDrawer, /assistant-queue-diagnostics/);
});

test('renderer navigation cannot destroy a browser owned by active durable work', () => {
  assert.match(main, /applicationQueueService\?\.status\(\)\?\.activeApplicationId/);
  assert.match(main, /applicationBrowser\.hide\(\); return \{ preserved: true/);
});
