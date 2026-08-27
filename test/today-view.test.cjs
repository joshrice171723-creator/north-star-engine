const assert = require('node:assert/strict');
const test = require('node:test');
const { buildTodayFocus, buildTodayView } = require('../src/todayView.mjs');

const roadmapFor = (tasks = []) => ({
  projects: [{ id: 'p1', kind: 'project', title: 'Project A' }],
  releases: [{ id: 'r1', kind: 'release', parentId: 'p1', title: 'Release 1' }],
  phases: [{ id: 'ph1', kind: 'phase', parentId: 'r1', title: 'Today’s Focus' }],
  tasks,
  subtasks: []
});

const task = (id, overrides = {}) => ({
  id,
  projectId: 'p1',
  releaseId: 'r1',
  phaseId: 'ph1',
  title: id,
  status: 'todo',
  priority: 'medium',
  ...overrides
});

test('parse and normalize dependency values without changing the roadmap schema', () => {
  const view = buildTodayFocus(roadmapFor([
    task('done', { status: 'done' }),
    task('target', { dependencies: ' done, done\n' })
  ]));
  assert.deepEqual(view.focus.map((item) => item.id), ['target']);
  assert.deepEqual(view.focus[0].dependencyIds, ['done']);
});

test('explicitly blocked tasks never appear in Focus and retain their reason in Waiting', () => {
  const view = buildTodayFocus(roadmapFor([
    task('blocked', { status: 'blocked', blockedReason: 'Waiting for approval' }),
    task('ready')
  ]));
  assert.deepEqual(view.focus.map((item) => item.id), ['ready']);
  assert.equal(view.waiting[0].id, 'blocked');
  assert.match(view.waiting[0].waitingReasons.join(' '), /Waiting for approval/);
  assert.equal(view.counts.blocked, 1);
});

test('a non-blocked task with an unfinished dependency is waiting', () => {
  const view = buildTodayFocus(roadmapFor([
    task('dependency', { title: 'Prepare decision', status: 'todo' }),
    task('target', { dependencies: 'dependency' })
  ]));
  assert.deepEqual(view.focus.map((item) => item.id), ['dependency']);
  assert.equal(view.waiting[0].id, 'target');
  assert.match(view.waiting[0].waitingReasons.join(' '), /Prepare decision/);
});

test('only status done satisfies a dependency', () => {
  for (const status of ['todo', 'backlog', 'in-progress', 'blocked']) {
    const view = buildTodayFocus(roadmapFor([
      task('dependency', { status }),
      task('target', { dependencies: 'dependency' })
    ]));
    assert.ok(view.waiting.some((item) => item.id === 'target'), `${status} must not satisfy dependency`);
  }

  const ready = buildTodayFocus(roadmapFor([
    task('dependency', { status: 'done' }),
    task('target', { dependencies: 'dependency' })
  ]));
  assert.ok(ready.focus.some((item) => item.id === 'target'));
});

test('dependency chains keep downstream work waiting and expose the earliest incomplete step', () => {
  const view = buildTodayFocus(roadmapFor([
    task('first', { title: 'First step', status: 'todo' }),
    task('second', { title: 'Second step', dependencies: 'first' }),
    task('third', { title: 'Third step', dependencies: 'second' })
  ]));
  assert.deepEqual(view.focus.map((item) => item.id), ['first']);
  const third = view.waiting.find((item) => item.id === 'third');
  assert.deepEqual(third.dependencyChain.map((entry) => entry.id), ['second', 'first']);
  assert.match(third.waitingReasons.join(' '), /Second step/);
  assert.match(third.waitingReasons.join(' '), /First step/);
});

test('missing dependency IDs remain waiting with an unresolved explanation', () => {
  const view = buildTodayFocus(roadmapFor([task('target', { dependencies: 'missing-task' })]));
  assert.equal(view.focus.length, 0);
  assert.equal(view.waiting[0].id, 'target');
  assert.match(view.waiting[0].waitingReasons.join(' '), /unresolved dependency missing-task/i);
});

test('Focus selection orders in-progress, todo, backlog, priority, due date, title, and ID', () => {
  const view = buildTodayFocus(roadmapFor([
    task('backlog-high', { status: 'backlog', priority: 'P0' }),
    task('todo-low', { status: 'todo', priority: 'low' }),
    task('todo-high', { status: 'todo', priority: 'high' }),
    task('progress', { status: 'in-progress', priority: 'low' }),
    task('todo-due', { status: 'todo', priority: 'high', dueDate: '2026-08-01' })
  ]));
  assert.deepEqual(view.focus.map((item) => item.id), ['progress', 'todo-due', 'todo-high']);
  assert.equal(view.focus[0].focusRole, 'Start here');
  assert.equal(view.focus[1].focusRole, 'After that');
  assert.equal(view.focus[2].focusRole, 'Optional');
  assert.match(view.focus[0].selectionReason, /Already in progress/);
});

test('Focus is capped at three items while all ready work remains derivable', () => {
  const view = buildTodayFocus(roadmapFor(['a', 'b', 'c', 'd'].map((id) => task(id))));
  assert.equal(view.focus.length, 3);
  assert.equal(view.ready.length, 4);
  assert.equal(view.counts.ready, 4);
});

test('done, archived, deleted, and untitled records do not surface', () => {
  const view = buildTodayFocus(roadmapFor([
    task('done', { status: 'done' }),
    task('archived', { archived: true }),
    task('deleted', { deletedAt: '2026-08-08T00:00:00.000Z' }),
    task('untitled', { title: '' }),
    task('ready')
  ]));
  assert.deepEqual(view.focus.map((item) => item.id), ['ready']);
  assert.equal(view.waiting.length, 0);
});

test('selected items include truthful reasons and hierarchy context', () => {
  const view = buildTodayFocus(roadmapFor([task('ready', { priority: 'P1', dueDate: '2026-08-01' })]), '2026-08-08');
  const item = view.focus[0];
  assert.equal(item.project, 'Project A');
  assert.equal(item.release, 'Release 1');
  assert.equal(item.phase, 'Today’s Focus');
  assert.ok(item.overdue);
  assert.match(item.selectionReasons.join(' '), /high priority/i);
  assert.match(item.selectionReasons.join(' '), /overdue/i);
});

test('the derivation and compatibility view do not mutate roadmap data', () => {
  const roadmap = roadmapFor([
    task('dependency', { status: 'todo' }),
    task('target', { dependencies: ['dependency'] })
  ]);
  const before = structuredClone(roadmap);
  const view = buildTodayFocus(roadmap);
  const compatibility = buildTodayView(roadmap);
  assert.deepEqual(roadmap, before);
  assert.deepEqual(compatibility.items, compatibility.focus);
  assert.deepEqual(view.focus.map((item) => item.id), ['dependency']);
});

test('empty roadmap yields truthful empty Focus and Waiting collections', () => {
  const view = buildTodayFocus(roadmapFor());
  assert.equal(view.focus.length, 0);
  assert.equal(view.ready.length, 0);
  assert.equal(view.waiting.length, 0);
  assert.deepEqual(view.counts, { ready: 0, focus: 0, waiting: 0, blocked: 0, dependencyWaiting: 0, overdue: 0 });
});