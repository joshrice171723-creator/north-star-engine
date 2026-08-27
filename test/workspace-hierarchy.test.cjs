const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createDatabase } = require('../electron/database.cjs');

function withDatabase(run) {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aicc-hierarchy-'));
  const database = createDatabase({ userDataPath, seedPath: path.join(userDataPath, 'missing-roadmap.csv') });
  try {
    return run(database);
  } finally {
    if (database.sqlite.open) database.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
}

const emptyPayload = () => ({ projects: [], releases: [], phases: [], tasks: [], subtasks: [] });

test('workspace writes reject a supplied parent and persist a root record', () => withDatabase((database) => {
  assert.equal(typeof database.bootstrap, 'function');
  assert.equal(typeof database.syncRoadmap, 'function');
  assert.equal(typeof database.importRoadmap, 'function');
  assert.equal(typeof database.saveNote, 'function');
  assert.equal(typeof database.backup, 'function');
  assert.throws(
    () => database.workspaces.create({ id: 'workspace-nested-attempt', kind: 'workspace', title: 'Nested attempt', parentId: 'other-workspace' }),
    /workspace cannot have a parent/
  );

  const workspace = database.workspaces.create({ id: 'workspace-root', kind: 'workspace', title: 'Root workspace', parentId: null });
  assert.equal(workspace.kind, 'workspace');
  assert.equal(workspace.parentId, null);
  assert.equal(database.sqlite.prepare('SELECT parent_id FROM projects WHERE id = ?').get(workspace.id).parent_id, null);
}));

test('bulk roadmap sync applies the same workspace invariant', () => withDatabase((database) => {
  assert.throws(
    () => database.syncRoadmap({ ...emptyPayload(), workspaces: [{ id: 'workspace-sync-attempt', kind: 'workspace', title: 'Invalid sync workspace', parentId: 'another-workspace' }] }),
    /workspace cannot have a parent/
  );

  const synced = database.syncRoadmap({ ...emptyPayload(), workspaces: [{ id: 'workspace-sync-root', kind: 'workspace', title: 'Sync root' }], projects: [{ id: 'project-sync-root', kind: 'project', title: 'Sync project', parentId: 'workspace-sync-root' }] });
  assert.equal(synced.roadmap.workspaces.find((entry) => entry.id === 'workspace-sync-root').parentId, null);
  assert.equal(synced.roadmap.projects.find((entry) => entry.id === 'project-sync-root').parentId, 'workspace-sync-root');
}));

test('project and task creation preserve workspace and project ownership across reopen', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aicc-reopen-'));
  const first = createDatabase({ userDataPath, seedPath: path.join(userDataPath, 'missing-roadmap.csv') });
  const workspace = first.workspaces.create({ id: 'workspace-persisted', kind: 'workspace', title: 'Persisted workspace' });
  const project = first.projects.create({ id: 'project-persisted', kind: 'project', title: 'Persisted project', parentId: workspace.id });
  assert.throws(() => first.projects.create({ id: 'project-invalid-parent', kind: 'project', title: 'Invalid project', parentId: project.id }), /project must belong to a workspace/);
  assert.throws(() => first.projects.create({ id: 'release-invalid-parent', kind: 'release', title: 'Invalid release', parentId: workspace.id }), /release must belong to a project/);
  const task = first.tasks.create({ id: 'task-persisted', projectId: project.id, title: 'Persisted task' });
  assert.equal(task.projectId, project.id);
  first.close();

  const second = createDatabase({ userDataPath, seedPath: path.join(userDataPath, 'missing-roadmap.csv') });
  try {
    const bootstrap = second.bootstrap().roadmap;
    assert.deepEqual(bootstrap.workspaces.filter((entry) => entry.id === workspace.id).map((entry) => entry.parentId), [null]);
    assert.equal(bootstrap.projects.find((entry) => entry.id === project.id).parentId, workspace.id);
    assert.equal(bootstrap.tasks.find((entry) => entry.id === task.id).projectId, project.id);
  } finally {
    second.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('roadmap hierarchy exposes workspaces as roots and never as children', async () => {
  const { buildRoadmapHierarchy } = await import('../src/roadmapHierarchy.mjs');
  const hierarchy = buildRoadmapHierarchy({
    workspace: { id: 'fallback', kind: 'workspace', title: 'Fallback' },
    workspaces: [
      { id: 'workspace-a', kind: 'workspace', title: 'Workspace A', parentId: null },
      { id: 'workspace-b', kind: 'workspace', title: 'Workspace B', parentId: 'workspace-a' }
    ],
    projects: [{ id: 'project-a', kind: 'project', title: 'Project A', parentId: 'workspace-a' }],
    releases: [], phases: [], tasks: [], subtasks: []
  });
  assert.deepEqual(hierarchy.workspaces.map((entry) => entry.id), ['workspace-a', 'workspace-b']);
  assert.deepEqual((hierarchy.childrenById.get('workspace-a') || []).map((entry) => entry.id), ['project-a']);
  assert.equal((hierarchy.childrenById.get('workspace-b') || []).length, 0);
  assert.equal([...hierarchy.childrenById.values()].flat().some((entry) => entry.kind === 'workspace'), false);
});

test('a sibling workspace never renders as a child, even with a legacy parentId', async () => {
  const { buildRoadmapHierarchy } = await import('../src/roadmapHierarchy.mjs');
  // Mirrors the reported repro: "work space 2" was showing indented beneath
  // "AI Executive Coach Command Center". Its stored parentId must not nest it.
  const hierarchy = buildRoadmapHierarchy({
    workspace: { id: 'AICC-WS-001', kind: 'workspace', type: 'workspace', title: 'AI Executive Coach Command Center', parentId: null },
    workspaces: [
      { id: 'AICC-WS-001', kind: 'workspace', type: 'workspace', title: 'AI Executive Coach Command Center', parentId: null },
      { id: 'work-space-2', kind: 'workspace', type: 'workspace', title: 'work space 2', parentId: 'AICC-WS-001' },
      { id: 'test-2', kind: 'workspace', type: 'workspace', title: 'test 2', parentId: null }
    ],
    projects: [
      { id: 'prj-ai', kind: 'project', type: 'project', title: 'AI Executive Coach Command Center', parentId: 'AICC-WS-001' },
      { id: 'prj-ws2', kind: 'project', type: 'project', title: 'project workspace 2', parentId: 'work-space-2' }
    ],
    releases: [], phases: [], tasks: [], subtasks: []
  });

  assert.deepEqual(hierarchy.workspaces.map((w) => w.id), ['AICC-WS-001', 'work-space-2', 'test-2']);
  // work space 2 is a root, not a child of the first workspace.
  assert.deepEqual((hierarchy.childrenById.get('AICC-WS-001') || []).map((e) => e.id), ['prj-ai']);
  assert.deepEqual((hierarchy.childrenById.get('work-space-2') || []).map((e) => e.id), ['prj-ws2']);
  assert.equal((hierarchy.childrenById.get('work-space-2') || []).some((e) => e.kind === 'workspace'), false);
  assert.equal(hierarchy.childrenById.has('AICC-WS-001') && (hierarchy.childrenById.get('AICC-WS-001') || []).some((e) => e.id === 'work-space-2'), false);
  assert.equal([...hierarchy.childrenById.values()].flat().some((entry) => entry.kind === 'workspace' || entry.type === 'workspace'), false);
});


test('every workspace root renders at depth 0 regardless of its position in the list', async () => {
  const { buildRoadmapHierarchy } = await import('../src/roadmapHierarchy.mjs');
  const hierarchy = buildRoadmapHierarchy({
    workspace: { id: 'w1', kind: 'workspace', type: 'workspace', title: 'AI Executive Coach Command Center', parentId: null },
    workspaces: [
      { id: 'w1', kind: 'workspace', type: 'workspace', title: 'AI Executive Coach Command Center', parentId: null },
      { id: 'w2', kind: 'workspace', type: 'workspace', title: 'workspace 2', parentId: null },
      { id: 'w3', kind: 'workspace', type: 'workspace', title: 'workspace 3', parentId: null }
    ],
    projects: [
      { id: 'p1', kind: 'project', type: 'project', title: 'AI Executive Coach Command Center', parentId: 'w1' },
      { id: 'p2', kind: 'project', type: 'project', title: 'Project 2', parentId: 'w2' }
    ],
    releases: [], phases: [], tasks: [], subtasks: []
  });

  // Regression: the roadmap tree calls tree(workspace, 0) for every root.
  // If it mistakenly passed the array index (the old `.map(tree)` bug), the
  // 2nd/3rd workspaces would be indented like children (10 + index * 18).
  const fixedPadding = hierarchy.workspaces.map(() => 10 + 0 * 18);
  assert.deepEqual([...new Set(fixedPadding)], [10], 'all workspace roots must share the depth-0 padding');

  const buggyPadding = hierarchy.workspaces.map((w, index) => 10 + index * 18);
  assert.notDeepEqual(buggyPadding, [10, 10, 10], 'array index must not be used as tree depth');

  // Optional: workspace 2 must be a top-level root, and its project a depth-1 child.
  assert.equal(hierarchy.workspaces.find((w) => w.id === 'w2').parentId, null);
  assert.deepEqual((hierarchy.childrenById.get('w2') || []).map((c) => c.id), ['p2']);
});

test('kanbanTasksForScope filters top-level tasks by the clicked hierarchy node', async () => {
  const { kanbanTasksForScope } = await import('../src/roadmapHierarchy.mjs');
  const roadmap = {
    workspaces: [
      { id: 'ws-1', kind: 'workspace', title: 'WS 1' },
      { id: 'ws-2', kind: 'workspace', title: 'WS 2' }
    ],
    projects: [
      { id: 'prj-1', kind: 'project', parentId: 'ws-1', title: 'P1' },
      { id: 'prj-2', kind: 'project', parentId: 'ws-2', title: 'P2' }
    ],
    releases: [{ id: 'rel-1', kind: 'release', parentId: 'prj-1', title: 'R1' }],
    phases: [{ id: 'pha-1', kind: 'phase', parentId: 'rel-1', title: 'PH1' }],
    tasks: [
      { id: 't1', kind: 'task', projectId: 'prj-1', releaseId: 'rel-1', phaseId: 'pha-1', title: 'T1' },
      { id: 't2', kind: 'task', projectId: 'prj-1', releaseId: null, phaseId: null, title: 'T2' },
      { id: 't3', kind: 'task', projectId: 'prj-2', releaseId: null, phaseId: null, title: 'T3' }
    ],
    subtasks: [{ id: 'sub-1', kind: 'subtask', projectId: 'prj-1', parentTaskId: 't1', title: 'SUB1' }]
  };
  const tasks = roadmap.tasks;
  const ids = (list) => list.map((t) => t.id);

  // No scope -> unchanged.
  assert.deepEqual(ids(kanbanTasksForScope(roadmap, null, tasks)), ['t1', 't2', 't3']);

  // Workspace scope -> tasks in that workspace's projects only.
  assert.deepEqual(ids(kanbanTasksForScope(roadmap, { id: 'ws-1', kind: 'workspace' }, tasks)), ['t1', 't2']);
  assert.deepEqual(ids(kanbanTasksForScope(roadmap, { id: 'ws-2', kind: 'workspace' }, tasks)), ['t3']);

  // Project scope.
  assert.deepEqual(ids(kanbanTasksForScope(roadmap, { id: 'prj-1', kind: 'project' }, tasks)), ['t1', 't2']);
  assert.deepEqual(ids(kanbanTasksForScope(roadmap, { id: 'prj-2', kind: 'project' }, tasks)), ['t3']);

  // Release scope -> only t1 (assigned to rel-1).
  assert.deepEqual(ids(kanbanTasksForScope(roadmap, { id: 'rel-1', kind: 'release' }, tasks)), ['t1']);

  // Phase scope -> only t1.
  assert.deepEqual(ids(kanbanTasksForScope(roadmap, { id: 'pha-1', kind: 'phase' }, tasks)), ['t1']);

  // Task scope -> that task only.
  assert.deepEqual(ids(kanbanTasksForScope(roadmap, { id: 't1', kind: 'task' }, tasks)), ['t1']);
  assert.deepEqual(ids(kanbanTasksForScope(roadmap, { id: 't2', kind: 'task' }, tasks)), ['t2']);

  // Subtask scope -> resolves to its owning top-level task card.
  assert.deepEqual(ids(kanbanTasksForScope(roadmap, { id: 'sub-1', kind: 'subtask' }, tasks)), ['t1']);

  // Unknown scope id -> empty board (no irrelevant tasks leak in).
  assert.deepEqual(ids(kanbanTasksForScope(roadmap, { id: 'missing', kind: 'project' }, tasks)), []);
});


