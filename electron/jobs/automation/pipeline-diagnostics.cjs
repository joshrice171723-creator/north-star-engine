'use strict';

// Pure aggregation over durable queue data so both the operator CLI
// (scripts/diagnose-pipeline.cjs) and the in-app diagnostics channel answer
// questions the same way. No I/O happens here; callers supply runs/items.

function clusterFailures(items = []) {
  const clusters = new Map();
  for (const item of items || []) {
    const checkpoint = item.checkpoint && typeof item.checkpoint === 'object' ? item.checkpoint : {};
    const blocker = item.blocker && typeof item.blocker === 'object' ? item.blocker : {};
    const reasonCode = String(checkpoint.reasonCode || blocker.code || '').trim();
    if (!reasonCode) continue;
    const failureClass = String(checkpoint.failureClass || 'unclassified');
    const key = `${failureClass}:${reasonCode}`;
    const cluster = clusters.get(key) || { key, failureClass, reasonCode, count: 0, companies: [] };
    cluster.count += 1;
    if (item.company && !cluster.companies.includes(item.company)) cluster.companies.push(item.company);
    clusters.set(key, cluster);
  }
  return [...clusters.values()].sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function summarizeRun(run = {}, items = []) {
  const counts = {};
  for (const item of items || []) counts[item.state] = (counts[item.state] || 0) + 1;
  const durationMs = run.startedAt && run.completedAt
    ? Math.max(0, new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime())
    : null;
  return {
    runId: run.id || '',
    mode: run.mode || '',
    status: run.status || '',
    startedAt: run.startedAt || null,
    completedAt: run.completedAt || null,
    durationMs,
    total: (items || []).length,
    counts,
    clusters: clusterFailures(items),
    items: (items || []).map((item) => ({
      applicationId: item.applicationId,
      company: item.company || '',
      roleTitle: item.roleTitle || '',
      state: item.state,
      attempt: Number(item.attempt) || 0,
      maxAttempts: Number(item.maxAttempts) || 0,
      blockerCode: item.blocker?.code || '',
      blockerMessage: item.blocker?.message || '',
      reasonCode: item.checkpoint?.reasonCode || '',
      failureClass: item.checkpoint?.failureClass || '',
      lastError: String(item.lastError || '').slice(0, 500),
      stageTimings: Array.isArray(item.checkpoint?.stageTimings) ? item.checkpoint.stageTimings.slice(-20) : [],
    })),
  };
}

function formatStageTimings(stageTimings = []) {
  if (!Array.isArray(stageTimings) || !stageTimings.length) return '';
  return stageTimings.map((timing) => `${timing.from || '?'}→${timing.to || '?'} ${((Number(timing.durationMs) || 0) / 1000).toFixed(1)}s`).join(', ');
}

function formatReport(summary = {}) {
  const lines = [];
  lines.push(`Run ${summary.runId || '(none)'} [${summary.status || '?'}] ${summary.mode || '?'}`);
  if (summary.startedAt) lines.push(`Started ${summary.startedAt}${summary.completedAt ? ` · completed ${summary.completedAt}` : ' · still open'}${summary.durationMs != null ? ` · ${(summary.durationMs / 60000).toFixed(1)} min` : ''}`);
  const countsText = Object.entries(summary.counts || {}).map(([state, count]) => `${state}:${count}`).join(' ');
  lines.push(`Items: ${summary.total} total${countsText ? ` — ${countsText}` : ''}`);
  if (summary.clusters?.length) {
    lines.push('');
    lines.push('Failure clusters (failureClass:reasonCode × count):');
    summary.clusters.forEach((cluster, index) => {
      lines.push(`  ${index + 1}. ${cluster.key} ×${cluster.count}${cluster.companies.length ? ` — ${cluster.companies.join(', ')}` : ''}`);
    });
  }
  if (summary.items?.length) {
    lines.push('');
    lines.push('Per item:');
    for (const item of summary.items) {
      lines.push(`  [${item.state}] ${item.company || 'Unknown employer'} — ${item.roleTitle || 'Untitled role'} (attempt ${item.attempt}/${item.maxAttempts})`);
      if (item.reasonCode || item.failureClass) lines.push(`      reason ${item.reasonCode || '?'}${item.failureClass ? ` (${item.failureClass})` : ''}${item.blockerCode && item.blockerCode !== item.reasonCode ? ` · blocker ${item.blockerCode}` : ''}`);
      if (item.blockerMessage) lines.push(`      blocker message: ${item.blockerMessage.slice(0, 300)}`);
      if (item.lastError) lines.push(`      last error: ${item.lastError.slice(0, 400)}`);
      const timings = formatStageTimings(item.stageTimings);
      if (timings) lines.push(`      stages: ${timings}`);
    }
  }
  return lines.join('\n');
}

module.exports = { clusterFailures, summarizeRun, formatReport, formatStageTimings };