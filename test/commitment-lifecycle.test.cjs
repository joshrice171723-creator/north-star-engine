const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildCommitmentLifecycle,
  commitmentForTask,
  DEFAULT_STALE_DAYS,
  isInactive
} = require('../src/commitmentLifecycle.mjs');

const roadmapFor = (overrides) => ({
  projects: [
    { id: 'p1', kind: 'project', title: 'Project A' },
    { id: 'p2', kind: 'project', title: 'Project B' }
  ],
  releases: [
    { id: 'r1', kind: 'release', parentId: 'p1', title: 'Release 1: Personal Execution Foundation' },
    { id: 'r9', kind: 'release', parentId: 'p2', title: 'Release Nine' }
  ],
  phases: [
    { id: 'ph2', kind: 'phase', parentId: 'r1', title: 'Follow-through and Accountability' }
  ],
  tasks: [
    // Done work must never surface.
    { id: 'done-1', projectId: 'p1', releaseId: 'r1', phaseId: 'ph2', title: 'Finished task', status: 'done', priority: 'P0', updatedAt: '2026-08-06' },
    // Skipped work must never surface.
    { id: 'skip-1', projectId: 'p1', releaseId: 'r1', phaseId: 'ph2', title: 'Skipped task', status: 'skipped', priority: 'P0', updatedAt: '2026-08-06' },
    // Archived work must never surface.
    { id: 'arch-1', projectId: 'p1', title: 'Archived task', status: 'todo', priority: 'P0', archived: true, updatedAt: '2026-08-06' },
    // Deleted work must never surface.
    { id: 'del-1', projectId: 'p1', title: 'Deleted task', status: 'todo', priority: 'P0', updatedAt: '2026-08-06', deletedAt: '2026-08-07' },
    // Blocked work surfaces with its reason.
    { id: 'blk-1', projectId: 'p1', releaseId: 'r1', phaseId: 'ph2', title: 'Blocked task', status: 'blocked', priority: 'P1', blockedReason: 'Waiting on a decision', nextAction: 'Document the derived contract', updatedAt: '2026-08-04' },
    // In-progress task.
    { id: 'prog-1', projectId: 'p1', title: 'In progress task', status: 'in-progress', priority: 'P1', updatedAt: '2026-08-06' },
    // Stale active backlog task (no next action), 8 days old vs reference.
    { id: 'stale-1', projectId: 'p1', title: 'Stale task', status: 'backlog', priority: 'P2', updatedAt: '2026-07-30' },
    // Stale task that has a next action (not neglected).
    { id: 'stale-na', projectId: 'p1', title: 'Stale with next action', status: 'backlog', priority: 'P2', nextAction: 'Schedule a call', updatedAt: '2026-07-30' },
    // Neglected active task (no next action, no due, not blocked, 8 days old).
    { id: 'neg-1', projectId: 'p1', title: 'Neglected task', status: 'backlog', priority: 'P3', updatedAt: '2026-07-30' },
    // Overdue task with due date in the past.
    { id: 'over-1', projectId: 'p2', title: 'Overdue task', status: 'todo', priority: 'P2', dueDate: '2026-07-01', updatedAt: '2026-08-06' },
    // A subtask must be included as its own grounded item.
    { id: 'sub-1', projectId: 'p1', parentTaskId: 't-p1', releaseId: 'r1', phaseId: 'ph2', title: 'Subtask item', status: 'todo', priority: 'P1', nextAction: 'First thing', updatedAt: '2026-08-06' },
    // Task with no updatedAt has unknown staleness.
    { id: 'created-1', projectId: 'p1', title: 'Created only', status: 'todo', priority: 'P2', createdAt: '2026-08-03' }
  ],
  subtasks: [],
  ...overrides
});

  test('done and skipped tasks are inactive and excluded', () => {
  assert.equal(isInactive({ status: 'done' }), true);
  assert.equal(isInactive({ status: 'skipped' }), true);
  assert.equal(isInactive({ status: 'todo' }), false);
});

test('archived and deleted records are inactive', () => {
  assert.equal(isInactive({ status: 'todo', archived: true }), true);
  assert.equal(isInactive({ status: 'todo', deletedAt: '2026-08-07' }), true);
  assert.equal(isInactive({ status: 'todo' }), false);
});

test('done, skipped, archived, and deleted tasks are excluded from the view', () => {
  const view = buildCommitmentLifecycle(roadmapFor(), '2026-08-07');
  const ids = view.items.map((item) => item.id);
  assert.ok(!ids.includes('done-1'), 'done task must not surface');
  assert.ok(!ids.includes('skip-1'), 'skipped task must not surface');
  assert.ok(!ids.includes('arch-1'), 'archived task must not surface');
  assert.ok(!ids.includes('del-1'), 'deleted task must not surface');
});

test('blocked tasks surface with reason, next action, and context', () => {
  const view = buildCommitmentLifecycle(roadmapFor(), '2026-08-07');
  const blocked = view.items.filter((item) => item.blocked);
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].id, 'blk-1');
  assert.equal(blocked[0].blockedReason, 'Waiting on a decision');
  assert.equal(blocked[0].nextAction, 'Document the derived contract');
  assert.ok(blocked[0].reasons.some((r) => r.startsWith('blocked:')));
});

test('stale threshold is configurable and defaults to 7 days', () => {
  const view = buildCommitmentLifecycle(roadmapFor(), '2026-08-07');
  const stale = view.items.filter((item) => item.stale);
  assert.ok(stale.some((item) => item.id === 'stale-1'));
  assert.equal(view.counts.stale, stale.length);

  // 6 days old is not stale at threshold 7.
  const fresh = buildCommitmentLifecycle(roadmapFor({
    tasks: [{ id: 'fresh-1', projectId: 'p1', title: 'Fresh', status: 'backlog', priority: 'P2', updatedAt: '2026-08-01', nextAction: '' }]
  }), '2026-08-07');
  assert.equal(fresh.items[0].stale, false);

  // Custom threshold of 3 days marks a 6-day-old task as stale.
  const custom = buildCommitmentLifecycle(roadmapFor({
    tasks: [{ id: 'custom-1', projectId: 'p1', title: 'Custom', status: 'backlog', priority: 'P2', updatedAt: '2026-08-01', nextAction: '' }]
  }), '2026-08-07', { staleThresholdDays: 3 });
  assert.equal(custom.items[0].stale, true);
});

test('neglected tasks are active with no next action and not stale-blocked-overdue', () => {
  const view = buildCommitmentLifecycle(roadmapFor(), '2026-08-07');
  const neglected = view.items.filter((item) => item.neglected);
  assert.ok(neglected.some((item) => item.id === 'neg-1'));
  assert.ok(neglected.some((item) => item.id === 'stale-1'));
  assert.ok(!neglected.some((item) => item.id === 'stale-na'));
  assert.ok(!neglected.some((item) => item.id === 'over-1'));
  assert.equal(view.counts.neglected, neglected.length);
});

test('overdue tasks are flagged using the reference date', () => {
  const view = buildCommitmentLifecycle(roadmapFor(), '2026-08-07');
  const overdue = view.items.find((item) => item.id === 'over-1');
  assert.ok(overdue.overdue);
  assert.equal(view.counts.overdue, 1);

  const future = buildCommitmentLifecycle(roadmapFor({
    tasks: [{ id: 't-f', projectId: 'p1', title: 'Future', status: 'todo', dueDate: '2026-12-31', updatedAt: '2026-08-06' }]
  }), '2026-08-07');
  assert.ok(!future.items[0].overdue);
});

test('only in-progress tasks are inProgress', () => {
  const view = buildCommitmentLifecycle(roadmapFor(), '2026-08-07');
  assert.equal(view.items.find((item) => item.id === 'prog-1').inProgress, true);
  assert.equal(view.items.find((item) => item.id === 'blk-1').inProgress, false);
  assert.equal(view.items.find((item) => item.id === 'over-1').inProgress, false);
});

test('subtasks are grounded items with a parent-project context', () => {
  const view = buildCommitmentLifecycle(roadmapFor(), '2026-08-07');
  const subtask = view.items.find((item) => item.id === 'sub-1');
  assert.ok(subtask);
  assert.equal(subtask.title, 'Subtask item');
});

test('stable task identity is preserved', () => {
  const view = buildCommitmentLifecycle(roadmapFor(), '2026-08-07');
  const ids = view.items.map((item) => item.id);
  assert.deepEqual([...new Set(ids)].length, ids.length);
});

test('counts are truthful and consistent with items', () => {
  const view = buildCommitmentLifecycle(roadmapFor(), '2026-08-07');
  assert.equal(view.counts.committed, view.items.length);
  assert.equal(view.counts.blocked, view.items.filter((i) => i.blocked).length);
  assert.equal(view.counts.inProgress, view.items.filter((i) => i.inProgress).length);
  assert.equal(view.counts.overdue, view.items.filter((i) => i.overdue).length);
  assert.equal(view.counts.stale, view.items.filter((i) => i.stale).length);
  assert.equal(view.counts.neglected, view.items.filter((i) => i.neglected).length);
});

test('empty roadmap yields a zero-commitment view with no fabricated data', () => {
  const view = buildCommitmentLifecycle(
    { projects: [], releases: [], phases: [], tasks: [], subtasks: [] },
    '2026-08-07'
  );
  assert.equal(view.items.length, 0);
  assert.deepEqual(view.counts, { committed: 0, blocked: 0, inProgress: 0, overdue: 0, stale: 0, neglected: 0 });
  assert.ok(view.date);
});

test('commitmentForTask returns null for inactive records', () => {
  assert.equal(commitmentForTask({ id: 'd', status: 'done', title: 'x' }, '2026-08-07'), null);
  assert.equal(commitmentForTask({ id: 'a', status: 'todo', archived: true, title: 'x' }, '2026-08-07'), null);
  assert.equal(commitmentForTask(null, '2026-08-07'), null);
});

test('commitmentForTask returns explainable reasons for blocked and overdue', () => {
  const item = commitmentForTask(
    { id: 'b', projectId: 'p1', title: 'Blocked', status: 'blocked', blockedReason: 'Dependency missing', nextAction: 'Check deps', dueDate: '2026-07-01' },
    '2026-08-07'
  );
  assert.ok(item.blocked);
  assert.ok(item.overdue);
  assert.ok(item.reasons.some((r) => r.startsWith('blocked:')));
  assert.ok(item.reasons.some((r) => r.startsWith('overdue:')));
});

test('the input roadmap is never mutated', () => {
  const original = roadmapFor();
  const copy = JSON.parse(JSON.stringify(original));
  buildCommitmentLifecycle(original, '2026-08-07');
  assert.deepEqual(original, copy, 'buildCommitmentLifecycle must not mutate the roadmap');
});

test('DEFAULT_STALE_DAYS is exported as a documented constant', () => {
  assert.equal(DEFAULT_STALE_DAYS, 7);
});

test('missing updatedAt is not treated as stale or neglected', () => {
  const view = buildCommitmentLifecycle({
    tasks: [{ id: 'unknown-age', title: 'Unknown age', status: 'backlog', nextAction: '' }],
    subtasks: []
  }, '2026-08-07');

  assert.equal(view.items[0].stale, false);
  assert.equal(view.items[0].neglected, false);
});


