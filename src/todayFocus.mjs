// Deterministic Today’s Focus and Waiting derivation.
//
// This module is a pure, read-only boundary over the canonical roadmap. It
// never creates, duplicates, or mutates task state. Dependency readiness is
// determined here, before any UI or coach can consume the result.

const STATUS_ORDER = { 'in-progress': 0, todo: 1, backlog: 2 };
const STATUS_LABEL = {
  backlog: 'Backlog',
  todo: 'To do',
  'in-progress': 'In progress',
  blocked: 'Blocked',
  done: 'Done'
};
const PRIORITY_WEIGHT = {
  urgent: 0, P0: 0,
  high: 1, P1: 1,
  medium: 2, P2: 2, P3: 2,
  low: 3, P4: 3
};
const HIGH_PRIORITIES = new Set(['urgent', 'high', 'P0', 'P1']);
const READY_STATUSES = new Set(Object.keys(STATUS_ORDER));

const todayString = () => new Date().toISOString().slice(0, 10);

function normalizeId(value) {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

// Roadmap dependency values are text so this accepts the formats already used
// by seed/import data without requiring a schema change: arrays, JSON arrays,
// comma-separated IDs, or newline-separated IDs.
export function parseDependencies(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap((entry) => parseDependencies(entry)))];
  }
  if (value === null || value === undefined) return [];
  const text = String(value).trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parseDependencies(parsed);
  } catch {
    // Plain text dependency lists are expected and handled below.
  }
  return [...new Set(text.split(/[\s,;]+/).map(normalizeId).filter(Boolean))];
}

function labelFor(records, id) {
  if (!id) return null;
  const entry = records.find((record) => normalizeId(record?.id) === id);
  return entry?.title || entry?.name || null;
}

function contextFor(task, roadmap) {
  return {
    project: labelFor(roadmap.projects, normalizeId(task.projectId)),
    release: labelFor(roadmap.releases, normalizeId(task.releaseId)),
    phase: labelFor(roadmap.phases, normalizeId(task.phaseId))
  };
}

function allRoadmapTasks(roadmap) {
  const records = [
    ...(Array.isArray(roadmap?.tasks) ? roadmap.tasks : []),
    ...(Array.isArray(roadmap?.subtasks) ? roadmap.subtasks : [])
  ];
  const byId = new Map();
  for (const record of records) {
    const id = normalizeId(record?.id);
    // The database guarantees unique IDs. Keeping the first record makes a
    // malformed imported snapshot deterministic without inventing a duplicate.
    if (id && !byId.has(id)) byId.set(id, record);
  }
  return [...byId.entries()];
}

function isExcluded(record) {
  return !record || record.archived === true || Boolean(record.deletedAt) || String(record.status || '').toLowerCase() === 'done';
}

function priorityWeight(priority) {
  return typeof PRIORITY_WEIGHT[priority] === 'number' ? PRIORITY_WEIGHT[priority] : 2;
}

function statusLabel(status) {
  return STATUS_LABEL[status] || status || 'Backlog';
}

function priorityLabel(priority) {
  const value = String(priority || '').toUpperCase();
  if (value === 'URGENT') return 'Urgent';
  if (value === 'P0') return 'P0';
  if (value === 'P1') return 'High';
  if (value === 'P2' || value === 'P3') return 'Medium';
  if (value === 'P4') return 'Low';
  if (['HIGH', 'MEDIUM', 'LOW'].includes(value)) return value.charAt(0) + value.slice(1).toLowerCase();
  return 'Medium';
}

function compareReady(a, b) {
  return STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    || priorityWeight(a.priority) - priorityWeight(b.priority)
    || (a.dueDate || '9999-99-99').localeCompare(b.dueDate || '9999-99-99')
    || a.title.localeCompare(b.title)
    || a.id.localeCompare(b.id);
}

function dependencyChain(id, byId, dependenciesById, seen = new Set()) {
  if (!id || seen.has(id)) return [];
  const record = byId.get(id);
  if (!record || String(record.status || '').toLowerCase() === 'done') return [];
  const nextSeen = new Set(seen).add(id);
  const dependencies = dependenciesById.get(id) || [];
  const chain = [];
  for (const dependencyId of dependencies) {
    const dependency = byId.get(dependencyId);
    if (!dependency) {
      chain.push({ id: dependencyId, title: null, status: 'unresolved', unresolved: true });
      continue;
    }
    const status = String(dependency.status || 'backlog').toLowerCase();
    if (status !== 'done') {
      chain.push({ id: dependencyId, title: dependency.title || null, status, unresolved: false });
      chain.push(...dependencyChain(dependencyId, byId, dependenciesById, nextSeen));
    }
  }
  return chain.filter((entry, index, entries) => entries.findIndex((candidate) => candidate.id === entry.id) === index);
}

function dependencyExplanation(entry) {
  if (entry.unresolved) return `Waiting on unresolved dependency ${entry.id}.`;
  return `Waiting on “${entry.title || entry.id}” (${entry.id}), status ${statusLabel(entry.status)}.`;
}

function deriveReason(record, item, dependentsById) {
  const reasons = [];
  if (item.status === 'in-progress') reasons.push('Already in progress.');
  if (HIGH_PRIORITIES.has(item.priority)) reasons.push('Ready and high priority.');
  if (item.overdue) reasons.push('Overdue and ready to start.');
  if ((dependentsById.get(item.id) || []).length) reasons.push('Unblocks downstream work.');
  if (!reasons.length) reasons.push('Ready to start now.');
  return reasons;
}

function toItem(record, id, roadmap, today, dependencyIds, dependencyChainEntries) {
  const status = String(record.status || 'backlog').toLowerCase();
  const blockedReason = String(record.blockedReason || '').trim();
  const dueDate = record.dueDate || null;
  const context = contextFor(record, roadmap);
  return {
    id,
    title: String(record.title || '').trim(),
    status,
    statusLabel: statusLabel(status),
    priority: record.priority || 'medium',
    priorityLabel: priorityLabel(record.priority),
    dueDate,
    overdue: Boolean(dueDate && dueDate < today),
    blocked: status === 'blocked' || Boolean(blockedReason),
    blockedReason,
    nextAction: record.nextAction || '',
    project: context.project,
    release: context.release,
    phase: context.phase,
    dependencyIds,
    dependencyChain: dependencyChainEntries,
    waitingReasons: [],
    selectionReasons: [],
    selectionReason: '',
    sortPriority: priorityWeight(record.priority),
    sortStatus: typeof STATUS_ORDER[status] === 'number' ? STATUS_ORDER[status] : 3
  };
}

export function buildTodayFocus(roadmap, referenceDateString, options = {}) {
  const today = referenceDateString || todayString();
  const limit = Number.isInteger(options.limit) && options.limit >= 0 ? options.limit : 3;
  const projects = Array.isArray(roadmap?.projects) ? roadmap.projects : [];
  const releases = Array.isArray(roadmap?.releases) ? roadmap.releases : [];
  const phases = Array.isArray(roadmap?.phases) ? roadmap.phases : [];
  const normalizedRoadmap = { projects, releases, phases };
  const entries = allRoadmapTasks(roadmap);
  const byId = new Map(entries);
  const dependenciesById = new Map(entries.map(([id, record]) => [id, parseDependencies(record?.dependencies)]));
  const dependentsById = new Map();
  for (const [taskId, dependencyIds] of dependenciesById) {
    for (const dependencyId of dependencyIds) {
      const dependents = dependentsById.get(dependencyId) || [];
      dependents.push(taskId);
      dependentsById.set(dependencyId, dependents);
    }
  }

  const ready = [];
  const waiting = [];
  for (const [id, record] of entries) {
    const title = String(record?.title || record?.name || '').trim();
    if (!title || isExcluded(record)) continue;
    const dependencyIds = dependenciesById.get(id) || [];
    const chain = dependencyChain(id, byId, dependenciesById);
    const item = toItem({ ...record, title }, id, normalizedRoadmap, today, dependencyIds, chain);

    if (item.blocked) {
      item.waitingReasons.push(item.status === 'blocked'
        ? (item.blockedReason ? `Explicitly blocked: ${item.blockedReason}` : 'Explicitly blocked.')
        : `Waiting: ${item.blockedReason}`);
    }
    if (chain.length) item.waitingReasons.push(...chain.map(dependencyExplanation));
    if (item.status !== 'blocked' && !READY_STATUSES.has(item.status)) item.waitingReasons.push(`Waiting: status “${item.status || 'unknown'}” is not ready to start.`);

    if (item.waitingReasons.length) {
      waiting.push(item);
    } else {
      item.selectionReasons = deriveReason(record, item, dependentsById);
      item.selectionReason = item.selectionReasons[0];
      ready.push(item);
    }
  }

  ready.sort(compareReady);
  waiting.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const focus = ready.slice(0, limit).map((item, index) => ({
    ...item,
    focusRole: index === 0 ? 'Start here' : index === 1 ? 'After that' : 'Optional'
  }));

  return {
    date: today,
    focus,
    ready,
    waiting,
    counts: {
      ready: ready.length,
      focus: focus.length,
      waiting: waiting.length,
      blocked: waiting.filter((item) => item.blocked).length,
      dependencyWaiting: waiting.filter((item) => item.dependencyChain.length > 0).length,
      overdue: focus.filter((item) => item.overdue).length
    }
  };
}
