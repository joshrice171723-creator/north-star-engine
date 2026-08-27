'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { clusterFailures, summarizeRun, formatReport, formatStageTimings } = require('../electron/jobs/automation/pipeline-diagnostics.cjs');

const item = (overrides = {}) => ({
  applicationId: 'application-1',
  company: 'Acme',
  roleTitle: 'Engineer',
  state: 'blocked',
  attempt: 4,
  maxAttempts: 3,
  checkpoint: { reasonCode: 'application_flow_timeout', failureClass: 'network', stageTimings: [{ from: 'opening', to: 'detecting_flow', durationMs: 1500 }] },
  blocker: { code: 'retry_attempts_exhausted', message: 'Could not safely complete.' },
  lastError: 'The employer page did not respond.',
  ...overrides,
});

test('summarizeRun counts states and maps failure metadata per item', () => {
  const run = { id: 'run-1', mode: 'entire_pipeline', status: 'completed', startedAt: '2026-08-25T19:42:40.000Z', completedAt: '2026-08-25T21:00:14.000Z' };
  const summary = summarizeRun(run, [item(), item({ state: 'applied', company: 'Beta' })]);
  assert.equal(summary.runId, 'run-1');
  assert.equal(summary.total, 2);
  assert.deepEqual(summary.counts, { blocked: 1, applied: 1 });
  assert.equal(summary.durationMs, new Date(run.completedAt) - new Date(run.startedAt));
  const first = summary.items[0];
  assert.equal(first.reasonCode, 'application_flow_timeout');
  assert.equal(first.failureClass, 'network');
  assert.equal(first.blockerCode, 'retry_attempts_exhausted');
  assert.equal(first.attempt, 4);
  assert.equal(first.maxAttempts, 3);
  assert.deepEqual(first.stageTimings, [{ from: 'opening', to: 'detecting_flow', durationMs: 1500 }]);
});

test('clusterFailures groups by failureClass and reasonCode and ranks by count', () => {
  const clusters = clusterFailures([
    item(),
    item({ applicationId: 'a2', company: 'Nous' }),
    item({ applicationId: 'a3', company: 'Glean' }),
    item({ applicationId: 'a4', company: 'Databricks', checkpoint: { reasonCode: 'document_upload_repair_failed', failureClass: 'provider_changed' }, blocker: { code: 'document_upload_repair_failed', message: '' }, lastError: '' }),
    item({ applicationId: 'a5', company: 'Zendesk', checkpoint: {}, blocker: { code: 'next_control_not_found', message: '' }, lastError: '' }),
  ]);
  assert.equal(clusters.length, 3);
  assert.deepEqual(clusters[0], { key: 'network:application_flow_timeout', failureClass: 'network', reasonCode: 'application_flow_timeout', count: 3, companies: ['Acme', 'Nous', 'Glean'] });
  assert.equal(clusters[1].key, 'provider_changed:document_upload_repair_failed');
  // A blocker code is used when the checkpoint carries no reason code.
  assert.equal(clusters[2].reasonCode, 'next_control_not_found');
  assert.equal(clusterFailures([item({ checkpoint: {}, blocker: {} })]).length, 0);
});

test('formatReport renders a readable post-mortem', () => {
  const report = formatReport(summarizeRun({ id: 'run-9', mode: 'entire_pipeline', status: 'blocked', startedAt: '2026-08-25T19:00:00.000Z' }, [item()]));
  assert.match(report, /Run run-9 \[blocked\] entire_pipeline/);
  assert.match(report, /Items: 1 total — blocked:1/);
  assert.match(report, /\[blocked\] Acme — Engineer \(attempt 4\/3\)/);
  assert.match(report, /reason application_flow_timeout \(network\)/);
  assert.match(report, /last error: The employer page did not respond\./);
  assert.match(report, /stages: opening→detecting_flow 1\.5s/);
});

test('formatStageTimings tolerates missing or empty data', () => {
  assert.equal(formatStageTimings([]), '');
  assert.equal(formatStageTimings(null), '');
  assert.match(formatStageTimings([{ from: '', to: 'applied', durationMs: undefined }]), /\?→applied 0\.0s/);
});