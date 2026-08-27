const assert = require('node:assert/strict');
const test = require('node:test');
const { buildFollowThroughView } = require('../src/followThroughView.mjs');

const roadmap = {
  projects: [{ id: 'p1', title: 'Project A' }],
  releases: [{ id: 'r1', title: 'Release 1' }],
  phases: [{ id: 'ph2', title: 'Follow-through and Accountability' }],
  tasks: [
    { id: 'done', projectId: 'p1', title: 'Done', status: 'done' },
    { id: 'blocked', projectId: 'p1', releaseId: 'r1', phaseId: 'ph2', title: 'Blocked', status: 'blocked', blockedReason: 'Waiting', updatedAt: '2026-08-06' },
    { id: 'overdue', projectId: 'p1', title: 'Overdue', status: 'todo', dueDate: '2026-08-01', updatedAt: '2026-08-06' },
    { id: 'stale', projectId: 'p1', title: 'Stale', status: 'backlog', updatedAt: '2026-07-20', nextAction: 'Review' },
    { id: 'neglected', projectId: 'p1', title: 'Neglected', status: 'backlog', updatedAt: '2026-07-20', nextAction: '' },
    { id: 'normal', projectId: 'p1', title: 'Normal', status: 'todo', updatedAt: '2026-08-06', nextAction: 'Do it' }
  ],
  subtasks: []
};

test('follow-through queue excludes normal, completed, and archived work', () => {
  const view = buildFollowThroughView(roadmap, '2026-08-07');
  const ids = view.items.map((item) => item.id);
  assert.deepEqual(ids, ['blocked', 'overdue', 'neglected', 'stale']);
  assert.ok(!ids.includes('done'));
  assert.ok(!ids.includes('normal'));
});

test('queue includes explainable flags and hierarchy context', () => {
  const view = buildFollowThroughView(roadmap, '2026-08-07');
  const blocked = view.items.find((item) => item.id === 'blocked');
  assert.deepEqual(blocked.reasonKinds, ['blocked']);
  assert.ok(blocked.reasons.includes('blocked: Waiting'));
  assert.equal(blocked.project, 'Project A');
  assert.equal(blocked.release, 'Release 1');
  assert.equal(blocked.phase, 'Follow-through and Accountability');
});

test('queue counts match returned items', () => {
  const view = buildFollowThroughView(roadmap, '2026-08-07');
  assert.equal(view.counts.review, view.items.length);
  assert.equal(view.counts.blocked, view.items.filter((item) => item.blocked).length);
  assert.equal(view.counts.overdue, view.items.filter((item) => item.overdue).length);
  assert.equal(view.counts.stale, view.items.filter((item) => item.stale).length);
  assert.equal(view.counts.neglected, view.items.filter((item) => item.neglected).length);
});

test('empty roadmap returns a truthful empty queue', () => {
  const view = buildFollowThroughView({ tasks: [], subtasks: [] }, '2026-08-07');
  assert.deepEqual(view.counts, { review: 0, blocked: 0, overdue: 0, stale: 0, neglected: 0 });
  assert.deepEqual(view.items, []);
});

test('follow-through derivation does not mutate roadmap state', () => {
  const input = JSON.parse(JSON.stringify(roadmap));
  buildFollowThroughView(input, '2026-08-07');
  assert.deepEqual(input, roadmap);
});