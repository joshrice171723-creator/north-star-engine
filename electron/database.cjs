const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const BetterSqlite3 = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const { eq, isNull, and, asc, desc } = require('drizzle-orm');
const { sqliteTable, text, integer, index, uniqueIndex } = require('drizzle-orm/sqlite-core');
  const { assertTransition, computeApplicationReadiness, validateAnswer } = require('./jobs/application-domain.cjs');
const { assertAutonomousApplicationState } = require('./jobs/application-automation.cjs');
const { DOCUMENT_TYPES, STATUSES, renderPlainText, renderHtml } = require('./jobs/application-documents.cjs');
const { chunkText, searchChunks, stableEmailId, extractApplicationConfirmation } = require('./job-email-rag.cjs');
const { normalizePhoneNumber, activityFingerprint } = require('./google-voice.cjs');
const { ensureApplicationFileStructure, applicationExportDirectory, applicationFilePaths } = require('./jobs/application-export.cjs');
const { matchSubmissionConfirmation } = require('./jobs/application-confirmation-email.cjs');
const { sanitizeTraceValue } = require('./jobs/automation/trace-store.cjs');
const { selectAdapter } = require('./jobs/adapters/index.cjs');
const { createApplicationQueueRepository } = require('./jobs/application-queue-repository.cjs');

const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  parentId: text('parent_id'),
  kind: text('kind').notNull().default('project'),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  status: text('status').notNull().default('backlog'),
  priority: text('priority').notNull().default('P1'),
  orderIndex: integer('order_index').notNull().default(0),
  dueDate: text('due_date'),
  nextAction: text('next_action').notNull().default(''),
  definitionOfDone: text('definition_of_done').notNull().default(''),
  blockedReason: text('blocked_reason').notNull().default(''),
  dependencies: text('dependencies').notNull().default(''),
  acceptanceCriteria: text('acceptance_criteria').notNull().default(''),
  securityPrivacyNotes: text('security_privacy_notes').notNull().default(''),
  sourceContext: text('source_context').notNull().default(''),
  confidence: text('confidence').notNull().default(''),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
}, (table) => ({ parentIdx: index('projects_parent_idx').on(table.parentId), statusIdx: index('projects_status_idx').on(table.status), activeIdx: index('projects_active_idx').on(table.archived, table.deletedAt) }));

const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  parentTaskId: text('parent_task_id'),
  releaseId: text('release_id'),
  phaseId: text('phase_id'),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  status: text('status').notNull().default('backlog'),
  priority: text('priority').notNull().default('P1'),
  orderIndex: integer('order_index').notNull().default(0),
  dueDate: text('due_date'),
  nextAction: text('next_action').notNull().default(''),
  definitionOfDone: text('definition_of_done').notNull().default(''),
  blockedReason: text('blocked_reason').notNull().default(''),
  dependencies: text('dependencies').notNull().default(''),
  acceptanceCriteria: text('acceptance_criteria').notNull().default(''),
  securityPrivacyNotes: text('security_privacy_notes').notNull().default(''),
  sourceContext: text('source_context').notNull().default(''),
  confidence: text('confidence').notNull().default(''),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
}, (table) => ({ projectIdx: index('tasks_project_idx').on(table.projectId), statusIdx: index('tasks_status_idx').on(table.status), dueIdx: index('tasks_due_idx').on(table.dueDate), hierarchyIdx: index('tasks_hierarchy_idx').on(table.releaseId, table.phaseId, table.parentTaskId), activeIdx: index('tasks_active_idx').on(table.archived, table.deletedAt) }));

const userSettings = sqliteTable('user_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});
const goals = sqliteTable('goals', {
  id: text('id').primaryKey(), title: text('title').notNull(), description: text('description').notNull().default(''), status: text('status').notNull().default('active'), orderIndex: integer('order_index').notNull().default(0), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(), deletedAt: text('deleted_at'),
}, (table) => ({ statusIdx: index('goals_status_idx').on(table.status), activeIdx: index('goals_active_idx').on(table.deletedAt) }));
const checkIns = sqliteTable('check_ins', {
  id: text('id').primaryKey(), checkInDate: text('check_in_date').notNull(), energy: integer('energy'), mood: text('mood'), reflection: text('reflection').notNull().default(''), wins: text('wins').notNull().default(''), blockers: text('blockers').notNull().default(''), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(), deletedAt: text('deleted_at'),
}, (table) => ({ dateIdx: index('check_ins_date_idx').on(table.checkInDate), activeIdx: index('check_ins_active_idx').on(table.deletedAt) }));
const notes = sqliteTable('notes', {
  id: text('id').primaryKey(), title: text('title').notNull().default(''), content: text('content').notNull().default(''), entityType: text('entity_type'), entityId: text('entity_id'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(), deletedAt: text('deleted_at'),
}, (table) => ({ entityIdx: index('notes_entity_idx').on(table.entityType, table.entityId), activeIdx: index('notes_active_idx').on(table.deletedAt) }));
const briefings = sqliteTable('briefings', {
  id: text('id').primaryKey(), briefingDate: text('briefing_date').notNull(), briefingType: text('briefing_type').notNull().default('daily'), title: text('title').notNull().default(''), content: text('content').notNull().default(''), source: text('source').notNull().default(''), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(), deletedAt: text('deleted_at'),
}, (table) => ({ dateIdx: index('briefings_date_idx').on(table.briefingDate), activeIdx: index('briefings_active_idx').on(table.deletedAt) }));
const integrationsMetadata = sqliteTable('integrations_metadata', {
  id: text('id').primaryKey(), provider: text('provider').notNull(), status: text('status').notNull().default('disconnected'), accountLabel: text('account_label').notNull().default(''), metadataJson: text('metadata_json').notNull().default('{}'), lastSyncAt: text('last_sync_at'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(), deletedAt: text('deleted_at'),
}, (table) => ({ providerIdx: uniqueIndex('integrations_provider_idx').on(table.provider), statusIdx: index('integrations_status_idx').on(table.status) }));
const calendarEvents = sqliteTable('calendar_events', {
  id: text('id').primaryKey(), provider: text('provider').notNull().default('local'), externalId: text('external_id'), title: text('title').notNull(), description: text('description').notNull().default(''), startsAt: text('starts_at').notNull(), endsAt: text('ends_at').notNull(), location: text('location').notNull().default(''), allDay: integer('all_day', { mode: 'boolean' }).notNull().default(false), metadataJson: text('metadata_json').notNull().default('{}'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(), deletedAt: text('deleted_at'),
}, (table) => ({ timeIdx: index('calendar_events_time_idx').on(table.startsAt, table.endsAt), providerIdx: index('calendar_events_provider_idx').on(table.provider, table.externalId), activeIdx: index('calendar_events_active_idx').on(table.deletedAt) }));
const jobOpportunities = sqliteTable('job_opportunities', {
  id: text('id').primaryKey(), company: text('company').notNull(), roleTitle: text('role_title').notNull(), url: text('url').notNull().default(''), location: text('location').notNull().default(''), employmentType: text('employment_type').notNull().default(''), salaryRange: text('salary_range').notNull().default(''), source: text('source').notNull().default(''), stage: text('stage').notNull().default('target'), priority: text('priority').notNull().default('medium'), nextAction: text('next_action').notNull().default(''), followUpDate: text('follow_up_date'), contactName: text('contact_name').notNull().default(''), contactEmail: text('contact_email').notNull().default(''), notes: text('notes').notNull().default(''), appliedAt: text('applied_at'), externalId: text('external_id'), apiSource: text('api_source'), canonicalUrl: text('canonical_url').notNull().default(''), rawDataJson: text('raw_data_json').notNull().default('{}'), description: text('description').notNull().default(''), requirementsJson: text('requirements_json').notNull().default('[]'), postedAt: text('posted_at'), expiresAt: text('expires_at'), salaryMin: integer('salary_min'), salaryMax: integer('salary_max'), salaryCurrency: text('salary_currency').notNull().default('USD'), remoteType: text('remote_type').notNull().default('unknown'), matchScore: integer('match_score'), requirementsMatchScore: integer('requirements_match_score'), candidateMatchScore: integer('candidate_match_score'), fitTier: text('fit_tier'), matchSummary: text('match_summary').notNull().default(''), lastEvaluatedAt: text('last_evaluated_at'), lastSeenAt: text('last_seen_at'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(), archived: integer('archived', { mode: 'boolean' }).notNull().default(false), deletedAt: text('deleted_at'),
}, (table) => ({ stageIdx: index('jobs_stage_idx').on(table.stage), followUpIdx: index('jobs_follow_up_idx').on(table.followUpDate), activeIdx: index('jobs_active_idx').on(table.archived, table.deletedAt) }));
const jobApplications = sqliteTable('job_applications', { id: text('id').primaryKey(), jobId: text('job_id').notNull(), status: text('status').notNull(), applicationUrl: text('application_url').notNull(), externalApplicationUrl: text('external_application_url').notNull(), externalApplicationHost: text('external_application_host').notNull(), atsKey: text('ats_key').notNull(), readinessJson: text('readiness_json').notNull(), unresolvedCount: integer('unresolved_count').notNull(), startedAt: text('started_at').notNull(), lastActivityAt: text('last_activity_at').notNull(), submittedAt: text('submitted_at'), confirmationNumber: text('confirmation_number').notNull(), confirmationUrl: text('confirmation_url').notNull(), withdrawnAt: text('withdrawn_at'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(), deletedAt: text('deleted_at') });
const jobApplicationAnswers = sqliteTable('job_application_answers', { id: text('id').primaryKey(), applicationId: text('application_id'), questionKey: text('question_key').notNull(), questionText: text('question_text').notNull(), normalizedCategory: text('normalized_category').notNull(), answerText: text('answer_text').notNull(), answerJson: text('answer_json').notNull(), scope: text('scope').notNull(), sensitivity: text('sensitivity').notNull(), approvalStatus: text('approval_status').notNull(), autofillPolicy: text('autofill_policy').notNull(), provenanceJson: text('provenance_json').notNull(), approvedAt: text('approved_at'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(), deletedAt: text('deleted_at') });
const jobApplicationEvents = sqliteTable('job_application_events', { id: text('id').primaryKey(), applicationId: text('application_id').notNull(), eventType: text('event_type').notNull(), summary: text('summary').notNull(), metadataJson: text('metadata_json').notNull(), createdAt: text('created_at').notNull() });
const jobApplicationDocuments = sqliteTable('job_application_documents', { id: text('id').primaryKey(), applicationId: text('application_id').notNull(), documentType: text('document_type').notNull(), version: integer('version').notNull(), status: text('status').notNull(), title: text('title').notNull(), contentJson: text('content_json').notNull(), plainText: text('plain_text').notNull(), htmlText: text('html_text').notNull(), provenanceJson: text('provenance_json').notNull(), validationJson: text('validation_json').notNull(), sourceResumeVersion: integer('source_resume_version'), modelName: text('model_name').notNull(), promptVersion: text('prompt_version').notNull(), isSelected: integer('is_selected').notNull(), exportedPdfPath: text('exported_pdf_path').notNull(), exportedTextPath: text('exported_text_path').notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(), deletedAt: text('deleted_at') });
const jobApplicationExternalAccounts = sqliteTable('job_application_external_accounts', { id: text('id').primaryKey(), applicationId: text('application_id').notNull(), host: text('host').notNull(), username: text('username').notNull(), credentialRef: text('credential_ref').notNull(), status: text('status').notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull() });
const jobApplicationUnknownQuestions = sqliteTable('job_application_unknown_questions', { id: text('id').primaryKey(), applicationId: text('application_id').notNull(), jobId: text('job_id').notNull(), providerHost: text('provider_host').notNull(), pageFingerprint: text('page_fingerprint').notNull(), controlLabel: text('control_label').notNull(), controlType: text('control_type').notNull(), questionKey: text('question_key').notNull(), questionText: text('question_text').notNull(), optionsJson: text('options_json').notNull(), status: text('status').notNull(), answerId: text('answer_id'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(), resolvedAt: text('resolved_at') });

const tableMap = { projects, tasks, goals, checkIns, notes, briefings, integrationsMetadata, calendarEvents, jobOpportunities, jobApplications, jobApplicationAnswers, jobApplicationEvents, jobApplicationDocuments, jobApplicationExternalAccounts, jobApplicationUnknownQuestions };
const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const nonEmpty = (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const bounded = (value, max = 10000) => String(value ?? '').slice(0, max);
const normalizeEmailSender = (value) => {
  const text = String(value || '').trim().toLowerCase();
  const address = text.match(/<([^>]+)>/)?.[1] || text;
  return address.replace(/^mailto:/, '').trim();
};

function parseCsv(textValue) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < textValue.length; i += 1) {
    const char = textValue[i];
    if (quoted) {
      if (char === '"' && textValue[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  const headers = rows.shift() || [];
  return rows.filter((entry) => entry.some(Boolean)).map((entry) => Object.fromEntries(headers.map((header, index) => [header, entry[index] || ''])));
}

function createDatabase({ userDataPath, seedPath, applicationDocumentsPath, masterResumeSourcePath, careerOnly = false } = {}) {
  if (!userDataPath) throw new Error('A user-data path is required.');
  fs.mkdirSync(userDataPath, { recursive: true });
  const databasePath = path.join(userDataPath, 'executive-coach.sqlite');
  const sqlite = new BetterSqlite3(databasePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite);
  const migrationDir = path.join(__dirname, careerOnly ? 'migrations-north-star' : 'migrations');
  const documentsRoot = applicationDocumentsPath || userDataPath;
  sqlite.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(sqlite.prepare('SELECT id FROM schema_migrations').all().map((entry) => entry.id));
  for (const filename of fs.readdirSync(migrationDir).filter((entry) => entry.endsWith('.sql')).sort()) {
    if (applied.has(filename)) continue;
    sqlite.exec(fs.readFileSync(path.join(migrationDir, filename), 'utf8'));
    sqlite.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(filename, now());
  }

  const ordered = (table) => db.select().from(table).orderBy(asc(table.orderIndex), asc(table.createdAt)).all();
  const active = (table) => db.select().from(table).where(and(isNull(table.deletedAt), eq(table.archived, false))).orderBy(asc(table.orderIndex), asc(table.createdAt)).all();
  const allActiveProjects = () => active(projects);
  const allActiveTasks = () => active(tasks);
  const allProjects = () => ordered(projects);
  const allTasks = () => ordered(tasks);
  const insertOrUpdate = (table, record) => db.insert(table).values(record).onConflictDoUpdate({ target: table.id, set: { ...record, id: undefined } }).run();
  const safeRecord = (record, required, label) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error(`Invalid ${label}.`);
    for (const field of required) if (!nonEmpty(record[field])) throw new Error(`Invalid ${label}: ${field} is required.`);
    return record;
  };

  function projectRecord(input, kind = 'project') {
    const timestamp = now();
    const recordKind = input.kind || input.type || kind;
    return { id: bounded(nonEmpty(input.id, id(recordKind)), 160), parentId: input.parentId || null, kind: recordKind, title: bounded(nonEmpty(input.title, input.name), 500), description: bounded(input.description), status: bounded(nonEmpty(input.status, 'backlog'), 80), priority: bounded(nonEmpty(input.priority, 'P1'), 40), orderIndex: Number.isFinite(input.orderIndex ?? input.order) ? Number(input.orderIndex ?? input.order) : 0, dueDate: input.dueDate || null, nextAction: bounded(input.nextAction), definitionOfDone: bounded(input.definitionOfDone), blockedReason: bounded(input.blockedReason), dependencies: bounded(input.dependencies), acceptanceCriteria: bounded(input.acceptanceCriteria), securityPrivacyNotes: bounded(input.securityPrivacyNotes), sourceContext: bounded(input.sourceContext), confidence: bounded(input.confidence), archived: Boolean(input.archived), createdAt: input.createdAt || timestamp, updatedAt: timestamp, deletedAt: null };
  }
  function validateProjectHierarchy(record, source = db) {
    if (!['workspace', 'project', 'release', 'phase'].includes(record.kind)) throw new Error(`Invalid project kind: ${record.kind}.`);
    if (record.kind === 'workspace') {
      if (record.parentId) throw new Error('A workspace cannot have a parent.');
      return;
    }
    if (!record.parentId) throw new Error(`${record.kind} must belong to its parent.`);
    const parent = source.select().from(projects).where(eq(projects.id, record.parentId)).get();
    if (!parent) throw new Error(`${record.kind} parent does not exist.`);
    const expectedParent = { project: 'workspace', release: 'project', phase: 'release' }[record.kind];
    if (parent.kind !== expectedParent) throw new Error(`${record.kind} must belong to a ${expectedParent}.`);
  }
  function taskRecord(input, kind = 'task') {
    const timestamp = now();
    const recordKind = kind || (input.type === 'subtask' ? 'subtask' : 'task');
    const parentTaskId = recordKind === 'subtask' ? (input.parentTaskId || input.parentId || null) : null;
    return { id: bounded(nonEmpty(input.id, id(recordKind)), 160), projectId: bounded(nonEmpty(input.projectId), 160), parentTaskId, releaseId: input.releaseId || null, phaseId: input.phaseId || null, title: bounded(nonEmpty(input.title, input.name), 500), description: bounded(input.description), status: bounded(nonEmpty(input.status, 'backlog'), 80), priority: bounded(nonEmpty(input.priority, 'P1'), 40), orderIndex: Number.isFinite(input.orderIndex ?? input.order) ? Number(input.orderIndex ?? input.order) : 0, dueDate: input.dueDate || null, nextAction: bounded(input.nextAction), definitionOfDone: bounded(input.definitionOfDone), blockedReason: bounded(input.blockedReason), dependencies: bounded(input.dependencies), acceptanceCriteria: bounded(input.acceptanceCriteria), securityPrivacyNotes: bounded(input.securityPrivacyNotes), sourceContext: bounded(input.sourceContext), confidence: bounded(input.confidence), archived: Boolean(input.archived), createdAt: input.createdAt || timestamp, updatedAt: timestamp, deletedAt: null };
  }
  function jobRecord(input) {
    const timestamp = now();
    return {
      id: bounded(nonEmpty(input.id, id('job')), 160), company: bounded(nonEmpty(input.company), 300), roleTitle: bounded(nonEmpty(input.roleTitle), 500),
      url: bounded(input.url), location: bounded(input.location, 300), employmentType: bounded(input.employmentType, 120), salaryRange: bounded(input.salaryRange, 200), source: bounded(input.source, 200),
      stage: bounded(nonEmpty(input.stage, 'target'), 40), priority: bounded(nonEmpty(input.priority, 'medium'), 40), nextAction: bounded(input.nextAction), followUpDate: input.followUpDate || null,
      contactName: bounded(input.contactName, 300), contactEmail: bounded(input.contactEmail, 300), notes: bounded(input.notes, 10000), appliedAt: input.appliedAt || null, externalId: input.externalId || null, apiSource: input.apiSource || null, canonicalUrl: bounded(input.canonicalUrl || input.url), rawDataJson: JSON.stringify(input.rawData || {}), description: bounded(input.description, 50000), requirementsJson: JSON.stringify(Array.isArray(input.requirements) ? input.requirements : []), postedAt: input.postedAt || null, expiresAt: input.expiresAt || null, salaryMin: Number.isInteger(input.salaryMin) ? input.salaryMin : null, salaryMax: Number.isInteger(input.salaryMax) ? input.salaryMax : null, salaryCurrency: bounded(input.salaryCurrency || 'USD', 10), remoteType: bounded(input.remoteType || 'unknown', 20), matchScore: Number.isInteger(input.matchScore) ? input.matchScore : null, requirementsMatchScore: Number.isInteger(input.requirementsMatchScore) ? input.requirementsMatchScore : null, candidateMatchScore: Number.isInteger(input.candidateMatchScore) ? input.candidateMatchScore : null, fitTier: input.fitTier || null, matchSummary: bounded(input.matchSummary), lastEvaluatedAt: input.lastEvaluatedAt || null, lastSeenAt: input.lastSeenAt || null,
      createdAt: input.createdAt || timestamp, updatedAt: timestamp, archived: Boolean(input.archived), deletedAt: null
    };
  }
  function validateJobRecord(record) {
    if (!record.company || !record.roleTitle) throw new Error('A job requires a company and role title.');
    if (!['target', 'researching', 'ready', 'applied', 'screen', 'interviewing', 'final', 'offer', 'accepted', 'rejected'].includes(record.stage)) throw new Error('Invalid job stage.');
    if (!['low', 'medium', 'high'].includes(record.priority)) throw new Error('Invalid job priority.');
    for (const field of ['url', 'location', 'employmentType', 'salaryRange', 'source', 'nextAction', 'contactName', 'contactEmail', 'notes']) if (typeof record[field] !== 'string') throw new Error(`Invalid job ${field}.`);
    for (const field of ['followUpDate', 'appliedAt']) if (record[field] !== null && record[field] !== undefined && (typeof record[field] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record[field]))) throw new Error(`Invalid job ${field}.`);
    return record;
  }
  const JOB_STAGE_ORDER = ['target', 'researching', 'ready', 'applied', 'screen', 'interviewing', 'final', 'offer', 'accepted', 'rejected'];
  function hasSelectedApplicationDocuments(jobId) {
    const row = sqlite.prepare(`SELECT COUNT(DISTINCT document_type) AS count FROM job_application_documents d JOIN job_applications a ON a.id = d.application_id WHERE a.job_id = ? AND a.deleted_at IS NULL AND d.deleted_at IS NULL AND d.is_selected = 1 AND d.status = 'approved' AND d.document_type IN ('resume', 'cover_letter')`).get(jobId);
    return Number(row?.count || 0) === 2;
  }
  function jobToRenderer(row) { let rawData = {}; let requirements = []; try { rawData = JSON.parse(row.rawDataJson || row.raw_data_json || '{}'); } catch {} try { requirements = JSON.parse(row.requirementsJson || row.requirements_json || '[]'); } catch {} return { ...row, roleTitle: row.roleTitle ?? row.role_title, employmentType: row.employmentType ?? row.employment_type, salaryRange: row.salaryRange ?? row.salary_range, followUpDate: row.followUpDate ?? row.follow_up_date, contactName: row.contactName ?? row.contact_name, contactEmail: row.contactEmail ?? row.contact_email, appliedAt: row.appliedAt ?? row.applied_at, externalId: row.externalId ?? row.external_id, apiSource: row.apiSource ?? row.api_source, canonicalUrl: row.canonicalUrl ?? row.canonical_url, rawData, requirements, postedAt: row.postedAt ?? row.posted_at, expiresAt: row.expiresAt ?? row.expires_at, salaryMin: row.salaryMin ?? row.salary_min, salaryMax: row.salaryMax ?? row.salary_max, salaryCurrency: row.salaryCurrency ?? row.salary_currency, remoteType: row.remoteType ?? row.remote_type, matchScore: row.matchScore ?? row.match_score, requirementsMatchScore: row.requirementsMatchScore ?? row.requirements_match_score, candidateMatchScore: row.candidateMatchScore ?? row.candidate_match_score, fitTier: row.fitTier ?? row.fit_tier, matchSummary: row.matchSummary ?? row.match_summary, lastEvaluatedAt: row.lastEvaluatedAt ?? row.last_evaluated_at, lastSeenAt: row.lastSeenAt ?? row.last_seen_at, createdAt: row.createdAt ?? row.created_at, updatedAt: row.updatedAt ?? row.updated_at, deletedAt: row.deletedAt ?? row.deleted_at, archived: Boolean(row.archived) }; }
  function upsertJob(input) {
    const record = validateJobRecord(jobRecord(input));
    const existing = db.select().from(jobOpportunities).where(eq(jobOpportunities.id, record.id)).get();
    if (existing?.deletedAt) {
      // Search results use stable provider IDs. Restore an archived match without
      // rewinding its application progress when the same listing is saved again.
      const restored = { ...record, stage: existing.stage, appliedAt: existing.appliedAt, followUpDate: existing.followUpDate, nextAction: existing.nextAction, createdAt: existing.createdAt, deletedAt: null };
      db.update(jobOpportunities).set({ ...restored, id: undefined }).where(eq(jobOpportunities.id, record.id)).run();
      recordJobActivity(record.id, 'job_restored', 'Archived opportunity restored to the job pipeline.');
    } else if (existing) {
      // Applied is the forward-only boundary: before submission, a job can be
      // moved back through research (including Ready to apply) when the user
      // needs to revisit the opportunity. Once Applied is reached, preserving
      // this invariant prevents board edits, detail edits, and IPC callers
      // from moving a submitted job back to a pre-application stage.
      const currentStageIndex = JOB_STAGE_ORDER.indexOf(existing.stage);
      const nextStageIndex = JOB_STAGE_ORDER.indexOf(record.stage);
      if (currentStageIndex >= JOB_STAGE_ORDER.indexOf('applied') && nextStageIndex < currentStageIndex) throw new Error(`A job cannot move backward from ${existing.stage}.`);
      if (record.stage === 'ready' && currentStageIndex < JOB_STAGE_ORDER.indexOf('ready') && !hasSelectedApplicationDocuments(record.id)) throw new Error('A job can move to Ready to apply only after an approved resume and cover letter are selected.');
      db.update(jobOpportunities).set({ ...record, id: undefined, createdAt: existing.createdAt }).where(eq(jobOpportunities.id, record.id)).run();
      if (existing.stage !== record.stage) recordJobActivity(record.id, 'stage_changed', `Stage changed to ${record.stage}.`, { from: existing.stage, to: record.stage });
    } else {
      db.insert(jobOpportunities).values(record).run();
      recordJobActivity(record.id, 'job_saved', 'Opportunity added to the job pipeline.');
    }
    return jobToRenderer(db.select().from(jobOpportunities).where(eq(jobOpportunities.id, record.id)).get());
  }
  function updateJobStage(jobId, stage) {
    const existing = requirePipelineJob(jobId);
    if (!JOB_STAGE_ORDER.includes(stage)) throw new Error('Invalid job stage.');
    const currentStageIndex = JOB_STAGE_ORDER.indexOf(existing.stage);
    const nextStageIndex = JOB_STAGE_ORDER.indexOf(stage);
    if (currentStageIndex >= JOB_STAGE_ORDER.indexOf('applied') && nextStageIndex < currentStageIndex) throw new Error(`A job cannot move backward from ${existing.stage}.`);
    if (stage === 'ready' && currentStageIndex < JOB_STAGE_ORDER.indexOf('ready') && !hasSelectedApplicationDocuments(existing.id)) throw new Error('A job can move to Ready to apply only after an approved resume and cover letter are selected.');
    if (existing.stage !== stage) {
      const stamp = now();
      sqlite.prepare('UPDATE job_opportunities SET stage = ?, updated_at = ? WHERE id = ?').run(stage, stamp, existing.id);
      recordJobActivity(existing.id, 'stage_changed', `Stage changed to ${stage}.`, { from: existing.stage, to: stage });
    }
    return jobToRenderer(db.select().from(jobOpportunities).where(eq(jobOpportunities.id, existing.id)).get());
  }
  function archiveUnavailableJob(jobId) {
    const existing = requirePipelineJob(jobId);
    const stamp = now();
    sqlite.transaction(() => {
      // Unavailable listings are terminal, but remain visible in the combined
      // rejected / withdrawn / archived pipeline column for audit history.
      sqlite.prepare("UPDATE job_opportunities SET stage = 'rejected', archived = 0, deleted_at = NULL, updated_at = ? WHERE id = ?").run(stamp, existing.id);
      if (existing.stage !== 'rejected') recordJobActivity(existing.id, 'stage_changed', 'Job listing was unavailable and archived from the application queue.', { from: existing.stage, to: 'rejected', reasonCode: 'job_listing_unavailable' });
    })();
    return jobToRenderer(db.select().from(jobOpportunities).where(eq(jobOpportunities.id, existing.id)).get());
  }
  function jobNotificationCounts(jobId) { const idValue = bounded(jobId, 160); return { linkedEmailCount: Number(sqlite.prepare('SELECT COUNT(*) AS count FROM email_job_links WHERE job_id = ?').get(idValue).count) || 0, unreadVoiceActivityCount: Number(sqlite.prepare("SELECT COUNT(*) AS count FROM job_detail_activity WHERE job_id = ? AND activity_type = 'google_voice_conversation' AND read_at IS NULL").get(idValue).count) || 0, unreadEmailCount: Number(sqlite.prepare("SELECT COUNT(*) AS count FROM email_job_links l JOIN email_messages e ON e.id = l.email_id WHERE l.job_id = ? AND e.seen_at IS NULL AND e.user_excluded = 0").get(idValue).count) || 0 }; }
  function jobGoogleVoiceAssignment(jobId) {
    // Google Voice is an optional power-user integration and is not part of
    // the standalone participant schema.
    if (careerOnly) return {};
    return sqlite.prepare('SELECT phone_number AS phoneNumber FROM job_phone_assignments WHERE job_id = ? ORDER BY created_at DESC LIMIT 1').get(bounded(jobId, 160)) || {};
  }
  function listJobs() { return db.select().from(jobOpportunities).where(and(isNull(jobOpportunities.deletedAt), eq(jobOpportunities.archived, false))).orderBy(asc(jobOpportunities.stage), desc(jobOpportunities.updatedAt)).all().map((row) => ({ ...jobToRenderer(row), ...jobNotificationCounts(row.id), googleVoicePhoneNumber: jobGoogleVoiceAssignment(row.id).phoneNumber || '', googleVoiceContactName: row.contactName || '' })); }
  function requirePipelineJob(jobId) { const job = db.select().from(jobOpportunities).where(and(eq(jobOpportunities.id, bounded(jobId, 160)), isNull(jobOpportunities.deletedAt))).get(); if (!job) throw new Error('Pipeline job not found.'); return job; }
  function requirePostApplicationJob(jobId) { const job = requirePipelineJob(jobId); if (JOB_STAGE_ORDER.indexOf(job.stage) < JOB_STAGE_ORDER.indexOf('applied')) throw new Error('Follow-ups and interview deadlines are available after the job is Applied.'); return job; }
  function recordJobActivity(jobId, activityType, summary, metadata = {}) { requirePipelineJob(jobId); const timestamp = now(); const row = { id: id('job-activity'), job_id: bounded(jobId, 160), activity_type: bounded(activityType, 80), summary: bounded(summary, 2000), metadata_json: JSON.stringify(metadata || {}), created_at: timestamp, read_at: metadata?.readAt || null }; sqlite.transaction(() => { sqlite.prepare('INSERT INTO job_detail_activity (id, job_id, activity_type, summary, metadata_json, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(row.id, row.job_id, row.activity_type, row.summary, row.metadata_json, row.created_at, row.read_at); sqlite.prepare('UPDATE job_opportunities SET updated_at = ? WHERE id = ?').run(timestamp, row.job_id); })(); return { id: row.id, jobId: row.job_id, activityType: row.activity_type, summary: row.summary, metadata, createdAt: row.created_at, readAt: row.read_at }; }
  function assignGoogleVoiceConversation(jobId, input = {}) { const job = requirePipelineJob(jobId); const phoneNumber = normalizePhoneNumber(input.phoneNumber); if (!phoneNumber) throw new Error('A valid phone number is required to assign this conversation.'); const timestamp = now(); // A job has one active Voice contact; replacing the old row lets a corrected re-assignment repair earlier bad captures.
    sqlite.transaction(() => { sqlite.prepare('DELETE FROM job_phone_assignments WHERE job_id = ?').run(job.id); sqlite.prepare('INSERT INTO job_phone_assignments (phone_number, job_id, created_at) VALUES (?, ?, ?)').run(phoneNumber, job.id, timestamp); })(); return recordGoogleVoiceConversation(job.id, { ...input, phoneNumber, contactName: bounded(input.contactName || job.contactName), readAt: timestamp }); }
  function recordGoogleVoiceConversation(jobId, input = {}) { const title = bounded(nonEmpty(input.title, 'Google Voice conversation'), 300); const content = bounded(input.content, 20000); if (!content.trim()) throw new Error('The Google Voice conversation had no readable text to save.'); const phoneNumber = normalizePhoneNumber(input.phoneNumber); return recordJobActivity(jobId, 'google_voice_conversation', `Google Voice: ${title}`, { sourceUrl: bounded(input.sourceUrl, 2000), title, phoneNumber, contactName: bounded(input.contactName), content, activityType: bounded(input.activityType, 40) || 'message', sourceFingerprint: bounded(input.sourceFingerprint, 64), readAt: input.readAt || null, capturedAt: now() }); }
  function ingestGoogleVoiceActivity(input = {}) { const phoneNumber = normalizePhoneNumber(input.phoneNumber); if (!phoneNumber) return { matched: false, reason: 'phone_missing', jobIds: [], activities: [] }; const assignments = sqlite.prepare('SELECT a.job_id AS jobId, j.contact_name AS contactName FROM job_phone_assignments a JOIN job_opportunities j ON j.id = a.job_id WHERE a.phone_number = ? ORDER BY a.created_at DESC').all(phoneNumber); if (assignments.length !== 1) return { matched: false, reason: assignments.length > 1 ? 'ambiguous_phone' : 'unassigned_phone', jobIds: assignments.map((entry) => entry.jobId), activities: [] }; const fingerprint = activityFingerprint({ ...input, phoneNumber }); const duplicate = sqlite.prepare("SELECT 1 FROM job_detail_activity WHERE activity_type = 'google_voice_conversation' AND metadata_json LIKE ? LIMIT 1").get(`%\"sourceFingerprint\":\"${fingerprint}\"%`); if (duplicate) return { matched: true, duplicate: true, jobIds: [assignments[0].jobId], activities: [] }; const activity = recordGoogleVoiceConversation(assignments[0].jobId, { ...input, phoneNumber, contactName: bounded(input.contactName || assignments[0].contactName), sourceFingerprint: fingerprint }); return { matched: true, duplicate: false, jobIds: [assignments[0].jobId], activities: [activity] }; }
  function listJobActivity(jobId) { requirePipelineJob(jobId); return sqlite.prepare('SELECT * FROM job_detail_activity WHERE job_id = ? ORDER BY created_at DESC LIMIT 100').all(bounded(jobId, 160)).map((row) => ({ id: row.id, jobId: row.job_id, activityType: row.activity_type, summary: row.summary, metadata: jsonField(row.metadata_json, {}), createdAt: row.created_at, readAt: row.read_at })); }
  function markJobActivitySeen(jobId) { requirePipelineJob(jobId); const timestamp = now(); sqlite.prepare("UPDATE job_detail_activity SET read_at = COALESCE(read_at, ?) WHERE job_id = ? AND activity_type = 'google_voice_conversation'").run(timestamp, bounded(jobId, 160)); return jobNotificationCounts(jobId); }
  function listJobEmails(jobId) { requirePipelineJob(jobId); return sqlite.prepare('SELECT e.* FROM email_messages e JOIN email_job_links l ON l.email_id = e.id WHERE l.job_id = ? ORDER BY e.received_at DESC, e.updated_at DESC').all(bounded(jobId, 160)).map(emailToRenderer); }
  function createJobFollowUp(input = {}) { requirePostApplicationJob(input.jobId); const timestamp = now(); const title = bounded(nonEmpty(input.title), 500); if (!title) throw new Error('A follow-up task needs a title.'); const dueDate = input.dueDate || null; if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error('Invalid follow-up due date.'); const task = { id: bounded(nonEmpty(input.id, id('job-follow-up')), 160), jobId: bounded(input.jobId, 160), title, dueDate, status: 'open', sourceEmailId: input.sourceEmailId || null, createdAt: timestamp, updatedAt: timestamp, completedAt: null, deletedAt: null }; sqlite.prepare('INSERT INTO job_follow_up_tasks (id, job_id, title, due_date, status, source_email_id, created_at, updated_at, completed_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(task.id, task.jobId, task.title, task.dueDate, task.status, task.sourceEmailId, task.createdAt, task.updatedAt, null, null); recordJobActivity(task.jobId, 'follow_up_created', `Follow-up created: ${task.title}`, { taskId: task.id, dueDate: task.dueDate }); return task; }
  function listJobFollowUps(jobId) { requirePipelineJob(jobId); return sqlite.prepare("SELECT id, job_id AS jobId, title, due_date AS dueDate, status, source_email_id AS sourceEmailId, created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt FROM job_follow_up_tasks WHERE job_id = ? AND deleted_at IS NULL ORDER BY status ASC, due_date ASC, created_at DESC").all(bounded(jobId, 160)); }
  function completeJobFollowUp(taskId, completed) { const task = sqlite.prepare('SELECT * FROM job_follow_up_tasks WHERE id = ? AND deleted_at IS NULL').get(bounded(taskId, 160)); if (!task) throw new Error('Follow-up task not found.'); const timestamp = now(); const status = completed ? 'completed' : 'open'; sqlite.prepare('UPDATE job_follow_up_tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?').run(status, completed ? timestamp : null, timestamp, task.id); recordJobActivity(task.job_id, completed ? 'follow_up_completed' : 'follow_up_reopened', `${completed ? 'Completed' : 'Reopened'} follow-up: ${task.title}`, { taskId: task.id }); return { ...task, jobId: task.job_id, dueDate: task.due_date, sourceEmailId: task.source_email_id, status, updatedAt: timestamp, completedAt: completed ? timestamp : null }; }
  function createJobCalendarEvent(input = {}) { requirePostApplicationJob(input.jobId); const title = bounded(nonEmpty(input.title), 500); if (!title) throw new Error('A calendar event needs a title.'); const startsAt = bounded(nonEmpty(input.startsAt), 80); const endsAt = bounded(nonEmpty(input.endsAt, startsAt), 80); if (!startsAt || !endsAt) throw new Error('Calendar event start and end are required.'); const timestamp = now(); const event = { id: bounded(nonEmpty(input.id, id('job-calendar')), 160), provider: 'local', externalId: null, title, description: bounded(input.description, 5000), startsAt, endsAt, location: bounded(input.location, 500), allDay: Boolean(input.allDay), metadataJson: JSON.stringify({ jobId: input.jobId }), createdAt: timestamp, updatedAt: timestamp, deletedAt: null }; db.insert(calendarEvents).values(event).run(); sqlite.prepare('INSERT INTO job_calendar_links (job_id, calendar_event_id, created_at) VALUES (?, ?, ?)').run(bounded(input.jobId, 160), event.id, timestamp); recordJobActivity(input.jobId, 'calendar_event_created', `Calendar event added: ${title}`, { calendarEventId: event.id, startsAt }); return event; }
  function listJobCalendarEvents(jobId) { requirePipelineJob(jobId); return sqlite.prepare('SELECT c.* FROM calendar_events c JOIN job_calendar_links l ON l.calendar_event_id = c.id WHERE l.job_id = ? AND c.deleted_at IS NULL ORDER BY c.starts_at ASC').all(bounded(jobId, 160)); }
  const jsonField = (value, fallback = []) => { try { const parsed = JSON.parse(value || ''); return parsed; } catch { return fallback; } };
  function profileRecord(input = {}) { const timestamp = now(); const current = sqlite.prepare('SELECT * FROM user_profiles WHERE id = ?').get('current'); return { id: 'current', full_name: bounded(input.fullName ?? current?.full_name), first_name: bounded(input.firstName ?? current?.first_name, 120), last_name: bounded(input.lastName ?? current?.last_name, 120), email: bounded(input.email ?? current?.email), phone: bounded(input.phone ?? current?.phone), linkedin_url: bounded(input.linkedinUrl ?? current?.linkedin_url), github_url: bounded(input.githubUrl ?? current?.github_url), portfolio_url: bounded(input.portfolioUrl ?? current?.portfolio_url), target_roles_json: JSON.stringify(input.targetRoles ?? jsonField(current?.target_roles_json)), target_industries_json: JSON.stringify(input.targetIndustries ?? jsonField(current?.target_industries_json)), target_locations_json: JSON.stringify(input.targetLocations ?? jsonField(current?.target_locations_json)), must_have_skills_json: JSON.stringify(input.mustHaveSkills ?? jsonField(current?.must_have_skills_json)), nice_to_have_skills_json: JSON.stringify(input.niceToHaveSkills ?? jsonField(current?.nice_to_have_skills_json)), radius_miles: Number.isFinite(Number(input.radiusMiles)) ? Math.max(0, Math.min(100, Number(input.radiusMiles))) : (current?.radius_miles ?? null), remote_preference: bounded(input.remotePreference ?? current?.remote_preference ?? 'any', 20), minimum_salary: Number.isInteger(input.minimumSalary) ? input.minimumSalary : (current?.minimum_salary ?? null), salary_currency: bounded(input.salaryCurrency ?? current?.salary_currency ?? 'USD', 10), work_authorization: bounded(input.workAuthorization ?? current?.work_authorization), requires_sponsorship: input.requiresSponsorship === undefined ? Number(current?.requires_sponsorship || 0) : (input.requiresSponsorship ? 1 : 0), security_clearance: bounded(input.securityClearance ?? current?.security_clearance), years_experience: Number.isInteger(input.yearsExperience) ? input.yearsExperience : (current?.years_experience ?? null), interests_json: JSON.stringify(input.interests ?? jsonField(current?.interests_json)), excluded_keywords_json: JSON.stringify(input.excludedKeywords ?? jsonField(current?.excluded_keywords_json)), preferred_job_types_json: JSON.stringify(input.preferredJobTypes ?? jsonField(current?.preferred_job_types_json, ['full-time'])), street: bounded(input.street ?? current?.street, 300), city: bounded(input.city ?? current?.city, 120), state: bounded(input.state ?? current?.state, 120), postal_code: bounded(input.postalCode ?? current?.postal_code, 40), country: bounded(input.country ?? current?.country, 120), desired_salary: Number.isInteger(input.desiredSalary) ? input.desiredSalary : (current?.desired_salary ?? null), notice_period: bounded(input.noticePeriod ?? current?.notice_period, 120), available_start_date: bounded(input.availableStartDate ?? current?.available_start_date, 40), relocation_willingness: bounded(input.relocationWillingness ?? current?.relocation_willingness, 40), travel_willingness: bounded(input.travelWillingness ?? current?.travel_willingness, 40), created_at: current?.created_at || timestamp, updated_at: timestamp }; }
  const profileRenderer = (row) => row ? ({ ...row, fullName: row.full_name, firstName: row.first_name, lastName: row.last_name, linkedinUrl: row.linkedin_url, githubUrl: row.github_url, portfolioUrl: row.portfolio_url, targetRoles: jsonField(row.target_roles_json), targetIndustries: jsonField(row.target_industries_json), targetLocations: jsonField(row.target_locations_json), mustHaveSkills: jsonField(row.must_have_skills_json), niceToHaveSkills: jsonField(row.nice_to_have_skills_json), radiusMiles: row.radius_miles, remotePreference: row.remote_preference, minimumSalary: row.minimum_salary, salaryCurrency: row.salary_currency, workAuthorization: row.work_authorization, requiresSponsorship: Boolean(row.requires_sponsorship), securityClearance: row.security_clearance, yearsExperience: row.years_experience, interests: jsonField(row.interests_json), excludedKeywords: jsonField(row.excluded_keywords_json), preferredJobTypes: jsonField(row.preferred_job_types_json), street: row.street, city: row.city, state: row.state, postalCode: row.postal_code, country: row.country, desiredSalary: row.desired_salary, noticePeriod: row.notice_period, availableStartDate: row.available_start_date, relocationWillingness: row.relocation_willingness, travelWillingness: row.travel_willingness }) : null;
  function getProfile() { return profileRenderer(sqlite.prepare('SELECT * FROM user_profiles WHERE id = ?').get('current')); }
  function upsertProfile(input) { const record = profileRecord(input); sqlite.prepare(`INSERT INTO user_profiles (${Object.keys(record).join(',')}) VALUES (${Object.keys(record).map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${Object.keys(record).filter((key) => key !== 'id').map((key) => `${key}=excluded.${key}`).join(',')}`).run(...Object.values(record)); return getProfile(); }
  function getResume() { const row = sqlite.prepare('SELECT * FROM master_resumes WHERE id = ?').get('current'); return row ? { ...row, rawText: row.raw_text, professionalSummary: row.professional_summary, sourceFilename: row.source_filename, sourceType: row.source_type, experience: jsonField(row.experience_json), education: jsonField(row.education_json), skills: jsonField(row.skills_json), projects: jsonField(row.projects_json), certifications: jsonField(row.certifications_json), achievements: jsonField(row.achievements_json) } : null; }
  function upsertResume(input = {}) { const old = sqlite.prepare('SELECT * FROM master_resumes WHERE id = ?').get('current'); const record = { id: 'current', raw_text: bounded(input.rawText ?? old?.raw_text, 100000), professional_summary: bounded(input.professionalSummary ?? old?.professional_summary), experience_json: JSON.stringify(input.experience ?? jsonField(old?.experience_json)), education_json: JSON.stringify(input.education ?? jsonField(old?.education_json)), skills_json: JSON.stringify(input.skills ?? jsonField(old?.skills_json)), projects_json: JSON.stringify(input.projects ?? jsonField(old?.projects_json)), certifications_json: JSON.stringify(input.certifications ?? jsonField(old?.certifications_json)), achievements_json: JSON.stringify(input.achievements ?? jsonField(old?.achievements_json)), source_filename: bounded(input.sourceFilename ?? old?.source_filename), source_type: bounded(input.sourceType ?? old?.source_type ?? 'manual'), version: (old?.version || 0) + 1, created_at: old?.created_at || now(), updated_at: now() }; sqlite.prepare(`INSERT INTO master_resumes (${Object.keys(record).join(',')}) VALUES (${Object.keys(record).map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${Object.keys(record).filter((key) => key !== 'id').map((key) => `${key}=excluded.${key}`).join(',')}`).run(...Object.values(record)); return getResume(); }
  // Document labels identify internal workflow versions. They must never become
  // the heading of a resume that a candidate can export, select, or submit.
  const isInternalResumeHeading = (value) => /^(?:master\s+resume|resume(?:\s*[-–—:]?\s*(?:v(?:ersion)?\.?\s*)?\d+)?)$/i.test(String(value || '').trim());
  function masterResumeContent(resume) {
    const sourceLines = String(resume.rawText || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const sourceHeading = sourceLines.find((line) => !isInternalResumeHeading(line)) || '';
    const profileHeading = String(getProfile()?.fullName || '').trim();
    const summaryLines = sourceHeading && sourceLines[0] === sourceHeading ? sourceLines.slice(1) : sourceLines;
    return { headline: sourceHeading || (isInternalResumeHeading(profileHeading) ? '' : profileHeading), summary: summaryLines.length ? [{ text: summaryLines.join('\n') }] : [], skills: resume.skills || [], experience: resume.experience || [], education: resume.education || [] };
  }
  function repairMasterResumeDocument(document, content) {
    const plainText = renderPlainText('resume', content);
    const htmlText = renderHtml('resume', content);
    // A repaired version no longer corresponds to an already-exported PDF.
    // Clear export metadata so selecting it cannot silently reuse the stale file.
    sqlite.prepare('UPDATE job_application_documents SET content_json = ?, plain_text = ?, html_text = ?, exported_pdf_path = ?, exported_text_path = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(content), plainText, htmlText, '', '', now(), document.id);
    return getDocument(document.id);
  }
  function repairStoredMasterResumeHeadings() {
    const documents = sqlite.prepare("SELECT id, content_json FROM job_application_documents WHERE document_type = 'resume' AND model_name = 'master_resume' AND deleted_at IS NULL").all();
    for (const document of documents) {
      const content = parseObject(document.content_json);
      if (!isInternalResumeHeading(content.headline)) continue;
      const sourceHeading = String(content.summary?.[0]?.text || '').split(/\r?\n/).map((line) => line.trim()).find((line) => line && !isInternalResumeHeading(line)) || '';
      repairMasterResumeDocument(document, { ...content, headline: sourceHeading });
    }
  }
  const parseObject = (value, fallback = {}) => { try { const parsed = JSON.parse(value || ''); return parsed && typeof parsed === 'object' ? parsed : fallback; } catch { return fallback; } };
  const applicationToRenderer = (row) => row ? ({ ...row, jobId: row.job_id, readiness: parseObject(row.readiness_json), unresolvedCount: row.unresolved_count, applicationUrl: row.application_url, externalApplicationUrl: row.external_application_url, externalApplicationHost: row.external_application_host, atsKey: row.ats_key, startedAt: row.started_at, lastActivityAt: row.last_activity_at, submittedAt: row.submitted_at, confirmationNumber: row.confirmation_number, confirmationUrl: row.confirmation_url, withdrawnAt: row.withdrawn_at, createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at, applicationFolderPath: row.application_folder_path, selectedResumePath: row.selected_resume_path, selectedCoverLetterPath: row.selected_cover_letter_path, automationState: row.automation_state, automationAttempt: row.automation_attempt, automationCheckpoint: parseObject(row.automation_checkpoint_json), automationNextRetryAt: row.automation_next_retry_at }) : null;
  function recordExternalApplicationUrl(input = {}) { const applicationId = bounded(input.applicationId, 160); const url = bounded(input.url, 2000); const host = bounded(input.host, 253).toLowerCase(); const app = getApplication(applicationId); if (!app || !url || !host || host === (() => { try { return new URL(app.applicationUrl).host; } catch { return ''; } })()) return app; if (app.externalApplicationUrl === url && app.externalApplicationHost === host) return app; const stamp = now(); sqlite.prepare('UPDATE job_applications SET external_application_url = ?, external_application_host = ?, last_activity_at = ?, updated_at = ? WHERE id = ?').run(url, host, stamp, stamp, applicationId); recordApplicationEvent({ applicationId, eventType: 'external_destination_recorded', summary: `Redirected application destination recorded for ${host}.`, metadata: { host, url } }); return getApplication(applicationId); }
  const answerToRenderer = (row) => ({ ...row, applicationId: row.application_id, questionKey: row.question_key, questionText: row.question_text, normalizedCategory: row.normalized_category, answerText: row.answer_text, answer: jsonField(row.answer_json, null), approvalStatus: row.approval_status, autofillPolicy: row.autofill_policy, provenance: jsonField(row.provenance_json) });
  const eventToRenderer = (row) => ({ ...row, applicationId: row.application_id, eventType: row.event_type, metadata: parseObject(row.metadata_json), createdAt: row.created_at });
  function refreshApplicationReadiness(applicationId) { const app = sqlite.prepare('SELECT * FROM job_applications WHERE id = ? AND deleted_at IS NULL').get(applicationId); if (!app) return null; const job = jobToRenderer(sqlite.prepare('SELECT * FROM job_opportunities WHERE id = ?').get(app.job_id)); const readiness = computeApplicationReadiness({ job, profile: getProfile() || {}, resume: getResume() || {} }); const stamp = now(); sqlite.prepare('UPDATE job_applications SET readiness_json = ?, last_activity_at = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(readiness), stamp, stamp, applicationId); return applicationToRenderer(sqlite.prepare('SELECT * FROM job_applications WHERE id = ?').get(applicationId)); }
  function recordApplicationEvent(input = {}) { const appId = bounded(input.applicationId, 160); if (!appId) throw new Error('Invalid application id.'); const metadata = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? input.metadata : {}; const record = { id: id('application-event'), application_id: appId, event_type: bounded(input.eventType, 80) || 'updated', summary: bounded(input.summary, 1000), metadata_json: JSON.stringify(metadata), created_at: now() }; sqlite.prepare('INSERT INTO job_application_events (id, application_id, event_type, summary, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(...Object.values(record)); return eventToRenderer(record); }
  function ensureApplicationFiles(applicationId) { const row = sqlite.prepare('SELECT * FROM job_applications WHERE id = ? AND deleted_at IS NULL').get(applicationId); if (!row) throw new Error('Application not found.'); const job = sqlite.prepare('SELECT * FROM job_opportunities WHERE id = ? AND deleted_at IS NULL').get(row.job_id); if (!job) return applicationToRenderer(row); const files = ensureApplicationFileStructure(documentsRoot, jobToRenderer(job), row.id); const legacyFolder = row.application_folder_path && path.resolve(row.application_folder_path) !== path.resolve(files.folderPath) ? row.application_folder_path : ''; if (legacyFolder && fs.existsSync(legacyFolder)) { fs.cpSync(legacyFolder, files.folderPath, { recursive: true, force: true }); } const pathsChanged = row.application_folder_path !== files.folderPath || row.selected_resume_path !== files.selectedResumePath || row.selected_cover_letter_path !== files.selectedCoverLetterPath; if (pathsChanged) sqlite.prepare('UPDATE job_applications SET application_folder_path = ?, selected_resume_path = ?, selected_cover_letter_path = ?, updated_at = ? WHERE id = ?').run(files.folderPath, files.selectedResumePath, files.selectedCoverLetterPath, now(), row.id); return applicationToRenderer(sqlite.prepare('SELECT * FROM job_applications WHERE id = ?').get(row.id)); }
  function createOrResumeApplication(input = {}) { const jobId = bounded(input.jobId, 160); const job = sqlite.prepare('SELECT * FROM job_opportunities WHERE id = ? AND deleted_at IS NULL').get(jobId); if (!job) throw new Error('Job not found.'); const current = sqlite.prepare('SELECT * FROM job_applications WHERE job_id = ? AND deleted_at IS NULL').get(jobId); if (current) { ensureApplicationFiles(current.id); return refreshApplicationReadiness(current.id); }
    const stamp = now(); const appId = id('application'); const readiness = computeApplicationReadiness({ job: jobToRenderer(job), profile: getProfile() || {}, resume: getResume() || {} });
    sqlite.transaction(() => {
      // Starting an application begins research; both selected documents earn Ready to apply.
      if (job.stage === 'target') sqlite.prepare("UPDATE job_opportunities SET stage = 'researching', updated_at = ? WHERE id = ?").run(stamp, jobId);
      const files = ensureApplicationFileStructure(documentsRoot, jobToRenderer(job), appId);
      sqlite.prepare('INSERT INTO job_applications (id, job_id, status, application_url, ats_key, readiness_json, unresolved_count, started_at, last_activity_at, submitted_at, confirmation_number, confirmation_url, withdrawn_at, created_at, updated_at, deleted_at, application_folder_path, selected_resume_path, selected_cover_letter_path, automation_state, automation_attempt, automation_checkpoint_json, automation_next_retry_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL)').run(appId, jobId, 'drafting', bounded(job.url || job.canonical_url, 2000), 'unknown', JSON.stringify(readiness), 0, stamp, stamp, '', '', stamp, stamp, files.folderPath, files.selectedResumePath, files.selectedCoverLetterPath, 'queued', 0, '{}');
      recordApplicationEvent({ applicationId: appId, eventType: 'started', summary: 'Application workspace created.' });
    })();
    return applicationToRenderer(sqlite.prepare('SELECT * FROM job_applications WHERE id = ?').get(appId)); }
  function getApplication(applicationId) { const row = sqlite.prepare('SELECT * FROM job_applications WHERE id = ? AND deleted_at IS NULL').get(applicationId); return row ? ensureApplicationFiles(row.id) : null; }
  function transitionApplication(input = {}) { const app = getApplication(bounded(input.id, 160)); if (!app) throw new Error('Application not found.'); assertTransition(app.status, input.status, { trustedCompletion: false }); const stamp = now(); sqlite.prepare('UPDATE job_applications SET status = ?, last_activity_at = ?, updated_at = ? WHERE id = ?').run(input.status, stamp, stamp, app.id); recordApplicationEvent({ applicationId: app.id, eventType: 'status_changed', summary: `Status changed to ${input.status}.` }); return refreshApplicationReadiness(app.id); }
  function updateAutonomousApplicationState(input = {}) { const applicationId = bounded(input.applicationId, 160); const app = getApplication(applicationId); if (!app) throw new Error('Application not found.'); const state = assertAutonomousApplicationState(input.state); const checkpoint = input.checkpoint && typeof input.checkpoint === 'object' && !Array.isArray(input.checkpoint) ? input.checkpoint : {}; const stamp = now(); const attempt = Number.isInteger(input.attempt) && input.attempt >= 0 ? input.attempt : app.automationAttempt || 0; sqlite.prepare('UPDATE job_applications SET automation_state = ?, automation_attempt = ?, automation_checkpoint_json = ?, automation_next_retry_at = ?, last_activity_at = ?, updated_at = ? WHERE id = ?').run(state, attempt, JSON.stringify(checkpoint), input.nextRetryAt || null, stamp, stamp, applicationId); recordApplicationEvent({ applicationId, eventType: 'automation_state_changed', summary: `Autonomous application state changed to ${state}.`, metadata: { state, attempt, checkpointKeys: Object.keys(checkpoint).slice(0, 20) } }); return getApplication(applicationId); }
  function abandonApplication(applicationId) { const app = getApplication(bounded(applicationId, 160)); if (!app) throw new Error('Application not found.'); const stamp = now(); sqlite.prepare('UPDATE job_applications SET status = ?, deleted_at = ?, withdrawn_at = ?, last_activity_at = ?, updated_at = ? WHERE id = ?').run('withdrawn', stamp, stamp, stamp, stamp, app.id); recordApplicationEvent({ applicationId: app.id, eventType: 'abandoned', summary: 'Application workspace abandoned.' }); return { ...app, status: 'withdrawn', deletedAt: stamp, withdrawnAt: stamp }; }
  const submissionEvidenceToRenderer = (row) => row ? ({ id: row.id, applicationId: row.application_id, browserState: row.browser_state, browserConfirmationUrl: row.browser_confirmation_url, browserConfirmationNumber: row.browser_confirmation_number, emailId: row.email_id, emailSignals: parseObject(row.email_signals_json, []), confirmationNumber: row.confirmation_number, status: row.status, requestedAt: row.requested_at, matchedAt: row.matched_at, createdAt: row.created_at, updatedAt: row.updated_at }) : null;
  function beginSubmissionVerification(input = {}) { const app = getApplication(bounded(input.applicationId, 160)); if (!app) throw new Error('Application not found.'); const stamp = input.requestedAt || now(); const active = sqlite.prepare("SELECT * FROM job_application_submission_evidence WHERE application_id = ? AND status IN ('awaiting_email','verified') ORDER BY updated_at DESC LIMIT 1").get(app.id); const evidence = { id: active?.id || bounded(input.id, 160) || id('submission-evidence'), application_id: app.id, browser_state: input.browserState === 'confirmed' ? 'confirmed' : (active?.browser_state || 'unverified'), browser_confirmation_url: bounded(input.browserConfirmationUrl || active?.browser_confirmation_url, 2000), browser_confirmation_number: bounded(input.browserConfirmationNumber || active?.browser_confirmation_number, 160), email_id: active?.email_id || null, email_signals_json: active?.email_signals_json || '[]', confirmation_number: active?.confirmation_number || '', status: active?.status || 'awaiting_email', requested_at: active?.requested_at || stamp, matched_at: active?.matched_at || null, created_at: active?.created_at || now(), updated_at: now() }; sqlite.prepare(`INSERT INTO job_application_submission_evidence (id, application_id, browser_state, browser_confirmation_url, browser_confirmation_number, email_id, email_signals_json, confirmation_number, status, requested_at, matched_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET browser_state=excluded.browser_state, browser_confirmation_url=excluded.browser_confirmation_url, browser_confirmation_number=excluded.browser_confirmation_number, status=excluded.status, requested_at=excluded.requested_at, updated_at=excluded.updated_at`).run(...Object.values(evidence)); updateAutonomousApplicationState({ applicationId: app.id, state: 'verifying_email_confirmation', checkpoint: { ...app.automationCheckpoint, browserConfirmationUrlRedacted: evidence.browser_confirmation_url, browserConfirmationNumber: evidence.browser_confirmation_number, submissionEvidenceId: evidence.id, requestedAt: evidence.requested_at } }); return submissionEvidenceToRenderer(sqlite.prepare('SELECT * FROM job_application_submission_evidence WHERE id = ?').get(evidence.id)); }
  function findSubmissionConfirmation(applicationId, input = {}) { const app = getApplication(bounded(applicationId, 160)); if (!app) throw new Error('Application not found.'); const jobRow = sqlite.prepare('SELECT * FROM job_opportunities WHERE id = ? AND deleted_at IS NULL').get(app.jobId); if (!jobRow) return null; const candidateEmail = getProfile()?.email || getExternalAccount(app.id)?.username || ''; const emails = sqlite.prepare('SELECT e.* FROM email_messages e JOIN email_job_links l ON l.email_id = e.id WHERE l.job_id = ? ORDER BY e.received_at ASC').all(app.jobId); const match = emails.map((email) => matchSubmissionConfirmation({ email: { ...email, id: email.id, recipients: email.recipients, receivedAt: email.received_at }, application: app, job: jobToRenderer(jobRow), candidateEmail, requestedAt: input.requestedAt || null, now: input.now || now() })).find(Boolean); return match ? { ...match, email: getEmail(match.emailId) } : null; }
  function recordSubmissionEmailMatch(input = {}) { const app = getApplication(bounded(input.applicationId, 160)); if (!app) throw new Error('Application not found.'); const evidence = sqlite.prepare('SELECT * FROM job_application_submission_evidence WHERE id = ? AND application_id = ?').get(bounded(input.evidenceId, 160), app.id); if (!evidence) throw new Error('Submission verification checkpoint not found.'); const match = input.match || {}; const stamp = now(); sqlite.prepare("UPDATE job_application_submission_evidence SET email_id = ?, email_signals_json = ?, confirmation_number = ?, status = 'verified', matched_at = ?, updated_at = ? WHERE id = ?").run(bounded(match.emailId, 160), JSON.stringify(Array.isArray(match.signals) ? match.signals.slice(0, 8) : []), bounded(match.confirmationNumber, 160), stamp, stamp, evidence.id); recordApplicationEvent({ applicationId: app.id, eventType: 'submission_email_matched', summary: 'Matching employer submission email found.', metadata: { evidenceId: evidence.id, emailId: bounded(match.emailId, 160), signals: Array.isArray(match.signals) ? match.signals.slice(0, 8) : [] } }); return submissionEvidenceToRenderer(sqlite.prepare('SELECT * FROM job_application_submission_evidence WHERE id = ?').get(evidence.id)); }
  function completeSubmission(input = {}) { const app = getApplication(bounded(input.applicationId, 160)); if (!app) throw new Error('Application not found.'); if (!input.userAcknowledged) throw new Error('User acknowledgment is required before recording submission.'); const checkpoint = sqlite.prepare("SELECT * FROM job_application_submission_evidence WHERE application_id = ? AND browser_state = 'confirmed' ORDER BY updated_at DESC LIMIT 1").get(app.id); if (!checkpoint) throw new Error('Confirmed browser submission evidence is required before Applied.'); let emailConfirmationId = bounded(input.emailConfirmationId, 160); if (!emailConfirmationId) { const match = findSubmissionConfirmation(app.id, { requestedAt: checkpoint.requested_at }); if (match) { recordSubmissionEmailMatch({ applicationId: app.id, evidenceId: checkpoint.id, match }); emailConfirmationId = match.emailId; } } if (!emailConfirmationId) throw new Error('A matching employer submission email is required before Applied.'); const evidence = sqlite.prepare("SELECT * FROM job_application_submission_evidence WHERE application_id = ? AND browser_state = 'confirmed' AND email_id = ? AND status = 'verified' ORDER BY updated_at DESC LIMIT 1").get(app.id, emailConfirmationId); if (!evidence) throw new Error('The matching submission email has not been verified for this application.'); const job = requirePipelineJob(app.jobId); if (JOB_STAGE_ORDER.indexOf(job.stage) >= JOB_STAGE_ORDER.indexOf('applied')) throw new Error('This application has already crossed the Applied boundary.'); const stamp = now(); const followUpDate = /^\d{4}-\d{2}-\d{2}$/.test(input.followUpDate || '') ? input.followUpDate : null; sqlite.transaction(() => { sqlite.prepare('UPDATE job_applications SET status = ?, submitted_at = ?, confirmation_number = ?, confirmation_url = ?, automation_state = ?, last_activity_at = ?, updated_at = ? WHERE id = ?').run('submitted', stamp, bounded(input.confirmationNumber || evidence.confirmation_number, 160), bounded(input.confirmationUrl || evidence.browser_confirmation_url, 2000), 'submitted', stamp, stamp, app.id); sqlite.prepare('UPDATE job_opportunities SET stage = ?, applied_at = ?, follow_up_date = ?, next_action = ?, updated_at = ? WHERE id = ?').run('applied', stamp.slice(0, 10), followUpDate, bounded(input.nextAction, 1000), stamp, app.jobId); recordApplicationEvent({ applicationId: app.id, eventType: 'submitted', summary: 'Browser and employer email confirmation verified; application moved to Applied.', metadata: { evidenceId: evidence.id, emailId: evidence.email_id, signals: parseObject(evidence.email_signals_json, []) } }); })(); const existingFollowUp = sqlite.prepare("SELECT id FROM job_follow_up_tasks WHERE job_id = ? AND status = 'open' AND deleted_at IS NULL AND title = ?").get(app.jobId, 'Watch for employer response'); if (!existingFollowUp) createJobFollowUp({ jobId: app.jobId, title: 'Watch for employer response', dueDate: followUpDate, sourceEmailId: evidence.email_id }); return getApplication(app.id); }
  function saveApplicationAnswer(input = {}) { const answer = validateAnswer(input); if (answer.scope === 'application' && !getApplication(bounded(answer.applicationId, 160))) throw new Error('Application not found.'); const stamp = now(); const record = { id: bounded(answer.id, 160) || id('application-answer'), application_id: answer.applicationId || null, question_key: answer.questionKey, question_text: answer.questionText, normalized_category: answer.normalizedCategory, answer_text: answer.answerText, answer_json: JSON.stringify(answer.answer ?? null), scope: answer.scope, sensitivity: answer.sensitivity, approval_status: answer.approvalStatus, autofill_policy: answer.autofillPolicy, provenance_json: JSON.stringify(answer.provenance), approved_at: answer.approvalStatus === 'approved' ? (answer.approvedAt || stamp) : null, created_at: stamp, updated_at: stamp, deleted_at: null }; sqlite.prepare('INSERT INTO job_application_answers (id, application_id, question_key, question_text, normalized_category, answer_text, answer_json, scope, sensitivity, approval_status, autofill_policy, provenance_json, approved_at, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET question_text=excluded.question_text, answer_text=excluded.answer_text, answer_json=excluded.answer_json, scope=excluded.scope, approval_status=excluded.approval_status, autofill_policy=excluded.autofill_policy, provenance_json=excluded.provenance_json, approved_at=excluded.approved_at, updated_at=excluded.updated_at').run(...Object.values(record)); return answerToRenderer(sqlite.prepare('SELECT * FROM job_application_answers WHERE id = ?').get(record.id)); }
  const policyToRenderer = (row) => row ? ({ ...row, answerId: row.answer_id, normalizedCategory: row.normalized_category, autofillPolicy: row.autofill_policy, matchingRules: parseObject(row.matching_rules_json), valueRules: parseObject(row.value_rules_json), approvedAt: row.approved_at, expiresAt: row.expires_at, createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at }) : null;
  function listApplicationAnswerPolicies() { return sqlite.prepare(`SELECT p.*, a.answer_text, a.answer_json, a.approval_status FROM application_answer_policies p JOIN job_application_answers a ON a.id = p.answer_id WHERE p.deleted_at IS NULL AND a.deleted_at IS NULL AND a.approval_status = 'approved' ORDER BY p.updated_at DESC`).all().map(policyToRenderer).map((row) => ({ ...row, answerText: row.answer_text, answer: parseObject(row.answer_json, null), approvalStatus: row.approval_status })); }
  function saveApplicationAnswerPolicy(input = {}) { const answerId = bounded(input.answerId, 160); const answer = sqlite.prepare("SELECT * FROM job_application_answers WHERE id = ? AND deleted_at IS NULL AND approval_status = 'approved'").get(answerId); if (!answer) throw new Error('Only an approved application answer can have an autofill policy.'); const policy = ['always', 'batch_review', 'ask', 'never'].includes(input.autofillPolicy) ? input.autofillPolicy : 'ask'; const stamp = now(); const record = { id: bounded(input.id, 160) || id('answer-policy'), answer_id: answerId, normalized_category: bounded(input.normalizedCategory || answer.normalized_category, 80), sensitivity: bounded(input.sensitivity || answer.sensitivity || 'normal', 40), autofill_policy: policy, scope: bounded(input.scope || 'job_applications', 80), matching_rules_json: JSON.stringify(input.matchingRules && typeof input.matchingRules === 'object' ? input.matchingRules : {}), value_rules_json: JSON.stringify(input.valueRules && typeof input.valueRules === 'object' ? input.valueRules : {}), approved_at: input.approvedAt || answer.approved_at || stamp, expires_at: input.expiresAt || null, created_at: stamp, updated_at: stamp, deleted_at: null }; sqlite.prepare('INSERT INTO application_answer_policies (id, answer_id, normalized_category, sensitivity, autofill_policy, scope, matching_rules_json, value_rules_json, approved_at, expires_at, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(answer_id) DO UPDATE SET normalized_category=excluded.normalized_category, sensitivity=excluded.sensitivity, autofill_policy=excluded.autofill_policy, scope=excluded.scope, matching_rules_json=excluded.matching_rules_json, value_rules_json=excluded.value_rules_json, approved_at=excluded.approved_at, expires_at=excluded.expires_at, updated_at=excluded.updated_at, deleted_at=NULL').run(...Object.values(record)); return listApplicationAnswerPolicies().find((entry) => entry.answerId === answerId) || null; }
  const workflowStepToRenderer = (row) => row ? ({ ...row, applicationId: row.application_id, jobId: row.job_id, checkpointVersion: row.checkpoint_version, stepOrder: row.step_order, stepKey: row.step_key, stepType: row.step_type, pageFingerprint: row.page_fingerprint, observationId: row.observation_id, observation: parseObject(row.observation_json), requiresUser: Boolean(row.requires_user), plan: parseObject(row.plan_json), execution: parseObject(row.execution_json), verification: parseObject(row.verification_json), reasonCode: row.reason_code, idempotencyKey: row.idempotency_key, createdAt: row.created_at, completedAt: row.completed_at }) : null;
  function saveWorkflowStep(input = {}) { const stamp = now(); const record = { id: bounded(input.id, 160) || id('workflow-step'), application_id: bounded(input.applicationId, 160), job_id: bounded(input.jobId, 160), attempt: Number(input.attempt) || 0, checkpoint_version: Number(input.checkpointVersion) || 0, step_order: Number(input.stepOrder) || 0, step_key: bounded(input.stepKey || input.plan?.stepKey || input.plan?.actionType, 160), step_type: bounded(input.stepType || input.plan?.stepType || input.plan?.actionType, 80), page_fingerprint: bounded(input.pageFingerprint || input.observation?.pageFingerprint || input.plan?.targetFingerprint, 240), observation_id: bounded(input.observationId || input.observation?.observationId, 160) || null, observation_json: JSON.stringify(sanitizeTraceValue(input.observation || {})), requires_user: input.requiresUser || input.result?.requiresUser ? 1 : 0, plan_json: JSON.stringify(sanitizeTraceValue(input.plan || {})), execution_json: JSON.stringify(sanitizeTraceValue(input.execution || {})), verification_json: JSON.stringify(sanitizeTraceValue(input.verification || {})), outcome: bounded(input.outcome, 80), reason_code: bounded(input.reasonCode, 120), source: bounded(input.source || 'deterministic_policy', 80), idempotency_key: bounded(input.idempotencyKey, 240), created_at: input.createdAt || stamp, completed_at: input.completedAt || stamp }; if (!record.application_id || !record.job_id || !record.step_key || !record.step_type || !record.idempotency_key) throw new Error('A workflow trace requires application, job, step, and idempotency identifiers.'); sqlite.prepare(`INSERT INTO application_workflow_steps (id,application_id,job_id,attempt,checkpoint_version,step_order,step_key,step_type,page_fingerprint,observation_id,observation_json,requires_user,plan_json,execution_json,verification_json,outcome,reason_code,source,idempotency_key,created_at,completed_at) VALUES (@id,@application_id,@job_id,@attempt,@checkpoint_version,@step_order,@step_key,@step_type,@page_fingerprint,@observation_id,@observation_json,@requires_user,@plan_json,@execution_json,@verification_json,@outcome,@reason_code,@source,@idempotency_key,@created_at,@completed_at) ON CONFLICT(idempotency_key) DO UPDATE SET observation_json=excluded.observation_json, requires_user=excluded.requires_user, execution_json=excluded.execution_json, verification_json=excluded.verification_json, outcome=excluded.outcome, reason_code=excluded.reason_code, completed_at=excluded.completed_at`).run(record); return workflowStepToRenderer(sqlite.prepare('SELECT * FROM application_workflow_steps WHERE idempotency_key = ?').get(record.idempotency_key)); }
  function listWorkflowSteps(applicationId) { return sqlite.prepare('SELECT * FROM application_workflow_steps WHERE application_id = ? ORDER BY created_at ASC').all(bounded(applicationId, 160)).map(workflowStepToRenderer); }
  function saveUnknownQuestion(input = {}) { const application = getApplication(bounded(input.applicationId, 160)); if (!application) throw new Error('Application not found.'); const questionKey = bounded(input.questionKey, 160).trim(); if (!questionKey) throw new Error('An unknown question key is required.'); const options = Array.isArray(input.options) ? input.options.slice(0, 50).map((option) => bounded(option, 500)) : []; const stamp = now(); const record = { id: id('unknown-question'), application_id: application.id, job_id: application.jobId, provider_host: bounded(input.providerHost, 253).toLowerCase(), page_fingerprint: bounded(input.pageFingerprint, 200), control_label: bounded(input.controlLabel, 500), control_type: bounded(input.controlType, 80), question_key: questionKey, question_text: bounded(input.questionText, 2000), options_json: JSON.stringify(options), status: 'open', answer_id: null, created_at: stamp, updated_at: stamp, resolved_at: null }; sqlite.prepare("INSERT INTO job_application_unknown_questions (id, application_id, job_id, provider_host, page_fingerprint, control_label, control_type, question_key, question_text, options_json, status, answer_id, created_at, updated_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(application_id, question_key) WHERE status = 'open' DO UPDATE SET question_text=excluded.question_text, options_json=excluded.options_json, updated_at=excluded.updated_at").run(...Object.values(record)); updateAutonomousApplicationState({ applicationId: application.id, state: 'needs_user_answer', checkpoint: { ...(application.automationCheckpoint || {}), questionKey } }); return sqlite.prepare("SELECT * FROM job_application_unknown_questions WHERE application_id = ? AND question_key = ? AND status = 'open'").get(application.id, questionKey); }
  function listUnknownQuestions(applicationId, status = 'open') { return sqlite.prepare("SELECT * FROM job_application_unknown_questions WHERE application_id = ? AND (? = 'all' OR status = ?) ORDER BY updated_at ASC").all(bounded(applicationId, 160), status, status).map((row) => ({ ...row, applicationId: row.application_id, jobId: row.job_id, providerHost: row.provider_host, pageFingerprint: row.page_fingerprint, controlLabel: row.control_label, controlType: row.control_type, questionKey: row.question_key, questionText: row.question_text, options: parseObject(row.options_json, []), answerId: row.answer_id, createdAt: row.created_at, updatedAt: row.updated_at, resolvedAt: row.resolved_at })); }
  const reusableQuestionKey = (question) => { const key = String(question.question_key || ''); if (!key.startsWith('safe-pass:')) return key; return String(question.control_label || question.question_text || key).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_./-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 160); };
  function resolveUnknownQuestion(input = {}) { const question = sqlite.prepare("SELECT * FROM job_application_unknown_questions WHERE id = ? AND status = 'open'").get(bounded(input.id, 160)); if (!question) throw new Error('Open unknown question not found.'); const application = getApplication(question.application_id); const answer = saveApplicationAnswer({ applicationId: question.application_id, questionKey: reusableQuestionKey(question), questionText: question.question_key.startsWith('safe-pass:') ? (question.control_label || question.question_text) : question.question_text, answerText: input.answerText, answer: input.answer, scope: input.scope || 'global', approvalStatus: input.approvalStatus || 'approved', provenance: input.provenance || [`user.answer:${question.id}`], normalizedCategory: input.normalizedCategory || 'application_question', autofillPolicy: input.autofillPolicy || 'always' }); const stamp = now(); sqlite.prepare("UPDATE job_application_unknown_questions SET status = 'resolved', answer_id = ?, updated_at = ?, resolved_at = ? WHERE id = ?").run(answer.id, stamp, stamp, question.id); recordApplicationEvent({ applicationId: question.application_id, eventType: 'unknown_question_resolved', summary: 'User supplied a reusable answer for an unknown application question.', metadata: { questionKey: question.question_key, reusableQuestionKey: answer.questionKey, answerId: answer.id } }); const remainingOpenQuestions = Number(sqlite.prepare("SELECT COUNT(*) AS count FROM job_application_unknown_questions WHERE application_id = ? AND status = 'open'").get(question.application_id).count); updateAutonomousApplicationState({ applicationId: question.application_id, state: remainingOpenQuestions ? 'needs_user_answer' : 'queued', checkpoint: { ...(application?.automationCheckpoint || {}), resumedFromQuestionId: question.id, answerResolvedAt: stamp, answerReadyForRetry: !remainingOpenQuestions, reasonCode: remainingOpenQuestions ? 'safe_pass_requires_review' : 'answer_saved_ready_for_retry' } }); return { ...answer, resolvedApplicationId: question.application_id }; }
  const AUTONOMOUS_ACTIVE_STATES = ['opening', 'detecting_form', 'creating_account', 'reusing_account', 'awaiting_activation', 'filling_profile', 'answering_questions', 'uploading_documents', 'navigating_form'];
  const autonomousUrl = (row) => row.external_application_url || row.application_url || '';
  const hasValidHttpsUrl = (value) => { try { return new URL(value).protocol === 'https:'; } catch { return false; } };
  const autonomousEligibility = (row) => {
    if (!row || row.stage !== 'ready' || row.deleted_at || !hasValidHttpsUrl(autonomousUrl(row))) return { eligible: false, reason: 'ready_https_required' };
    const selected = sqlite.prepare("SELECT document_type, status FROM job_application_documents WHERE application_id = ? AND is_selected = 1 AND deleted_at IS NULL AND document_type IN ('resume', 'cover_letter')").all(row.id);
    const approved = new Set(selected.filter((document) => document.status === 'approved').map((document) => document.document_type));
    if (!approved.has('resume') || !approved.has('cover_letter')) return { eligible: false, reason: 'approved_documents_required' };
    return { eligible: true, reason: '' };
  };
  function recoverAutonomousApplications() {
    const stamp = now(); const recovered = sqlite.prepare(`SELECT a.id, a.automation_state, a.automation_checkpoint_json FROM job_applications a JOIN job_opportunities j ON j.id = a.job_id WHERE a.deleted_at IS NULL AND (a.automation_state IN (${AUTONOMOUS_ACTIVE_STATES.map(() => '?').join(',')}) OR (a.automation_state = 'idle' AND j.stage = 'ready'))`).all(...AUTONOMOUS_ACTIVE_STATES);
    const recover = sqlite.transaction(() => recovered.forEach((row) => { const checkpoint = parseObject(row.automation_checkpoint_json, {}); const nextCheckpoint = { ...checkpoint, recoveredFrom: row.automation_state, recoveredAt: stamp, ...(row.automation_state === 'idle' ? { readyHandoff: 'legacy_idle_ready_recovered' } : { retryQueuedAt: stamp }) }; sqlite.prepare("UPDATE job_applications SET automation_state = 'queued', automation_checkpoint_json = ?, automation_next_retry_at = NULL, last_activity_at = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(nextCheckpoint), stamp, stamp, row.id); recordApplicationEvent({ applicationId: row.id, eventType: 'automation_recovered', summary: `Recovered autonomous work from ${row.automation_state} after restart.` }); }));
    recover(); return recovered.length;
  }
  function listAutonomousQueue() {
    // Older queue rows recorded protected/no-answer safe-pass outcomes as
    // ordinary queued work. Normalize them when the queue is read so they
    // become visible answer/review checkpoints instead of silently cycling.
    const reviewReasons = new Set(['protected_action', 'safe_pass_found_no_answerable_fields', 'safe_pass_complete_review_remaining_fields', 'safe_pass_retry_exhausted']);
    const legacyRows = sqlite.prepare("SELECT id, automation_state, automation_checkpoint_json FROM job_applications WHERE deleted_at IS NULL AND automation_state IN ('queued', 'failed')").all();
    const stamp = now();
    for (const row of legacyRows) {
      const checkpoint = parseObject(row.automation_checkpoint_json, {});
      if (!reviewReasons.has(checkpoint.reasonCode)) continue;
      const nextCheckpoint = { ...checkpoint, stage: 'form_review', reasonCode: 'safe_pass_requires_review', normalizedAt: stamp };
      sqlite.prepare("UPDATE job_applications SET automation_state = 'needs_user_answer', automation_checkpoint_json = ?, automation_next_retry_at = NULL, last_activity_at = ?, updated_at = ? WHERE id = ? AND automation_state IN ('queued', 'failed')").run(JSON.stringify(nextCheckpoint), stamp, stamp, row.id);
      recordApplicationEvent({ applicationId: row.id, eventType: 'automation_review_normalized', summary: 'Safe-pass blocker moved to the visible answer/review checkpoint.', metadata: { previousState: row.automation_state, previousReasonCode: checkpoint.reasonCode } });
    }
    // A historical cover-letter upload miss on a visibly optional control is
    // not a user question. Requeue only this exact stale shape when no real
    // unanswered question exists; required uploads and all other reviews stay put.
    const optionalCoverRows = sqlite.prepare("SELECT id, automation_checkpoint_json FROM job_applications WHERE deleted_at IS NULL AND automation_state = 'needs_user_answer'").all();
    for (const row of optionalCoverRows) {
      const checkpoint = parseObject(row.automation_checkpoint_json, {});
      const openQuestions = Number(sqlite.prepare("SELECT COUNT(*) AS count FROM job_application_unknown_questions WHERE application_id = ? AND status = 'open'").get(row.id).count);
      if (openQuestions || checkpoint.reasonCode !== 'safe_pass_requires_review' || !/Document upload incomplete:\s*cover_letter:missing/i.test(String(checkpoint.lastError || ''))) continue;
      const { lastError, failureClass, retryable, safePassFailedAt, ...requeuedCheckpoint } = checkpoint;
      const nextCheckpoint = { ...requeuedCheckpoint, stage: 'form_retry', reasonCode: 'optional_cover_letter_warning', uploadWarnings: [{ documentType: 'cover_letter', status: 'missing', optional: true }], optionalCoverLetterRecoveredAt: stamp };
      sqlite.prepare("UPDATE job_applications SET automation_state = 'queued', automation_checkpoint_json = ?, automation_next_retry_at = NULL, last_activity_at = ?, updated_at = ? WHERE id = ? AND automation_state = 'needs_user_answer'").run(JSON.stringify(nextCheckpoint), stamp, stamp, row.id);
      recordApplicationEvent({ applicationId: row.id, eventType: 'optional_cover_letter_requeued', summary: 'Optional cover-letter upload warning returned to the queue.', metadata: { previousReasonCode: checkpoint.reasonCode } });
    }
    // Required document failures and stale review rows with no unresolved
    // fields are workflow retry states, not questions. Keeping them out of
    // needs_user_answer prevents the answer modal from asking the user to
    // invent an answer when there is no employer question to answer.
    const staleReviewRows = sqlite.prepare("SELECT id, automation_state, automation_checkpoint_json FROM job_applications WHERE deleted_at IS NULL AND automation_state = 'needs_user_answer'").all();
    for (const row of staleReviewRows) {
      const checkpoint = parseObject(row.automation_checkpoint_json, {});
      const openQuestions = Number(sqlite.prepare("SELECT COUNT(*) AS count FROM job_application_unknown_questions WHERE application_id = ? AND status = 'open'").get(row.id).count);
      if (openQuestions) continue;
      const uploadFailure = /Document upload incomplete:/i.test(String(checkpoint.lastError || ''));
      const uploadRepairFailure = /AI document-upload repair/i.test(String(checkpoint.lastError || '')) || checkpoint.uploadRepair?.status === 'no_repair';
      const allUploadsVerified = Array.isArray(checkpoint.uploadResults) && checkpoint.uploadResults.length > 0 && checkpoint.uploadResults.every((entry) => entry.status === 'uploaded');
      if (!uploadFailure && !uploadRepairFailure && !(checkpoint.reasonCode === 'safe_pass_requires_review' && allUploadsVerified && Array.isArray(checkpoint.unresolvedFields) && checkpoint.unresolvedFields.length === 0)) continue;
      const nextCheckpoint = { ...checkpoint, stage: 'form_retry', reasonCode: uploadRepairFailure ? 'document_upload_repair_failed' : uploadFailure ? 'required_document_upload_failed' : 'safe_pass_no_question_retry', normalizedAt: stamp, retryable: true };
      const nextState = uploadFailure || uploadRepairFailure ? 'failed' : 'queued';
      sqlite.prepare("UPDATE job_applications SET automation_state = ?, automation_checkpoint_json = ?, automation_next_retry_at = NULL, last_activity_at = ?, updated_at = ? WHERE id = ? AND automation_state = 'needs_user_answer'").run(nextState, JSON.stringify(nextCheckpoint), stamp, stamp, row.id);
      recordApplicationEvent({ applicationId: row.id, eventType: 'automation_review_reclassified', summary: `Review checkpoint reclassified as ${nextState}; no unanswered employer question exists.`, metadata: { previousReasonCode: checkpoint.reasonCode, nextReasonCode: nextCheckpoint.reasonCode } });
    }
    return sqlite.prepare("SELECT a.*, j.company, j.role_title, j.stage, j.url AS job_url, j.canonical_url FROM job_applications a JOIN job_opportunities j ON j.id = a.job_id WHERE a.deleted_at IS NULL AND j.deleted_at IS NULL AND j.stage = 'ready' ORDER BY CASE a.automation_state WHEN 'opening' THEN 0 WHEN 'needs_user_answer' THEN 1 WHEN 'queued' THEN 2 ELSE 3 END, a.last_activity_at ASC").all().map((row) => {
      const eligibility = autonomousEligibility(row); const unknownQuestions = Number(sqlite.prepare("SELECT COUNT(*) AS count FROM job_application_unknown_questions WHERE application_id = ? AND status = 'open'").get(row.id).count);
      const checkpoint = parseObject(row.automation_checkpoint_json, {});
      const adapter = selectAdapter({ url: autonomousUrl(row), enableProviderAdapters: true });
      return { id: row.id, applicationId: row.id, jobId: row.job_id, company: row.company, roleTitle: row.role_title, jobStage: row.stage, url: autonomousUrl(row), automationState: row.automation_state, automationAttempt: row.automation_attempt, automationCheckpoint: checkpoint, batchApprovedAt: checkpoint.batchApprovedAt || '', automationNextRetryAt: row.automation_next_retry_at, unknownQuestionCount: unknownQuestions, eligible: eligibility.eligible, ineligibleReason: eligibility.reason, adapterKey: adapter.key, adapterMode: adapter.productionEnabled ? 'live-enabled' : (adapter.key === 'generic' ? 'generic-safe' : 'fixture-gated'), adapterProductionEnabled: Boolean(adapter.productionEnabled), confidence: Number(checkpoint.playbookConfidence) || 0, answerPolicyMode: checkpoint.answerPolicyMode || 'ask', calculatedSalary: checkpoint.calculatedSalary || null, answerProvenance: Array.isArray(checkpoint.answerProvenance) ? checkpoint.answerProvenance.slice(0, 8) : [], pauseReason: checkpoint.reasonCode || checkpoint.pauseReason || '', lastActivityAt: row.last_activity_at };
    });
  }
  function claimNextAutonomousApplication(input = {}) {
    const applicationId = bounded(input.applicationId, 160) || null;
    const candidate = sqlite.prepare("SELECT a.*, j.stage, j.url AS job_url, j.canonical_url FROM job_applications a JOIN job_opportunities j ON j.id = a.job_id WHERE a.deleted_at IS NULL AND j.deleted_at IS NULL AND j.stage = 'ready' AND a.automation_state = 'queued' AND (a.automation_next_retry_at IS NULL OR a.automation_next_retry_at <= ?) AND (? IS NULL OR a.id = ?) ORDER BY CASE WHEN a.automation_checkpoint_json LIKE '%retryQueuedAt%' THEN 0 WHEN a.automation_checkpoint_json LIKE '%manualRetryAt%' THEN 0 ELSE 1 END, a.last_activity_at ASC LIMIT 1").get(now(), applicationId, applicationId);
    if (!candidate) return null;
    const eligibility = autonomousEligibility(candidate); if (!eligibility.eligible) return null;
    const stamp = now(); const attempt = Number(candidate.automation_attempt || 0) + 1; const checkpoint = { ...parseObject(candidate.automation_checkpoint_json, {}), claimedAt: stamp, stage1Boundary: 'browser_execution_deferred_to_stage_2' };
    sqlite.transaction(() => { sqlite.prepare("UPDATE job_applications SET automation_state = 'opening', automation_attempt = ?, automation_checkpoint_json = ?, automation_next_retry_at = NULL, last_activity_at = ?, updated_at = ? WHERE id = ? AND automation_state = 'queued'").run(attempt, JSON.stringify(checkpoint), stamp, stamp, candidate.id); recordApplicationEvent({ applicationId: candidate.id, eventType: 'automation_claimed', summary: 'Stage 1 claimed one eligible application; browser execution is deferred to Stage 2.', metadata: { state: 'opening', attempt, checkpointKeys: Object.keys(checkpoint) } }); })();
    return getApplication(candidate.id);
  }
  function releaseAutonomousApplication(input = {}) {
    const application = getApplication(bounded(input.applicationId, 160)); if (!application) throw new Error('Application not found.');
    if (['submitting', 'verifying_confirmation', 'verifying_email_confirmation', 'submitted'].includes(application.automationState)) throw new Error('Final-submission states cannot be released automatically.');
    const nextState = input.state || 'queued'; assertAutonomousApplicationState(nextState); const stamp = now(); const checkpoint = input.checkpoint && typeof input.checkpoint === 'object' && !Array.isArray(input.checkpoint) ? input.checkpoint : application.automationCheckpoint;
    sqlite.prepare('UPDATE job_applications SET automation_state = ?, automation_checkpoint_json = ?, automation_next_retry_at = ?, last_activity_at = ?, updated_at = ? WHERE id = ?').run(nextState, JSON.stringify(checkpoint), input.nextRetryAt || null, stamp, stamp, application.id); recordApplicationEvent({ applicationId: application.id, eventType: 'automation_released', summary: `Autonomous application returned to ${nextState}.`, metadata: { state: nextState } }); return getApplication(application.id);
  }
  function externalAccountToRenderer(row) { return row ? { id: row.id, applicationId: row.application_id, host: row.host, username: row.username, status: row.status, credentialRef: row.credential_ref, createdAt: row.created_at, updatedAt: row.updated_at } : null; }
  function saveExternalAccount(input = {}) { const applicationId = bounded(input.applicationId, 160); if (!getApplication(applicationId)) throw new Error('Application not found.'); const host = bounded(input.host, 253).toLowerCase(); const username = bounded(input.username, 320); const credentialRef = bounded(input.credentialRef, 160); const status = ['saved', 'active', 'activation_required'].includes(input.status) ? input.status : 'saved'; if (!/^[a-z0-9.-]{1,253}$/.test(host) || !credentialRef || !username) throw new Error('A valid external account host, username, and credential reference are required.'); const stamp = now(); const current = sqlite.prepare('SELECT id FROM job_application_external_accounts WHERE application_id = ?').get(applicationId); const accountId = current?.id || id('external-account'); if (current) sqlite.prepare('UPDATE job_application_external_accounts SET host = ?, username = ?, credential_ref = ?, status = ?, updated_at = ? WHERE id = ?').run(host, username, credentialRef, status, stamp, accountId); else sqlite.prepare('INSERT INTO job_application_external_accounts (id, application_id, host, username, credential_ref, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(accountId, applicationId, host, username, credentialRef, status, stamp, stamp); recordApplicationEvent({ applicationId, eventType: 'external_account_saved', summary: `External application account saved for ${host}.`, metadata: { host, username, status } }); return externalAccountToRenderer(sqlite.prepare('SELECT * FROM job_application_external_accounts WHERE id = ?').get(accountId)); }
  function getExternalAccount(applicationId) { return externalAccountToRenderer(sqlite.prepare('SELECT * FROM job_application_external_accounts WHERE application_id = ?').get(bounded(applicationId, 160))); }
  function findExternalAccountByIdentity(input = {}) { const host = bounded(input.host, 253).toLowerCase(); const username = bounded(input.username, 320); return externalAccountToRenderer(sqlite.prepare('SELECT * FROM job_application_external_accounts WHERE lower(host) = ? AND lower(username) = ? ORDER BY updated_at DESC LIMIT 1').get(host, username.toLowerCase())); }
  function activationAttemptToRenderer(row) { return row ? { id: row.id, applicationId: row.application_id, host: row.host, recipient: row.recipient, status: row.status, messageId: row.message_id, activationUrlRedacted: row.activation_url_redacted, hasCode: Boolean(row.code_hash), signals: parseObject(row.signals_json, []), requestedAt: row.requested_at, matchedAt: row.matched_at, usedAt: row.used_at, createdAt: row.created_at, updatedAt: row.updated_at } : null; }
  function recordActivationAttempt(input = {}) { const applicationId = bounded(input.applicationId, 160); if (!getApplication(applicationId)) throw new Error('Application not found.'); const status = ['pending', 'matched', 'used', 'failed'].includes(input.status) ? input.status : 'pending'; const stamp = now(); const record = { id: bounded(input.id, 160) || id('activation'), application_id: applicationId, host: bounded(input.host, 253).toLowerCase(), recipient: bounded(input.recipient, 320), status, message_id: bounded(input.messageId, 160), activation_url_redacted: bounded(input.activationUrlRedacted, 1000), code_hash: bounded(input.codeHash, 128), signals_json: JSON.stringify(Array.isArray(input.signals) ? input.signals.slice(0, 8).map((entry) => bounded(entry, 80)) : []), requested_at: input.requestedAt || stamp, matched_at: status === 'matched' || status === 'used' ? (input.matchedAt || stamp) : null, used_at: status === 'used' ? (input.usedAt || stamp) : null, created_at: stamp, updated_at: stamp }; sqlite.prepare(`INSERT INTO job_application_activation_attempts (id, application_id, host, recipient, status, message_id, activation_url_redacted, code_hash, signals_json, requested_at, matched_at, used_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, message_id=excluded.message_id, activation_url_redacted=excluded.activation_url_redacted, code_hash=excluded.code_hash, signals_json=excluded.signals_json, matched_at=excluded.matched_at, used_at=excluded.used_at, updated_at=excluded.updated_at`).run(...Object.values(record)); recordApplicationEvent({ applicationId, eventType: `activation_${status}`, summary: `Employer account activation is ${status}.`, metadata: { host: record.host, messageId: record.message_id, activationUrlRedacted: record.activation_url_redacted, hasCode: Boolean(record.code_hash), signals: JSON.parse(record.signals_json) } }); return activationAttemptToRenderer(sqlite.prepare('SELECT * FROM job_application_activation_attempts WHERE id = ?').get(record.id)); }
  function getActivationAttempt(applicationId) { return activationAttemptToRenderer(sqlite.prepare('SELECT * FROM job_application_activation_attempts WHERE application_id = ? ORDER BY updated_at DESC LIMIT 1').get(bounded(applicationId, 160))); }
  // Keep the renderer DTO camel-cased, including export-ready renderings.  The
  // PDF IPC handler receives this DTO, so omitting these aliases produced PDFs
  // containing the literal text "undefined" despite valid stored HTML.
  const documentToRenderer = (row) => row ? ({ ...row, applicationId: row.application_id, documentType: row.document_type, content: parseObject(row.content_json), plainText: row.plain_text, htmlText: row.html_text, provenance: jsonField(row.provenance_json), validation: parseObject(row.validation_json), sourceResumeVersion: row.source_resume_version, modelName: row.model_name, promptVersion: row.prompt_version, isSelected: Boolean(row.is_selected), exportedPdfPath: row.exported_pdf_path, exportedTextPath: row.exported_text_path, createdAt: row.created_at, updatedAt: row.updated_at }) : null;
  function requireEditableApplicationDocument(applicationId, { allowReadyMasterRefresh = false } = {}) {
    const application = getApplication(applicationId);
    if (!application) throw new Error('Application not found.');
    const job = sqlite.prepare('SELECT stage FROM job_opportunities WHERE id = ? AND deleted_at IS NULL').get(application.jobId);
    if (job && JOB_STAGE_ORDER.indexOf(job.stage) >= JOB_STAGE_ORDER.indexOf('ready') && !allowReadyMasterRefresh) throw new Error('Application documents are locked after both documents are selected and the job is Ready to apply.');
    return application;
  }
  function saveDocument(input = {}) { if (!DOCUMENT_TYPES.has(input.documentType)) throw new Error('Invalid document type.'); requireEditableApplicationDocument(input.applicationId, { allowReadyMasterRefresh: Boolean(input.allowReadyMasterRefresh) }); const stamp = now(); const content = input.content && typeof input.content === 'object' ? input.content : {}; const validation = input.validation && typeof input.validation === 'object' ? input.validation : {}; const version = Number.isInteger(input.version) ? input.version : Number(sqlite.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS next FROM job_application_documents WHERE application_id = ? AND document_type = ?').get(input.applicationId, input.documentType).next); const record = { id: bounded(input.id, 160) || id('document'), application_id: bounded(input.applicationId, 160), document_type: input.documentType, version, status: STATUSES.has(input.status) ? input.status : 'draft', title: bounded(input.title, 500), content_json: JSON.stringify(content), plain_text: bounded(input.plainText || renderPlainText(input.documentType, content), 100000), html_text: bounded(input.htmlText || renderHtml(input.documentType, content), 150000), provenance_json: JSON.stringify(Array.isArray(input.provenance) ? input.provenance : []), validation_json: JSON.stringify(validation), source_resume_version: Number.isInteger(input.sourceResumeVersion) ? input.sourceResumeVersion : null, model_name: bounded(input.modelName, 200), prompt_version: bounded(input.promptVersion, 100), is_selected: 0, exported_pdf_path: bounded(input.exportedPdfPath, 2000), exported_text_path: bounded(input.exportedTextPath, 2000), created_at: stamp, updated_at: stamp, deleted_at: null }; sqlite.prepare('INSERT INTO job_application_documents (id, application_id, document_type, version, status, title, content_json, plain_text, html_text, provenance_json, validation_json, source_resume_version, model_name, prompt_version, is_selected, exported_pdf_path, exported_text_path, created_at, updated_at, deleted_at) VALUES (@id,@application_id,@document_type,@version,@status,@title,@content_json,@plain_text,@html_text,@provenance_json,@validation_json,@source_resume_version,@model_name,@prompt_version,@is_selected,@exported_pdf_path,@exported_text_path,@created_at,@updated_at,@deleted_at)').run(record); return documentToRenderer(sqlite.prepare('SELECT * FROM job_application_documents WHERE id = ?').get(record.id)); }
  function listDocuments(applicationId, documentType) { return sqlite.prepare(`SELECT * FROM job_application_documents WHERE application_id = ? AND deleted_at IS NULL ${documentType ? 'AND document_type = ?' : ''} ORDER BY document_type, version DESC`).all(...(documentType ? [applicationId, documentType] : [applicationId])).map(documentToRenderer); }
  function resetApplicationDocuments(applicationId) {
    const application = sqlite.prepare('SELECT id, job_id, application_folder_path, selected_resume_path, selected_cover_letter_path FROM job_applications WHERE id = ? AND deleted_at IS NULL').get(bounded(applicationId, 160));
    if (!application) throw new Error('Application not found.');
    let filesRemoved = 0;
    const job = sqlite.prepare('SELECT * FROM job_opportunities WHERE id = ? AND deleted_at IS NULL').get(application.job_id);
    const jobRecord = job && jobToRenderer(job);
    const folders = new Set([application.application_folder_path].filter(Boolean));
    if (jobRecord) {
      folders.add(applicationFilePaths(documentsRoot, jobRecord, application.id).folderPath);
      // Early workspaces were named with the job ID, not the application ID.
      // Keep this compatibility cleanup narrowly scoped to that known folder.
      folders.add(applicationExportDirectory(documentsRoot, jobRecord, jobRecord.id));
    }
    for (const folderPath of folders) {
      if (!fs.existsSync(folderPath)) continue;
      for (const target of [path.join(folderPath, 'Versions'), application.selected_resume_path, application.selected_cover_letter_path]) {
        if (target && fs.existsSync(target)) {
          fs.rmSync(target, { recursive: true, force: true });
          filesRemoved += 1;
        }
      }
      for (const entry of fs.readdirSync(folderPath, { withFileTypes: true })) {
        if (entry.isFile() && /^(?:Resume|Cover Letter) - v\d+\.(?:pdf|txt)$/i.test(entry.name)) {
          fs.rmSync(path.join(folderPath, entry.name), { force: true });
          filesRemoved += 1;
        }
      }
    }
    const documentCount = Number(sqlite.prepare('SELECT COUNT(*) AS count FROM job_application_documents WHERE application_id = ?').get(application.id).count || 0);
    sqlite.transaction(() => {
      sqlite.prepare('DELETE FROM job_application_documents WHERE application_id = ?').run(application.id);
      sqlite.prepare("UPDATE job_opportunities SET stage = 'researching', updated_at = ? WHERE id = ? AND stage = 'ready'").run(now(), application.job_id);
    })();
    return { applicationId: application.id, documentsRemoved: documentCount, filesRemoved };
  }
  function getDocument(documentId) { return documentToRenderer(sqlite.prepare('SELECT * FROM job_application_documents WHERE id = ? AND deleted_at IS NULL').get(documentId)); }
  function updateDocument(documentId, changes = {}) { const current = getDocument(documentId); if (!current) throw new Error('Document not found.'); requireEditableApplicationDocument(current.applicationId); const content = changes.content || current.content; const validation = changes.validation || current.validation; sqlite.prepare('UPDATE job_application_documents SET status = ?, content_json = ?, plain_text = ?, html_text = ?, provenance_json = ?, validation_json = ?, updated_at = ? WHERE id = ?').run(STATUSES.has(changes.status) ? changes.status : current.status, JSON.stringify(content), renderPlainText(current.documentType, content), renderHtml(current.documentType, content), JSON.stringify(changes.provenance || current.provenance), JSON.stringify(validation), now(), documentId); return getDocument(documentId); }
  function selectDocument(documentId, { allowReadyMasterRefresh = false, allowValidationOverride = false } = {}) {
    const current = getDocument(documentId); if (!current) throw new Error('Document not found.');
    requireEditableApplicationDocument(current.applicationId, { allowReadyMasterRefresh });
    if (!allowValidationOverride && (current.status !== 'approved' || current.validation.errors?.length)) throw new Error('Only approved, error-free documents can be selected.');
    let movedToReady = false; let readyJobId = null;
    sqlite.transaction(() => {
      sqlite.prepare('UPDATE job_application_documents SET is_selected = 0, status = CASE WHEN is_selected = 1 THEN \'superseded\' ELSE status END, updated_at = ? WHERE application_id = ? AND document_type = ? AND deleted_at IS NULL').run(now(), current.applicationId, current.documentType);
      const provenance = allowValidationOverride ? JSON.stringify([...(current.provenance || []), 'manual_selection_override']) : null;
      sqlite.prepare('UPDATE job_application_documents SET is_selected = 1, status = \'approved\', provenance_json = COALESCE(?, provenance_json), updated_at = ? WHERE id = ?').run(provenance, now(), documentId);
      const job = sqlite.prepare('SELECT id, stage FROM job_opportunities WHERE id = (SELECT job_id FROM job_applications WHERE id = ?)').get(current.applicationId);
      if (job?.stage === 'researching' && hasSelectedApplicationDocuments(job.id)) {
        sqlite.prepare("UPDATE job_opportunities SET stage = 'ready', updated_at = ? WHERE id = ?").run(now(), job.id);
        movedToReady = true; readyJobId = job.id;
      }
    })();
    const application = getApplication(current.applicationId);
    const job = sqlite.prepare('SELECT * FROM job_opportunities WHERE id = ?').get(application.jobId);
    const files = ensureApplicationFileStructure(documentsRoot, jobToRenderer(job), application.id);
    const sourcePath = current.documentType === 'resume' ? current.exportedPdfPath : current.exportedPdfPath;
    // Selection is persisted by opportunity and the stable Selected filename is
    // deliberately independent of version. If a PDF was already exported,
    // copy it into the opportunity's selected slot; otherwise the resolver
    // reports a missing file instead of borrowing another opportunity's file.
    const selectedPath = current.documentType === 'resume' ? files.selectedResumePath : files.selectedCoverLetterPath;
    if (sourcePath && fs.existsSync(sourcePath)) {
      const versionDirectory = current.documentType === 'resume' ? files.versionsResumesDirectory : files.versionsCoverLettersDirectory;
      const versionPath = path.join(versionDirectory, `${current.documentType === 'resume' ? 'Resume' : 'Cover Letter'}-v${current.version}.pdf`);
      fs.copyFileSync(sourcePath, versionPath);
      fs.copyFileSync(sourcePath, selectedPath);
    } else if (fs.existsSync(selectedPath)) fs.unlinkSync(selectedPath);
    if (movedToReady) {
      recordJobActivity(readyJobId, 'documents_ready', 'Resume and cover letter selected; opportunity is ready to apply.');
      const readyApplication = getApplication(current.applicationId);
      // Document preparation is the handoff into the browser queue. Older
      // records may still have the pre-automation `idle` state, so normalize
      // every newly Ready application to a claimable queued checkpoint here.
      if (readyApplication && !['submitted', 'verifying_confirmation', 'verifying_email_confirmation'].includes(readyApplication.automationState)) {
        updateAutonomousApplicationState({ applicationId: readyApplication.id, state: 'queued', checkpoint: { ...readyApplication.automationCheckpoint, readyHandoffAt: now(), readyHandoff: 'documents_selected' } });
      }
    }
    return getDocument(documentId);
  }
  function selectMasterResume(applicationId) {
    const application = requireEditableApplicationDocument(applicationId, { allowReadyMasterRefresh: true });
    const resume = getResume();
    if (!resume || (!resume.rawText && !resume.experience?.length && !resume.skills?.length)) throw new Error('Save a master resume before selecting it for an application.');
    const existing = sqlite.prepare("SELECT id FROM job_application_documents WHERE application_id = ? AND document_type = 'resume' AND model_name = 'master_resume' AND source_resume_version = ? AND deleted_at IS NULL ORDER BY version DESC LIMIT 1").get(application.id, resume.version);
    const content = masterResumeContent(resume);
    const existingDocument = existing && getDocument(existing.id);
    if (existingDocument) {
      if (isInternalResumeHeading(existingDocument.content?.headline) || existingDocument.content?.summary?.[0]?.text?.split(/\r?\n/)[0]?.trim() === content.headline) repairMasterResumeDocument(existingDocument, content);
      if (masterResumeSourcePath && resume.sourceType === 'pdf' && fs.existsSync(masterResumeSourcePath)) {
        sqlite.prepare('UPDATE job_application_documents SET exported_pdf_path = ?, updated_at = ? WHERE id = ?').run(masterResumeSourcePath, now(), existingDocument.id);
      }
      return selectDocument(existing.id, { allowReadyMasterRefresh: true });
    }
    // The master path is a source-file copy operation. Keep a document record
    // for application state and auditability, but never regenerate or rewrite
    // the uploaded PDF when the user explicitly chooses “Use master resume.”
    const document = saveDocument({ applicationId: application.id, documentType: 'resume', title: 'Master resume', content, validation: { valid: true, errors: [] }, provenance: ['master_resume'], sourceResumeVersion: resume.version, modelName: 'master_resume', promptVersion: 'master_resume', status: 'approved', exportedPdfPath: masterResumeSourcePath && resume.sourceType === 'pdf' && fs.existsSync(masterResumeSourcePath) ? masterResumeSourcePath : '', allowReadyMasterRefresh: true });
    return selectDocument(document.id, { allowReadyMasterRefresh: true });
  }
  function approveDocument(documentId) { const current = getDocument(documentId); if (!current) throw new Error('Document not found.'); requireEditableApplicationDocument(current.applicationId); if (current.validation.errors?.length || current.validation.valid === false) throw new Error('Documents with validation errors cannot be approved.'); sqlite.prepare('UPDATE job_application_documents SET status = \'approved\', updated_at = ? WHERE id = ?').run(now(), documentId); return getDocument(documentId); }
  function markDocumentExport(documentId, paths = {}) { const current = getDocument(documentId); if (!current) throw new Error('Document not found.'); sqlite.prepare('UPDATE job_application_documents SET exported_pdf_path = COALESCE(?, exported_pdf_path), exported_text_path = COALESCE(?, exported_text_path), updated_at = ? WHERE id = ?').run(paths.pdfPath || null, paths.textPath || null, now(), documentId); return getDocument(documentId); }
  function resolveApplicationFile(applicationId, documentType) { const application = ensureApplicationFiles(applicationId); const selectedPath = documentType === 'resume' ? application.selectedResumePath : documentType === 'cover_letter' ? application.selectedCoverLetterPath : ''; if (!selectedPath) throw new Error('Invalid application document type.'); if (!fs.existsSync(selectedPath)) return { exists: false, path: selectedPath, message: `No selected ${documentType === 'resume' ? 'resume' : 'cover letter'} exists for this opportunity. Select or generate one before continuing.` }; return { exists: true, path: selectedPath, message: '' }; }
  function validateTaskHierarchy(record) {
    const project = db.select().from(projects).where(eq(projects.id, record.projectId)).get();
    if (!project || project.kind !== 'project') throw new Error('Task must belong to a real project.');
    if (record.releaseId) {
      const release = db.select().from(projects).where(eq(projects.id, record.releaseId)).get();
      if (!release || release.kind !== 'release' || release.parentId !== record.projectId) throw new Error('Task release does not belong to its project.');
    }
    if (record.phaseId) {
      const phase = db.select().from(projects).where(eq(projects.id, record.phaseId)).get();
      if (!phase || phase.kind !== 'phase' || phase.parentId !== record.releaseId) throw new Error('Task phase does not belong to its release.');
    }
    if (record.parentTaskId) {
      const parent = db.select().from(tasks).where(eq(tasks.id, record.parentTaskId)).get();
      if (!parent || parent.parentTaskId || parent.projectId !== record.projectId) throw new Error('Subtask parent must be a top-level task in the same project.');
      if ((parent.releaseId || null) !== (record.releaseId || null) || (parent.phaseId || null) !== (record.phaseId || null)) throw new Error('Subtask must share its parent task context.');
    }
  }

  function repairWorkspaceHierarchy() {
    const markerKey = 'workspace_hierarchy_repair_v1';
    const marker = db.select().from(userSettings).where(eq(userSettings.key, markerKey)).get();
    if (marker) return { repaired: [], marker: JSON.parse(marker.value) };
    const invalid = db.select({ id: projects.id, title: projects.title, parentId: projects.parentId }).from(projects).where(and(eq(projects.kind, 'workspace'), isNull(projects.deletedAt))).all().filter((entry) => entry.parentId);
    const repairedAt = now();
    db.transaction((tx) => {
      for (const entry of invalid) tx.update(projects).set({ parentId: null, updatedAt: repairedAt }).where(eq(projects.id, entry.id)).run();
      tx.insert(userSettings).values({ key: markerKey, value: JSON.stringify({ version: 1, repairedAt, repaired: invalid }), updatedAt: repairedAt }).run();
    });
    return { repaired: invalid, marker: { version: 1, repairedAt, repaired: invalid } };
  }

  const playbookToRenderer = (row) => row ? ({ ...row, siteHost: row.site_host, atsKey: row.ats_key, workflowKind: row.workflow_kind, playbookJson: parseObject(row.playbook_json), successCount: row.success_count, failureCount: row.failure_count, lastSuccessAt: row.last_success_at, lastFailureAt: row.last_failure_at, lastRepairAt: row.last_repair_at, createdAt: row.created_at, updatedAt: row.updated_at }) : null;
  const playbookStepToRenderer = (row) => row ? ({ ...row, playbookId: row.playbook_id, stepOrder: row.step_order, stepKey: row.step_key, pageType: row.page_type, pageFingerprint: row.page_fingerprint, actionType: row.action_type, target: parseObject(row.target_json), arguments: parseObject(row.arguments_json), verification: parseObject(row.verification_json), safetyClass: row.safety_class, successCount: row.success_count, failureCount: row.failure_count, createdAt: row.created_at, updatedAt: row.updated_at }) : null;
  function listPlaybooks(input = {}) { return sqlite.prepare("SELECT * FROM application_site_playbooks WHERE deleted_at IS NULL AND site_host = ? AND ats_key = ? AND workflow_kind = ? ORDER BY confidence DESC, version DESC").all(bounded(input.siteHost, 253).toLowerCase(), bounded(input.atsKey, 80), bounded(input.workflowKind || 'job_application', 80)).map(playbookToRenderer); }
  function savePlaybook(input = {}) {
    const stamp = now(); const current = sqlite.prepare('SELECT * FROM application_site_playbooks WHERE id = ?').get(bounded(input.id, 160));
    const record = { id: bounded(input.id, 160) || id('playbook'), site_host: bounded(input.siteHost, 253).toLowerCase(), ats_key: bounded(input.atsKey, 80), workflow_kind: bounded(input.workflowKind || 'job_application', 80), version: Number.isInteger(input.version) ? input.version : 1, status: ['draft', 'candidate', 'verified', 'degraded', 'disabled'].includes(input.status) ? input.status : 'candidate', confidence: Math.max(0, Math.min(1, Number(input.confidence) || 0)), playbook_json: JSON.stringify(input.playbookJson && typeof input.playbookJson === 'object' ? input.playbookJson : {}), source: bounded(input.source || 'ai_repair', 80), success_count: Number(input.successCount) || 0, failure_count: Number(input.failureCount) || 0, last_success_at: input.lastSuccessAt || null, last_failure_at: input.lastFailureAt || null, last_repair_at: input.lastRepairAt || null, created_at: current?.created_at || input.createdAt || stamp, updated_at: stamp, deleted_at: null };
    sqlite.prepare(`INSERT INTO application_site_playbooks (id, site_host, ats_key, workflow_kind, version, status, confidence, playbook_json, source, success_count, failure_count, last_success_at, last_failure_at, last_repair_at, created_at, updated_at, deleted_at) VALUES (@id,@site_host,@ats_key,@workflow_kind,@version,@status,@confidence,@playbook_json,@source,@success_count,@failure_count,@last_success_at,@last_failure_at,@last_repair_at,@created_at,@updated_at,@deleted_at) ON CONFLICT(id) DO UPDATE SET status=excluded.status, confidence=excluded.confidence, playbook_json=excluded.playbook_json, source=excluded.source, success_count=excluded.success_count, failure_count=excluded.failure_count, last_success_at=excluded.last_success_at, last_failure_at=excluded.last_failure_at, last_repair_at=excluded.last_repair_at, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at`).run(record);
    return playbookToRenderer(sqlite.prepare('SELECT * FROM application_site_playbooks WHERE id = ?').get(record.id));
  }
  function listPlaybookSteps(playbookId) { return sqlite.prepare('SELECT * FROM application_playbook_steps WHERE playbook_id = ? AND deleted_at IS NULL ORDER BY step_order ASC').all(bounded(playbookId, 160)).map(playbookStepToRenderer); }
  function savePlaybookStep(input = {}) {
    const playbookId = bounded(input.playbookId, 160); const stepKey = bounded(input.stepKey, 160);
    if (!playbookId || !stepKey) throw new Error('A playbook step requires a playbook and logical step key.');
    const findCurrent = sqlite.prepare('SELECT * FROM application_playbook_steps WHERE playbook_id = ? AND step_key = ? AND deleted_at IS NULL LIMIT 1');
    const updateCurrent = sqlite.prepare('UPDATE application_playbook_steps SET page_type=@page_type, page_fingerprint=@page_fingerprint, action_type=@action_type, target_json=@target_json, arguments_json=@arguments_json, verification_json=@verification_json, safety_class=@safety_class, confidence=@confidence, success_count=@success_count, failure_count=@failure_count, updated_at=@updated_at, deleted_at=NULL WHERE id=@id');
    const insertCurrent = sqlite.prepare('INSERT INTO application_playbook_steps (id,playbook_id,step_order,step_key,page_type,page_fingerprint,action_type,target_json,arguments_json,verification_json,safety_class,confidence,success_count,failure_count,created_at,updated_at,deleted_at) VALUES (@id,@playbook_id,@step_order,@step_key,@page_type,@page_fingerprint,@action_type,@target_json,@arguments_json,@verification_json,@safety_class,@confidence,@success_count,@failure_count,@created_at,@updated_at,@deleted_at)');
    const save = sqlite.transaction(() => {
      const buildRecord = (current) => {
        const successIncrement = Math.max(0, Number(input.successIncrement) || 0); const failureIncrement = Math.max(0, Number(input.failureIncrement) || 0);
        return { id: current?.id || bounded(input.id, 160) || id('playbook-step'), playbook_id: playbookId, step_order: current?.step_order ?? (Number(input.stepOrder) || 0), step_key: stepKey, page_type: bounded(input.pageType, 80), page_fingerprint: bounded(input.pageFingerprint, 240), action_type: bounded(input.actionType, 80), target_json: JSON.stringify(input.target && typeof input.target === 'object' ? input.target : {}), arguments_json: JSON.stringify(input.arguments && typeof input.arguments === 'object' ? input.arguments : {}), verification_json: JSON.stringify(input.verification && typeof input.verification === 'object' ? input.verification : {}), safety_class: bounded(input.safetyClass || 'safe_navigation', 80), confidence: Math.max(Number(current?.confidence) || 0, Math.min(1, Math.max(0, Number(input.confidence) || 0))), success_count: Math.max(Number(current?.success_count) || 0, Math.max(0, Number(input.successCount) || 0)) + successIncrement, failure_count: Math.max(Number(current?.failure_count) || 0, Math.max(0, Number(input.failureCount) || 0)) + failureIncrement, created_at: current?.created_at || input.createdAt || now(), updated_at: now(), deleted_at: null };
      };
      let current = findCurrent.get(playbookId, stepKey); let record = buildRecord(current);
      if (current) { updateCurrent.run(record); return record.id; }
      try { insertCurrent.run(record); return record.id; } catch (error) {
        // A competing writer can insert after our read. Re-read logical identity
        // and update it so a transient race never becomes an application error.
        if (!/UNIQUE constraint failed/i.test(String(error?.message || ''))) throw error;
        current = findCurrent.get(playbookId, stepKey); if (!current) throw error;
        record = buildRecord(current); updateCurrent.run(record); return record.id;
      }
    });
    const savedId = save(); return playbookStepToRenderer(sqlite.prepare('SELECT * FROM application_playbook_steps WHERE id = ?').get(savedId));
  }
  const playbookLearningRetryToRenderer = (row) => row ? ({ ...row, applicationId: row.application_id, siteHost: row.site_host, atsKey: row.ats_key, workflowKind: row.workflow_kind, stepKey: row.step_key, pageFingerprint: row.page_fingerprint, plan: parseObject(row.plan_json), attemptCount: row.attempt_count, nextRetryAt: row.next_retry_at, lastError: row.last_error, createdAt: row.created_at, updatedAt: row.updated_at, resolvedAt: row.resolved_at }) : null;
  function queuePlaybookLearningRetry(input = {}) { const applicationId = bounded(input.applicationId, 160); const workflowKind = bounded(input.workflowKind || 'job_application', 80); const stepKey = bounded(input.stepKey || input.plan?.stepId || input.plan?.stepKey || input.plan?.actionType, 160); if (!applicationId || !stepKey) throw new Error('A deferred playbook learning record requires an application and logical step key.'); const stamp = now(); const current = sqlite.prepare('SELECT * FROM application_playbook_learning_retries WHERE application_id = ? AND workflow_kind = ? AND step_key = ? AND resolved_at IS NULL LIMIT 1').get(applicationId, workflowKind, stepKey); const record = { id: current?.id || bounded(input.id, 160) || id('playbook-learning-retry'), application_id: applicationId, site_host: bounded(input.siteHost, 253).toLowerCase(), ats_key: bounded(input.atsKey, 80), workflow_kind: workflowKind, step_key: stepKey, page_fingerprint: bounded(input.pageFingerprint, 240), plan_json: JSON.stringify(input.plan && typeof input.plan === 'object' ? input.plan : {}), source: bounded(input.source || 'ai_repair', 80), last_error: bounded(input.lastError, 1000), attempt_count: Math.max(0, Number(current?.attempt_count) || 0) + 1, next_retry_at: input.nextRetryAt || null, created_at: current?.created_at || stamp, updated_at: stamp, resolved_at: null }; if (current) sqlite.prepare('UPDATE application_playbook_learning_retries SET site_host=@site_host, ats_key=@ats_key, page_fingerprint=@page_fingerprint, plan_json=@plan_json, source=@source, last_error=@last_error, attempt_count=@attempt_count, next_retry_at=@next_retry_at, updated_at=@updated_at, resolved_at=NULL WHERE id=@id').run(record); else sqlite.prepare('INSERT INTO application_playbook_learning_retries (id,application_id,site_host,ats_key,workflow_kind,step_key,page_fingerprint,plan_json,source,last_error,attempt_count,next_retry_at,created_at,updated_at,resolved_at) VALUES (@id,@application_id,@site_host,@ats_key,@workflow_kind,@step_key,@page_fingerprint,@plan_json,@source,@last_error,@attempt_count,@next_retry_at,@created_at,@updated_at,@resolved_at)').run(record); return playbookLearningRetryToRenderer(sqlite.prepare('SELECT * FROM application_playbook_learning_retries WHERE id = ?').get(record.id)); }
  function listPendingPlaybookLearningRetries(limit = 20) { return sqlite.prepare("SELECT * FROM application_playbook_learning_retries WHERE resolved_at IS NULL AND (next_retry_at IS NULL OR next_retry_at <= ?) ORDER BY updated_at ASC LIMIT ?").all(now(), Math.max(1, Math.min(100, Number(limit) || 20))).map(playbookLearningRetryToRenderer); }
  function resolvePlaybookLearningRetry(idValue) { const retryId = bounded(idValue, 160); const stamp = now(); sqlite.prepare('UPDATE application_playbook_learning_retries SET resolved_at = ?, updated_at = ? WHERE id = ? AND resolved_at IS NULL').run(stamp, stamp, retryId); return playbookLearningRetryToRenderer(sqlite.prepare('SELECT * FROM application_playbook_learning_retries WHERE id = ?').get(retryId)); }
  const playbookRepairToRenderer = (row) => row ? ({ ...row, playbookId: row.playbook_id, applicationId: row.application_id, pageFingerprint: row.page_fingerprint, failedStepKey: row.failed_step_key, observation: parseObject(row.observation_json), proposedPlan: parseObject(row.proposed_plan_json), validation: parseObject(row.validation_json), execution: parseObject(row.execution_json), verification: parseObject(row.verification_json), modelName: row.model_name, promptVersion: row.prompt_version, createdAt: row.created_at, updatedAt: row.updated_at }) : null;
  function savePlaybookRepair(input = {}) {
    const stamp = now(); const record = { id: bounded(input.id, 160) || id('playbook-repair'), playbook_id: input.playbookId ? bounded(input.playbookId, 160) : null, application_id: bounded(input.applicationId, 160), page_fingerprint: bounded(input.pageFingerprint || input.observation?.pageFingerprint, 240), failed_step_key: bounded(input.failedStepKey || input.failedPlan?.stepKey || input.failedPlan?.actionType, 160), observation_json: JSON.stringify(sanitizeTraceValue(input.observation || {})), proposed_plan_json: JSON.stringify(sanitizeTraceValue(input.plan || input.proposedPlan || {})), validation_json: JSON.stringify(sanitizeTraceValue(input.validation || { status: input.status, reasonCode: input.reasonCode })), execution_json: JSON.stringify(sanitizeTraceValue(input.execution || {})), verification_json: JSON.stringify(sanitizeTraceValue(input.verification || {})), status: bounded(input.status || 'proposed', 40), model_name: bounded(input.modelName, 120), prompt_version: bounded(input.promptVersion || 'application-repair-v1', 80), created_at: input.createdAt || stamp, updated_at: stamp };
    sqlite.prepare(`INSERT INTO application_playbook_repairs (id,playbook_id,application_id,page_fingerprint,failed_step_key,observation_json,proposed_plan_json,validation_json,execution_json,verification_json,status,model_name,prompt_version,created_at,updated_at) VALUES (@id,@playbook_id,@application_id,@page_fingerprint,@failed_step_key,@observation_json,@proposed_plan_json,@validation_json,@execution_json,@verification_json,@status,@model_name,@prompt_version,@created_at,@updated_at) ON CONFLICT(id) DO UPDATE SET validation_json=excluded.validation_json, execution_json=excluded.execution_json, verification_json=excluded.verification_json, status=excluded.status, updated_at=excluded.updated_at`).run(record);
    return playbookRepairToRenderer(sqlite.prepare('SELECT * FROM application_playbook_repairs WHERE id = ?').get(record.id));
  }
  function listPlaybookRepairs(applicationId) { return sqlite.prepare('SELECT * FROM application_playbook_repairs WHERE application_id = ? ORDER BY created_at DESC').all(bounded(applicationId, 160)).map(playbookRepairToRenderer); }

  function seedDefaults() {
    const defaults = { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', coachMode: 'local-first', integrationsEnabled: false };
    for (const [key, value] of Object.entries(defaults)) {
      if (!db.select().from(userSettings).where(eq(userSettings.key, key)).get()) db.insert(userSettings).values({ key, value: JSON.stringify(value), updatedAt: now() }).run();
    }
  }

  function seedRoadmap() {
    if (!seedPath || !fs.existsSync(seedPath)) return { seeded: false, reason: 'seed-file-missing' };
    const marker = db.select().from(userSettings).where(eq(userSettings.key, 'roadmap_seed_version')).get();
    if (marker) return { seeded: false, reason: 'already-seeded' };
    const rows = parseCsv(fs.readFileSync(seedPath, 'utf8'));
    const timestamp = now();
    db.transaction((tx) => {
      for (const [index, row] of rows.entries()) {
        const common = { id: row.item_id, parentId: row.parent_id || null, title: row.title, description: row.description, status: row.status || 'backlog', priority: row.priority || 'P1', orderIndex: Number(row.order_index || index), dueDate: row.due_date || null, nextAction: row.next_action, definitionOfDone: row.definition_of_done, blockedReason: row.blocked_reason, dependencies: row.dependencies, acceptanceCriteria: row.acceptance_criteria, securityPrivacyNotes: row.security_privacy_notes, sourceContext: row.source_context, confidence: row.confidence, createdAt: timestamp, updatedAt: timestamp, archived: false, deletedAt: null };
        if (row.item_type === 'workspace' || row.item_type === 'project' || row.item_type === 'release' || row.item_type === 'phase') tx.insert(projects).values({ ...common, kind: row.item_type, parentId: row.item_type === 'workspace' ? null : (row.parent_id || null) }).onConflictDoNothing().run();
        else tx.insert(tasks).values({ ...common, projectId: row.project_id, parentTaskId: row.item_type === 'subtask' ? row.parent_id || null : null, releaseId: row.release_id || null, phaseId: row.phase_id || null }).onConflictDoNothing().run();
      }
      tx.insert(userSettings).values({ key: 'roadmap_seed_version', value: JSON.stringify({ source: path.basename(seedPath), rows: rows.length }), updatedAt: now() }).run();
    });
    return { seeded: true, rows: rows.length };
  }

  function projectToRenderer(row) { return { ...row, type: row.kind, name: row.title, archived: Boolean(row.archived), order: row.orderIndex }; }
  function taskToRenderer(row) { return { ...row, type: row.parentTaskId ? 'subtask' : 'task', name: row.title, parentId: row.parentTaskId || row.phaseId || row.releaseId || row.projectId || null, order: row.orderIndex, archived: Boolean(row.archived) }; }
  function bootstrap() {
    const projectRows = allProjects().map(projectToRenderer);
    const taskRows = allTasks().map(taskToRenderer);
    const workspaces = projectRows.filter((row) => row.kind === 'workspace');
    const workspace = workspaces[0] || { id: 'default', kind: 'workspace', type: 'workspace', title: 'Executive workspace', archived: false };
    return { roadmap: { schemaVersion: 3, workspace, workspaces, projects: projectRows.filter((row) => row.kind === 'project'), releases: projectRows.filter((row) => row.kind === 'release'), phases: projectRows.filter((row) => row.kind === 'phase'), tasks: taskRows.filter((row) => row.type === 'task'), subtasks: taskRows.filter((row) => row.type === 'subtask') }, notes: db.select().from(notes).where(eq(notes.id, 'personal-notes')).get()?.content || '', settings: Object.fromEntries(db.select().from(userSettings).all().map((setting) => [setting.key, JSON.parse(setting.value)])) };
  }
  function upsertProject(input, kind) {
    const record = projectRecord(safeRecord(input, ['id', 'title'], 'project'), kind);
    validateProjectHierarchy(record);
    const existing = db.select().from(projects).where(eq(projects.id, record.id)).get();
    insertOrUpdate(projects, record);
    if (existing?.archived && !record.archived) {
      db.update(tasks).set({ archived: false, deletedAt: null, updatedAt: now() }).where(eq(tasks.projectId, record.id)).run();
    }
    return projectToRenderer(db.select().from(projects).where(eq(projects.id, record.id)).get());
  }
  function upsertTask(input, kind) {
    const safeInput = safeRecord(input, ['id', 'title', 'projectId'], 'task');
    const recordKind = safeInput.type === 'subtask' || Boolean(safeInput.parentTaskId) ? 'subtask' : (kind || 'task');
    const record = taskRecord(safeInput, recordKind);
    validateTaskHierarchy(record);
    insertOrUpdate(tasks, record);
    return taskToRenderer(db.select().from(tasks).where(eq(tasks.id, record.id)).get());
  }
  function softDelete(table, recordId) { if (!nonEmpty(recordId) || recordId.length > 160) throw new Error('Invalid record id.'); const result = db.update(table).set({ deletedAt: now(), updatedAt: now(), archived: true }).where(eq(table.id, recordId)).run(); return result.changes > 0; }
  function softDeleteProject(recordId) {
    if (!nonEmpty(recordId) || recordId.length > 160) throw new Error('Invalid project id.');
    const timestamp = now();
    return db.transaction((tx) => {
      const projectResult = tx.update(projects).set({ deletedAt: timestamp, updatedAt: timestamp, archived: true }).where(eq(projects.id, recordId)).run();
      tx.update(tasks).set({ deletedAt: timestamp, updatedAt: timestamp, archived: true }).where(eq(tasks.projectId, recordId)).run();
      return projectResult.changes > 0;
    });
  }
  function syncRoadmap(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid roadmap payload.');
    const collections = ['projects', 'releases', 'phases', 'tasks', 'subtasks'];
    if (collections.some((key) => !Array.isArray(payload[key]))) throw new Error('Invalid roadmap collections.');
    db.transaction((tx) => {
      const workspaceRows = (Array.isArray(payload.workspaces) ? payload.workspaces : []).map((entry) => projectRecord(entry, 'workspace'));
      const projectRows = [...workspaceRows, ...payload.projects.map((entry) => projectRecord(entry, entry.kind || entry.type || 'project')), ...payload.releases.map((entry) => projectRecord(entry, 'release')), ...payload.phases.map((entry) => projectRecord(entry, 'phase'))];
      const taskRows = [...payload.tasks.map((entry) => taskRecord(entry, 'task')), ...payload.subtasks.map((entry) => taskRecord(entry, 'subtask'))];
      const projectOrder = { workspace: 0, project: 1, release: 2, phase: 3 };
      for (const record of projectRows.sort((a, b) => projectOrder[a.kind] - projectOrder[b.kind])) { validateProjectHierarchy(record, tx); tx.insert(projects).values(record).onConflictDoUpdate({ target: projects.id, set: { ...record, id: undefined } }).run(); }
      for (const record of taskRows) tx.insert(tasks).values(record).onConflictDoUpdate({ target: tasks.id, set: { ...record, id: undefined } }).run();
      const projectIds = new Set(projectRows.map((entry) => entry.id));
      const taskIds = new Set(taskRows.map((entry) => entry.id));
      for (const row of tx.select({ id: projects.id, kind: projects.kind }).from(projects).where(isNull(projects.deletedAt)).all()) if (!projectIds.has(row.id) && row.kind !== 'workspace') tx.update(projects).set({ deletedAt: now(), archived: true, updatedAt: now() }).where(eq(projects.id, row.id)).run();
      for (const row of tx.select({ id: tasks.id }).from(tasks).where(isNull(tasks.deletedAt)).all()) if (!taskIds.has(row.id)) tx.update(tasks).set({ deletedAt: now(), archived: true, updatedAt: now() }).where(eq(tasks.id, row.id)).run();
    });
    return bootstrap();
  }
  function importRoadmap(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid roadmap payload.');
    const collections = ['projects', 'releases', 'phases', 'tasks', 'subtasks'];
    if (collections.some((key) => !Array.isArray(payload[key]))) throw new Error('Invalid roadmap collections.');
    for (const entry of [...payload.projects, ...payload.releases, ...payload.phases]) if (entry.id && (entry.title || entry.name)) upsertProject(entry, entry.kind || entry.type || 'project');
    for (const entry of [...payload.tasks, ...payload.subtasks]) if (entry.id && (entry.title || entry.name) && entry.projectId) upsertTask(entry, entry.parentTaskId || entry.parentId ? 'subtask' : 'task');
    return bootstrap();
  }
  function saveNote(content, title = 'Personal notes') {
    const timestamp = now();
    const record = { id: 'personal-notes', title: bounded(title, 500), content: bounded(content, 100000), entityType: 'workspace', entityId: 'default', createdAt: timestamp, updatedAt: timestamp, deletedAt: null };
    db.insert(notes).values(record).onConflictDoUpdate({ target: notes.id, set: { title: record.title, content: record.content, updatedAt: timestamp, deletedAt: null } }).run();
    return db.select().from(notes).where(eq(notes.id, record.id)).get();
  }
  function backup() {
    const backupDir = path.join(userDataPath, 'backups'); fs.mkdirSync(backupDir, { recursive: true });
    const destination = path.join(backupDir, `executive-coach-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
    return sqlite.backup(destination).then(() => destination);
  }
  function createJobSearchRun(input = {}) {
    const runId = bounded(nonEmpty(input.id, id('search-run')), 160);
    sqlite.prepare('INSERT INTO job_search_runs (id, status, started_at, finished_at, result_count, warning) VALUES (?, ?, ?, NULL, 0, ?)').run(runId, bounded(input.status || 'running', 40), now(), bounded(input.warning || '', 1000));
    return runId;
  }
  function recordJobSearchAttempt(input = {}) {
    let requestJson = '{}';
    let previewJson = '[]';
    try { requestJson = JSON.stringify(input.request || {}); } catch {}
    try {
      previewJson = JSON.stringify((Array.isArray(input.preview) ? input.preview : []).slice(0, 2).map((job) => ({
        providerKey: bounded(job.providerKey, 40), externalId: bounded(job.externalId, 160), title: bounded(job.title, 300), company: bounded(job.company || job.agency, 240), location: bounded(job.location, 240), canonicalUrl: bounded(job.canonicalUrl, 1000), applicationUrl: bounded(job.applicationUrl, 1000), postedAt: job.postedAt || null,
      })));
    } catch {}
    sqlite.prepare('INSERT INTO job_search_attempts (id, run_id, provider, lane_id, query, location, request_json, http_status, result_count, total_available, duration_ms, error_code, error_message, error_detail, preview_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id('search-attempt'), input.runId, bounded(input.provider, 40), bounded(input.laneId, 160), bounded(input.query, 300), bounded(input.location, 300), bounded(requestJson, 4000), Number.isInteger(input.httpStatus) ? input.httpStatus : null, Number(input.resultCount) || 0, Number(input.totalAvailable) || 0, Number(input.durationMs) || 0, bounded(input.errorCode || '', 80) || null, bounded(input.errorMessage || '', 1000) || null, bounded(input.errorDetail || '', 500) || null, bounded(previewJson, 12000), now());
  }
  function recordApiCall(input = {}) {
    const json = (value, fallback = '{}') => { try { return JSON.stringify(value ?? JSON.parse(fallback)); } catch { return fallback; } };
    sqlite.prepare('INSERT INTO api_call_log (id, run_id, purpose, method, url, request_headers_json, request_body, response_status, response_headers_json, response_body, response_ok, duration_ms, timed_out, error_name, error_message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      input.id || id('api-call'), input.runId || null, bounded(input.purpose || 'unknown', 100), bounded(input.method || 'GET', 12), bounded(input.url, 4000), json(input.requestHeaders), String(input.requestBody ?? ''), Number.isInteger(input.responseStatus) ? input.responseStatus : null, json(input.responseHeaders), String(input.responseBody ?? ''), input.responseOk === null || input.responseOk === undefined ? null : (Number(input.responseOk) ? 1 : 0), Number(input.durationMs) || 0, Number(input.timedOut) ? 1 : 0, bounded(input.errorName, 120), bounded(input.errorMessage, 4000), now(),
    );
  }
  function listApiCalls(runId) {
    const rows = sqlite.prepare(runId ? 'SELECT * FROM api_call_log WHERE run_id = ? ORDER BY created_at ASC' : 'SELECT * FROM api_call_log ORDER BY created_at ASC').all(...(runId ? [runId] : []));
    return rows.map((row) => {
      let request = null;
      try { request = JSON.parse(row.request_body || 'null'); } catch {}
      const messages = Array.isArray(request?.messages) ? request.messages : [];
      const userPayload = messages.find((message) => message?.role === 'user')?.content || '';
      let parsedUser = null;
      try { parsedUser = JSON.parse(userPayload); } catch {}
      return { ...row, requestBodyCharacters: String(row.request_body || '').length, estimatedRequestTokens: Math.ceil(String(row.request_body || '').length / 4), model: request?.model || null, maxTokens: Number.isFinite(Number(request?.max_tokens)) ? Number(request.max_tokens) : null, messageCount: messages.length, jobCount: Array.isArray(parsedUser?.jobs) ? parsedUser.jobs.length : null, assessmentCount: Array.isArray(parsedUser?.assessments) ? parsedUser.assessments.length : null, requestHeaders: (() => { try { return JSON.parse(row.request_headers_json || '{}'); } catch { return {}; } })(), responseHeaders: (() => { try { return JSON.parse(row.response_headers_json || '{}'); } catch { return {}; } })() };
    });
  }
  function recordJobSearchRankingBatch(input = {}) {
    sqlite.prepare('INSERT INTO job_search_ranking_batches (id, run_id, batch_number, submitted_count, assessed_count, response_length, status, error_code, error_message, created_at, finished_at, call_number, total_calls, prompt_characters, max_tokens, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id('ranking-batch'), input.runId, Number(input.batchNumber) || 0, Number(input.submittedCount) || 0, Number(input.assessedCount) || 0, Number(input.responseLength) || 0, bounded(input.status || 'failed', 40), bounded(input.errorCode || '', 120) || null, bounded(input.errorMessage || '', 2000) || null, input.createdAt || now(), input.finishedAt || now(), Number(input.callNumber) || 0, Number(input.totalCalls) || 0, Number(input.promptCharacters) || 0, Number(input.maxTokens) || 0, Number(input.durationMs) || 0,
    );
  }
  function listJobSearchRankingBatches(runId) {
    return sqlite.prepare('SELECT * FROM job_search_ranking_batches WHERE run_id = ? ORDER BY batch_number ASC').all(runId);
  }
  function finishJobSearchRun(runId, input = {}) {
    sqlite.prepare('UPDATE job_search_runs SET status = ?, finished_at = ?, result_count = ?, warning = ? WHERE id = ?').run(bounded(input.status || 'completed', 40), now(), Number(input.resultCount) || 0, bounded(input.warning || '', 1000), runId);
  }
  function listJobSearchAttempts(runId) {
    return sqlite.prepare('SELECT * FROM job_search_attempts WHERE run_id = ? ORDER BY created_at ASC').all(runId).map((row) => ({ ...row, request: (() => { try { return JSON.parse(row.request_json || '{}'); } catch { return {}; } })(), preview: (() => { try { const parsed = JSON.parse(row.preview_json || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; } })() }));
  }
  function upsertEmail(input = {}) {
    const timestamp = now();
    const emailId = input.id || stableEmailId(input.provider || 'gmail', input.externalId);
    const matchedTerms = Array.isArray(input.matchedTerms) ? input.matchedTerms.slice(0, 30) : [];
    const matchedPipelineSignals = Array.isArray(input.matchedPipelineSignals) ? input.matchedPipelineSignals.slice(0, 30) : [];
    const sender = String(input.from || '').slice(0, 500);
    const senderKey = normalizeEmailSender(sender);
    sqlite.prepare(`INSERT INTO email_messages (id, provider, external_id, thread_id, subject, sender, sender_key, recipients, received_at, body, is_job_related, classification_score, matched_terms_json, matched_pipeline_signals_json, created_at, updated_at, seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(provider, external_id) DO UPDATE SET thread_id=excluded.thread_id, subject=excluded.subject, sender=excluded.sender, sender_key=excluded.sender_key, recipients=excluded.recipients, received_at=excluded.received_at, body=excluded.body, is_job_related=excluded.is_job_related, classification_score=excluded.classification_score, matched_terms_json=excluded.matched_terms_json, matched_pipeline_signals_json=excluded.matched_pipeline_signals_json, updated_at=excluded.updated_at`).run(
      emailId, String(input.provider || 'gmail').slice(0, 40), String(input.externalId || '').slice(0, 300), String(input.threadId || '').slice(0, 300), String(input.subject || '').slice(0, 1000), sender, senderKey, String(input.to || '').slice(0, 1000), input.receivedAt || null, String(input.body || '').slice(0, 200000), input.isJobRelated ? 1 : 0, Number(input.score) || 0, JSON.stringify(matchedTerms), JSON.stringify(matchedPipelineSignals), input.createdAt || timestamp, timestamp,
    );
    sqlite.prepare('DELETE FROM email_chunks WHERE email_id = ?').run(emailId);
    const insertChunk = sqlite.prepare('INSERT INTO email_chunks (id, email_id, chunk_index, content, created_at) VALUES (?, ?, ?, ?, ?)');
    for (const chunk of chunkText(`${input.subject || ''}\n${input.from || ''}\n${input.body || ''}`)) insertChunk.run(id('email-chunk'), emailId, chunk.index, chunk.content, timestamp);
    return getEmail(emailId);
  }
  function getEmail(emailId) {
    const row = sqlite.prepare('SELECT * FROM email_messages WHERE id = ?').get(String(emailId));
    if (!row) return null;
    return emailToRenderer(row);
  }
  function emailToRenderer(row) {
    const linkedJobIds = sqlite.prepare('SELECT job_id FROM email_job_links WHERE email_id = ? ORDER BY created_at ASC').all(row.id).map((entry) => entry.job_id);
    const senderKey = row.sender_key || normalizeEmailSender(row.sender);
    const isBlocked = Boolean(sqlite.prepare('SELECT 1 FROM email_sender_blocks WHERE sender_key = ?').get(senderKey));
    return { ...row, senderKey, isJobRelated: Boolean(row.is_job_related), isExcluded: Boolean(row.user_excluded), isSeen: Boolean(row.seen_at), isBlocked, matchedTerms: JSON.parse(row.matched_terms_json || '[]'), matchedPipelineSignals: JSON.parse(row.matched_pipeline_signals_json || '[]'), linkedJobIds };
  }
  function listEmails({ jobOnly = true, includeExcluded = false, includeBlocked = false, limit = 50 } = {}) {
    const conditions = [];
    if (jobOnly) conditions.push('is_job_related = 1');
    if (!includeExcluded) conditions.push('user_excluded = 0');
    if (!includeBlocked) conditions.push('NOT EXISTS (SELECT 1 FROM email_sender_blocks b WHERE b.sender_key = email_messages.sender_key)');
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = sqlite.prepare(`SELECT * FROM email_messages ${where} ORDER BY received_at DESC, updated_at DESC LIMIT ?`).all(Math.min(200, Math.max(1, Number(limit) || 50)));
    return rows.map(emailToRenderer);
  }
  function setEmailExcluded(input = {}) {
    const emailId = bounded(input.emailId, 160);
    if (!sqlite.prepare('SELECT 1 FROM email_messages WHERE id = ?').get(emailId)) throw new Error('Email not found.');
    sqlite.prepare('UPDATE email_messages SET user_excluded = ?, updated_at = ? WHERE id = ?').run(input.excluded ? 1 : 0, now(), emailId);
    return getEmail(emailId);
  }
  function autoAssignApplicationEmail(input = {}) {
    // Auto-creation is deliberately gated by explicit submission language plus
    // enough identity to avoid turning newsletters, job alerts, or generic
    // recruiter updates into junk pipeline opportunities.
    const confirmation = extractApplicationConfirmation(input);
    if (!confirmation || input.isJobRelated === false) return { created: false, linked: false, reason: 'not_explicit_application_confirmation', job: null, email: getEmail(input.id) };
    const normalizeUrl = (value) => { try { const parsed = new URL(String(value || '')); parsed.search = ''; parsed.hash = ''; return parsed.toString().replace(/\/$/, '').toLowerCase(); } catch { return String(value || '').trim().toLowerCase().replace(/\/$/, ''); } };
    const canonicalUrl = normalizeUrl(confirmation.url);
    const rows = sqlite.prepare('SELECT * FROM job_opportunities WHERE deleted_at IS NULL OR external_id = ? OR canonical_url = ?').all(confirmation.url.match(/\/([0-9A-Za-z_-]+)(?:\?|$)/)?.[1] || '', confirmation.url || '');
    const existing = rows.find((row) => {
      const sameUrl = canonicalUrl && normalizeUrl(row.canonical_url || row.url) === canonicalUrl;
      const sameExternalId = confirmation.url && row.external_id && confirmation.url.match(/\/([0-9A-Za-z_-]+)(?:\?|$)/)?.[1] === row.external_id;
      const sameRoleCompany = confirmation.company && row.company && confirmation.roleTitle && row.role_title && String(row.company).toLowerCase() === String(confirmation.company).toLowerCase() && String(row.role_title).toLowerCase() === String(confirmation.roleTitle).toLowerCase();
      return sameUrl || sameExternalId || sameRoleCompany;
    });
    const jobId = existing?.id || `job-${input.id || stableEmailId(input.provider || 'gmail', input.externalId)}`;
    const job = upsertJob({
      id: jobId,
      company: confirmation.company || existing?.company || 'Unknown employer',
      roleTitle: confirmation.roleTitle || existing?.role_title || 'Unknown role',
      url: confirmation.url || existing?.url || '',
      canonicalUrl: confirmation.url || existing?.canonical_url || '',
      location: confirmation.location || existing?.location || '',
      employmentType: existing?.employment_type || '',
      source: confirmation.source || existing?.source || 'email',
      apiSource: existing?.api_source || confirmation.source || 'email',
      externalId: existing?.external_id || (confirmation.url.match(/\/([0-9A-Za-z_-]+)(?:\?|$)/)?.[1] || null),
      stage: existing?.stage && JOB_STAGE_ORDER.indexOf(existing.stage) > JOB_STAGE_ORDER.indexOf('applied') ? existing.stage : 'applied',
      appliedAt: existing?.applied_at || confirmation.appliedAt || now().slice(0, 10),
      priority: existing?.priority || 'medium',
      nextAction: existing?.next_action || 'Track employer response and follow up on the application.',
      notes: existing?.notes || 'Auto-created from an explicit application-confirmation email.',
      rawData: { ...(existing ? parseObject(existing.raw_data_json) : {}), applicationConfirmation: confirmation, sourceEmailId: input.id || null },
      description: existing?.description || '',
      requirements: existing ? parseObject(existing.requirements_json, []) : [],
      archived: false,
      matchScore: existing?.match_score ?? null,
      requirementsMatchScore: existing?.requirements_match_score ?? null,
      candidateMatchScore: existing?.candidate_match_score ?? null,
      fitTier: existing?.fit_tier || null,
      matchSummary: existing?.match_summary || 'Created from an explicit application-confirmation email.'
    });
    const linked = linkEmailToJob({ emailId: input.id || stableEmailId(input.provider || 'gmail', input.externalId), jobId: job.id });
    return { created: !existing, linked: true, reason: existing ? 'matched_existing_pipeline_job' : 'created_from_application_confirmation', job, email: linked };
  }
  function markEmailSeen(input = {}) {
    const emailId = bounded(input.emailId, 160);
    if (!sqlite.prepare('SELECT 1 FROM email_messages WHERE id = ?').get(emailId)) throw new Error('Email not found.');
    const timestamp = now();
    sqlite.prepare('UPDATE email_messages SET seen_at = COALESCE(seen_at, ?), updated_at = ? WHERE id = ?').run(timestamp, timestamp, emailId);
    return getEmail(emailId);
  }
  function markJobEmailsSeen(jobId) {
    requirePipelineJob(jobId);
    const timestamp = now();
    sqlite.prepare('UPDATE email_messages SET seen_at = COALESCE(seen_at, ?), updated_at = ? WHERE id IN (SELECT email_id FROM email_job_links WHERE job_id = ?) AND user_excluded = 0').run(timestamp, timestamp, bounded(jobId, 160));
    return jobNotificationCounts(jobId);
  }
  function blockEmailSender(input = {}) {
    const sender = bounded(input.sender || input.senderKey, 500).trim();
    const senderKey = normalizeEmailSender(input.senderKey || sender);
    if (!senderKey) throw new Error('A sender is required.');
    const timestamp = now();
    sqlite.transaction(() => {
      sqlite.prepare('INSERT INTO email_sender_blocks (sender_key, sender, created_at) VALUES (?, ?, ?) ON CONFLICT(sender_key) DO UPDATE SET sender = excluded.sender').run(senderKey, sender || senderKey, timestamp);
      // Blocking a sender is also a relevance decision: every existing message from that sender is marked not relevant.
      sqlite.prepare('UPDATE email_messages SET user_excluded = 1, updated_at = ? WHERE sender_key = ?').run(timestamp, senderKey);
    })();
    return { senderKey, sender: sender || senderKey };
  }
  function unblockEmailSender(input = {}) {
    const senderKey = normalizeEmailSender(input.senderKey || input.sender);
    sqlite.prepare('DELETE FROM email_sender_blocks WHERE sender_key = ?').run(senderKey);
    return { senderKey };
  }
  function listBlockedEmailSenders() {
    return sqlite.prepare('SELECT sender_key AS senderKey, sender, created_at AS createdAt FROM email_sender_blocks ORDER BY sender COLLATE NOCASE ASC').all();
  }
  function linkEmailToJob(input = {}) {
    const emailId = bounded(input.emailId, 160); const jobId = bounded(input.jobId, 160);
    if (!sqlite.prepare('SELECT 1 FROM email_messages WHERE id = ?').get(emailId)) throw new Error('Email not found.');
    if (!sqlite.prepare('SELECT 1 FROM job_opportunities WHERE id = ? AND deleted_at IS NULL').get(jobId)) throw new Error('Pipeline job not found.');
    // An email is assigned to one pipeline job; replacing a link keeps the decision explicit and reversible.
    sqlite.prepare('INSERT INTO email_job_links (email_id, job_id, created_at) VALUES (?, ?, ?) ON CONFLICT(email_id) DO UPDATE SET job_id = excluded.job_id, created_at = excluded.created_at').run(emailId, jobId, now());
    return getEmail(emailId);
  }
  function unlinkEmailFromJob(input = {}) {
    const emailId = bounded(input.emailId, 160); const jobId = bounded(input.jobId, 160);
    sqlite.prepare('DELETE FROM email_job_links WHERE email_id = ? AND job_id = ?').run(emailId, jobId);
    return getEmail(emailId);
  }
  function searchEmailRag(query, limit = 10) {
    const chunks = sqlite.prepare('SELECT c.id, c.email_id AS emailId, c.chunk_index AS chunkIndex, c.content, e.subject, e.sender, e.received_at AS receivedAt FROM email_chunks c JOIN email_messages e ON e.id = c.email_id WHERE e.is_job_related = 1 AND e.user_excluded = 0').all();
    const bestByEmail = new Map();
    for (const chunk of searchChunks(chunks, query, Math.min(200, Math.max(1, Number(limit) || 10) * 20))) {
      const current = bestByEmail.get(chunk.emailId);
      if (!current || chunk.score > current.score || (chunk.score === current.score && chunk.chunkIndex < current.chunkIndex)) bestByEmail.set(chunk.emailId, chunk);
    }
    return [...bestByEmail.values()].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(b.receivedAt || '').localeCompare(String(a.receivedAt || ''));
    }).slice(0, Math.min(20, Math.max(1, Number(limit) || 10)));
  }

  const outreachToRenderer = (row) => row ? ({
    ...row,
    jobId: row.job_id,
    contactId: row.contact_id,
    jobFitScore: row.job_fit_score,
    contactQualityScore: row.contact_quality_score,
    emailConfidenceScore: row.email_confidence_score,
    jobFreshnessScore: row.job_freshness_score,
    companyPriorityScore: row.company_priority_score,
    outreachScore: row.outreach_score,
    resumeVersion: row.resume_version,
    resumePath: row.resume_path,
    emailSubject: row.email_subject,
    emailBody: row.email_body,
    gmailMessageId: row.gmail_message_id,
    gmailThreadId: row.gmail_thread_id,
    recipient: row.recipient,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
    sentAt: row.sent_at,
    replyReceivedAt: row.reply_received_at,
    lastFollowupAt: row.last_followup_at,
    replyClassification: row.reply_classification,
    updatedAt: row.updated_at,
    contactName: row.contact_name,
    contactTitle: row.contact_title,
    contactEmail: row.contact_email,
    contactSource: row.contact_source,
    contactEvidence: row.source_evidence,
    verificationStatus: row.verification_status,
    verificationMethod: row.verification_method,
    verificationSource: row.verification_source,
    contactConfidence: row.contact_confidence,
    company: row.company,
    jobTitle: row.job_title,
    jobUrl: row.job_url,
    jobActive: row.job_deleted_at == null && !row.job_archived,
  }) : null;
  function listOutreach(input = {}) {
    const status = input.status && input.status !== 'all' ? String(input.status).slice(0, 40) : '';
    const rows = sqlite.prepare(`SELECT o.*, j.company, j.role_title AS job_title, j.url AS job_url, j.deleted_at AS job_deleted_at, j.archived AS job_archived, j.match_score AS job_match_score, c.name AS contact_name, c.title AS contact_title, c.email AS contact_email, c.source_url AS contact_source, c.source_evidence, c.verification_status, c.verification_method, c.verification_source, c.confidence AS contact_confidence FROM outreach_opportunities o JOIN job_opportunities j ON j.id = o.job_id JOIN outreach_contacts c ON c.id = o.contact_id WHERE (? = '' OR o.status = ?) ORDER BY o.outreach_score DESC, o.created_at DESC`).all(status, status);
    return rows.map(outreachToRenderer);
  }
  function listOutreachContacts() { return sqlite.prepare('SELECT id, name, title, email, source_url AS sourceUrl, source_evidence AS sourceEvidence, verification_status AS verificationStatus, verification_method AS verificationMethod, verification_source AS verificationSource, confidence, created_at AS createdAt, updated_at AS updatedAt FROM outreach_contacts ORDER BY updated_at DESC').all(); }
  function upsertOutreachContact(input = {}) {
    const email = String(input.email || '').trim().toLowerCase();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid contact email or leave it blank.');
    const timestamp = now();
    const existing = email ? sqlite.prepare('SELECT * FROM outreach_contacts WHERE lower(email) = ?').get(email) : null;
    const contact = { id: existing?.id || bounded(nonEmpty(input.id, id('outreach-contact')), 160), name: bounded(input.name, 240), title: bounded(input.title, 240), email: bounded(email, 320), source_url: bounded(input.sourceUrl, 2000), source_evidence: bounded(input.sourceEvidence, 4000), verification_status: ['verified','probable','unverified','unavailable'].includes(input.verificationStatus) ? input.verificationStatus : 'unverified', verification_method: bounded(input.verificationMethod, 500), verification_source: bounded(input.verificationSource, 2000), confidence: Math.max(0, Math.min(100, Number(input.confidence) || 0)), created_at: existing?.created_at || timestamp, updated_at: timestamp };
    if (existing) sqlite.prepare('UPDATE outreach_contacts SET name=?, title=?, email=?, source_url=?, source_evidence=?, verification_status=?, verification_method=?, verification_source=?, confidence=?, updated_at=? WHERE id=?').run(contact.name, contact.title, contact.email, contact.source_url, contact.source_evidence, contact.verification_status, contact.verification_method, contact.verification_source, contact.confidence, timestamp, contact.id);
    else sqlite.prepare('INSERT INTO outreach_contacts (id,name,title,email,source_url,source_evidence,verification_status,verification_method,verification_source,confidence,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(contact.id, contact.name, contact.title, contact.email, contact.source_url, contact.source_evidence, contact.verification_status, contact.verification_method, contact.verification_source, contact.confidence, contact.created_at, timestamp);
    return listOutreachContacts().find((entry) => entry.id === contact.id);
  }
  function createOutreachOpportunity(input = {}) {
    const jobId = bounded(input.jobId, 160); const job = sqlite.prepare('SELECT * FROM job_opportunities WHERE id = ? AND deleted_at IS NULL AND archived = 0').get(jobId); if (!job) throw new Error('Active job not found.');
    const contact = input.contactId ? sqlite.prepare('SELECT * FROM outreach_contacts WHERE id = ?').get(input.contactId) : upsertOutreachContact(input.contact || {}); if (!contact) throw new Error('Contact not found.');
    const duplicate = sqlite.prepare('SELECT id FROM outreach_opportunities WHERE job_id = ? AND contact_id = ?').get(jobId, contact.id); if (duplicate) return listOutreach().find((entry) => entry.id === duplicate.id);
    const fit = Math.max(0, Math.min(100, Number(input.jobFitScore ?? job.match_score) || 0)); const contactQuality = Math.max(0, Math.min(100, Number(input.contactQualityScore) || (String(contact.title).toLowerCase().includes('recruit') ? 100 : 55))); const confidence = { verified: 100, probable: 60, unverified: 20, unavailable: 0 }[contact.verification_status] ?? 0; const freshness = job.posted_at ? Math.max(0, Math.min(100, Math.round(100 - Math.max(0, (Date.now() - new Date(job.posted_at).getTime()) / 86400000) * 4))) : 35; const score = Math.round(fit * .4 + contactQuality * .25 + confidence * .2 + freshness * .1 + 50 * .05); const resume = getResume(); const resumePath = masterResumeSourcePath && fs.existsSync(masterResumeSourcePath) ? masterResumeSourcePath : '';
    const text = `${job.role_title} ${job.company} ${job.description || ''}`.toLowerCase(); const resumeVersion = resume?.version ? `v${resume.version}` : 'master'; const subject = `Interest in ${job.role_title} at ${job.company}`; const firstName = String(contact.name || '').trim().split(/\s+/)[0]; const reason = text.includes('healthcare') ? 'the overlap between healthcare software and practical automation' : text.includes('forward deployed') ? 'the customer-facing, implementation-oriented nature of the role' : 'the role’s combination of product delivery and technical problem solving'; const body = `Hi ${firstName || 'there'},\n\nI’m Joshua Rice, a full-stack engineer with healthcare and insurance delivery experience who has been building practical AI and automation systems end to end. I’m reaching out because the ${job.role_title} role at ${job.company} looks closely aligned with ${reason}.\n\nMy background combines hands-on product delivery, stakeholder communication, and building reliable workflows around real operational problems.\n\nWould you be open to a brief conversation about the team’s needs and whether my experience could be useful?\n\nBest,\nJoshua Rice`;
    const opportunity = { id: id('outreach'), job_id: jobId, contact_id: contact.id, job_fit_score: fit, contact_quality_score: contactQuality, email_confidence_score: confidence, job_freshness_score: freshness, company_priority_score: 50, outreach_score: score, resume_version: resumeVersion, resume_path: resumePath, email_subject: subject, email_body: body, status: 'draft_ready', recipient: contact.email, created_at: now(), updated_at: now() };
    sqlite.prepare('INSERT INTO outreach_opportunities (id,job_id,contact_id,job_fit_score,contact_quality_score,email_confidence_score,job_freshness_score,company_priority_score,outreach_score,resume_version,resume_path,email_subject,email_body,status,recipient,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(opportunity));
    return listOutreach().find((entry) => entry.id === opportunity.id);
  }
  function updateOutreach(input = {}) { const current = sqlite.prepare('SELECT * FROM outreach_opportunities WHERE id = ?').get(bounded(input.id, 160)); if (!current) throw new Error('Outreach opportunity not found.'); const allowed = new Set(['candidate','contact_found','contact_verified','draft_ready','approved','sent','replied','follow_up_due','rejected','skipped']); const status = allowed.has(input.status) ? input.status : current.status; const subject = input.emailSubject === undefined ? current.email_subject : bounded(input.emailSubject, 500); const body = input.emailBody === undefined ? current.email_body : bounded(input.emailBody, 12000); sqlite.prepare('UPDATE outreach_opportunities SET status=?, email_subject=?, email_body=?, notes=?, updated_at=? WHERE id=?').run(status, subject, body, bounded(input.notes ?? current.notes, 4000), now(), current.id); return listOutreach().find((entry) => entry.id === current.id); }
  function approveOutreach(idValue) { const current = sqlite.prepare('SELECT * FROM outreach_opportunities WHERE id = ?').get(bounded(idValue, 160)); if (!current) throw new Error('Outreach opportunity not found.'); const contact = sqlite.prepare('SELECT * FROM outreach_contacts WHERE id = ?').get(current.contact_id); if (!contact?.email || contact.verification_status !== 'verified') throw new Error('Only contacts with verified email addresses can be approved for automatic send.'); if (!current.resume_path || !fs.existsSync(current.resume_path)) throw new Error('A valid selected resume is required before approval.'); const approvedAt = now(); sqlite.prepare("UPDATE outreach_opportunities SET status='approved', approved_at=?, updated_at=? WHERE id=?").run(approvedAt, approvedAt, current.id); return listOutreach().find((entry) => entry.id === current.id); }
  function outreachMetrics() { const rows = sqlite.prepare('SELECT * FROM outreach_opportunities').all(); const sent = rows.filter((row) => row.sent_at); const followup = sent.filter((row) => !row.reply_received_at && (Date.now() - new Date(row.sent_at).getTime()) / 86400000 >= 5); return { contacts: rows.length, emailsSent: sent.length, replies: rows.filter((row) => row.reply_received_at).length, positiveReplies: rows.filter((row) => ['positive','interview'].includes(row.reply_classification)).length, interviews: rows.filter((row) => row.reply_classification === 'interview').length, recruiterConversations: rows.filter((row) => row.reply_classification === 'positive').length, followUpsDue: followup.length, dailyRemaining: Math.max(0, 10 - sent.filter((row) => String(row.sent_at).slice(0, 10) === new Date().toISOString().slice(0, 10)).length) }; }
  function markOutreachSent(idValue, message = {}) { const current = sqlite.prepare('SELECT * FROM outreach_opportunities WHERE id = ?').get(bounded(idValue, 160)); if (!current) throw new Error('Outreach opportunity not found.'); const today = new Date().toISOString().slice(0, 10); const sentToday = Number(sqlite.prepare("SELECT COUNT(*) AS count FROM outreach_opportunities WHERE sent_at LIKE ?").get(`${today}%`).count); if (sentToday >= 10) throw new Error('Daily outreach limit reached (10).'); const recent = sqlite.prepare("SELECT 1 FROM outreach_opportunities WHERE lower(recipient)=lower(?) AND sent_at >= datetime('now','-30 days') LIMIT 1").get(current.recipient); if (recent) throw new Error('This contact was contacted within the last 30 days.'); const companyCount = Number(sqlite.prepare("SELECT COUNT(*) AS count FROM outreach_opportunities o JOIN job_opportunities j ON j.id=o.job_id WHERE lower(j.company)=lower((SELECT company FROM job_opportunities WHERE id=?)) AND sent_at LIKE ?").get(current.job_id, `${today}%`).count); if (companyCount >= 2) throw new Error('Company outreach limit reached (2 today).'); const sentAt = now(); sqlite.prepare("UPDATE outreach_opportunities SET status='sent', gmail_message_id=?, gmail_thread_id=?, sent_at=?, recipient=?, updated_at=? WHERE id=?").run(message.messageId || null, message.threadId || null, sentAt, current.recipient, sentAt, current.id); return listOutreach().find((entry) => entry.id === current.id); }
  function recordOutreachReply(input = {}) { const found = input.id ? sqlite.prepare('SELECT * FROM outreach_opportunities WHERE id=?').get(input.id) : sqlite.prepare('SELECT * FROM outreach_opportunities WHERE gmail_thread_id=? OR lower(recipient)=lower(?) ORDER BY sent_at DESC LIMIT 1').get(input.threadId || '', input.recipient || ''); if (!found) return null; const stamp = now(); sqlite.prepare("UPDATE outreach_opportunities SET status='replied', reply_received_at=?, reply_classification=?, updated_at=? WHERE id=?").run(stamp, bounded(input.classification, 40), stamp, found.id); return listOutreach().find((entry) => entry.id === found.id); }
  function listOutreachFollowups() { return listOutreach().filter((entry) => entry.sentAt && !entry.replyReceivedAt && (Date.now() - new Date(entry.sentAt).getTime()) / 86400000 >= 5).map((entry) => ({ ...entry, status: 'follow_up_due' })); }

  seedDefaults();
  const hierarchyRepairResult = careerOnly ? null : repairWorkspaceHierarchy();
  const seedResult = careerOnly ? null : seedRoadmap();
  // Normalize every existing application at startup so records created before
  // the workspace-root change cannot keep displaying the legacy Documents path.
  sqlite.prepare('SELECT id FROM job_applications WHERE deleted_at IS NULL').all().forEach(({ id: applicationId }) => ensureApplicationFiles(applicationId));
  repairStoredMasterResumeHeadings();
  const applicationQueue = createApplicationQueueRepository({ sqlite, now });
  return {
    databasePath, seedResult, hierarchyRepairResult, db, sqlite, tables: tableMap,
    bootstrap, syncRoadmap, importRoadmap, saveNote, backup,
    createJobSearchRun, recordJobSearchAttempt, recordApiCall, listApiCalls, recordJobSearchRankingBatch, listJobSearchRankingBatches, finishJobSearchRun, listJobSearchAttempts,
    email: { upsert: upsertEmail, autoAssignApplication: autoAssignApplicationEmail, get: getEmail, list: listEmails, listForJob: listJobEmails, search: searchEmailRag, link: linkEmailToJob, unlink: unlinkEmailFromJob, setExcluded: setEmailExcluded, markSeen: markEmailSeen, markJobSeen: markJobEmailsSeen, blockSender: blockEmailSender, unblockSender: unblockEmailSender, listBlockedSenders: listBlockedEmailSenders },
    outreach: { list: listOutreach, contacts: { list: listOutreachContacts, save: upsertOutreachContact }, create: createOutreachOpportunity, update: updateOutreach, approve: approveOutreach, markSent: markOutreachSent, recordReply: recordOutreachReply, followups: listOutreachFollowups, metrics: outreachMetrics },
    workspaces: { list: () => allActiveProjects().filter((entry) => entry.kind === 'workspace').map(projectToRenderer), get: (recordId) => { const row = db.select().from(projects).where(and(eq(projects.id, recordId), eq(projects.kind, 'workspace'))).get(); return row ? projectToRenderer(row) : null; }, create: (input) => upsertProject(input, 'workspace'), update: (input) => upsertProject(input, 'workspace'), delete: (recordId) => softDeleteProject(recordId) },
    projects: { list: () => allActiveProjects().filter((entry) => entry.kind === 'project').map(projectToRenderer), get: (recordId) => { const row = db.select().from(projects).where(eq(projects.id, recordId)).get(); return row ? projectToRenderer(row) : null; }, create: (input) => upsertProject(input, 'project'), update: (input) => upsertProject(input, 'project'), delete: (recordId) => softDeleteProject(recordId) },
    tasks: { list: () => allActiveTasks().map(taskToRenderer), get: (recordId) => { const row = db.select().from(tasks).where(eq(tasks.id, recordId)).get(); return row ? taskToRenderer(row) : null; }, create: (input) => upsertTask(input, 'task'), update: (input) => upsertTask(input), delete: (recordId) => softDelete(tasks, recordId) },
    jobs: { list: listJobs, create: upsertJob, update: upsertJob, updateStage: updateJobStage, archiveUnavailable: archiveUnavailableJob, delete: (recordId) => softDelete(jobOpportunities, recordId), activity: { list: listJobActivity, record: recordJobActivity, recordGoogleVoiceConversation, assignGoogleVoiceConversation, ingestGoogleVoiceActivity, markSeen: markJobActivitySeen }, followUps: { list: listJobFollowUps, create: createJobFollowUp, complete: completeJobFollowUp }, calendar: { list: listJobCalendarEvents, create: createJobCalendarEvent } }, profiles: { getCurrent: getProfile, upsert: upsertProfile }, resumes: { getMaster: getResume, upsertMaster: upsertResume },
    applications: { createOrResume: createOrResumeApplication, get: getApplication, getForJob: (jobId) => applicationToRenderer(sqlite.prepare('SELECT * FROM job_applications WHERE job_id = ? AND deleted_at IS NULL').get(bounded(jobId, 160))), listActive: () => sqlite.prepare('SELECT * FROM job_applications WHERE deleted_at IS NULL ORDER BY last_activity_at DESC').all().map(applicationToRenderer), ensureFiles: ensureApplicationFiles, resolveFile: resolveApplicationFile, transition: transitionApplication, abandon: abandonApplication, completeSubmission, beginSubmissionVerification, findSubmissionConfirmation, recordSubmissionEmailMatch, listPendingSubmissionEvidence: () => sqlite.prepare("SELECT * FROM job_application_submission_evidence WHERE status = 'awaiting_email' ORDER BY requested_at ASC").all().map(submissionEvidenceToRenderer), listSubmissionEvidence: (applicationId) => sqlite.prepare('SELECT * FROM job_application_submission_evidence WHERE application_id = ? ORDER BY updated_at ASC').all(bounded(applicationId, 160)).map(submissionEvidenceToRenderer), listEvents: (applicationId) => sqlite.prepare('SELECT * FROM job_application_events WHERE application_id = ? ORDER BY created_at ASC').all(bounded(applicationId, 160)).map(eventToRenderer), recordEvent: recordApplicationEvent, recordExternalApplicationUrl, listAnswers: (applicationId) => sqlite.prepare("SELECT * FROM job_application_answers WHERE deleted_at IS NULL AND (application_id = ? OR scope = 'global') ORDER BY updated_at DESC").all(bounded(applicationId, 160)).map(answerToRenderer), saveAnswer: saveApplicationAnswer, answerPolicies: { list: listApplicationAnswerPolicies, save: saveApplicationAnswerPolicy }, workflowSteps: { list: listWorkflowSteps, save: saveWorkflowStep }, queue: applicationQueue, updateAutomationState: updateAutonomousApplicationState, recoverAutomation: recoverAutonomousApplications, listAutomationQueue: listAutonomousQueue, claimNextAutomation: claimNextAutonomousApplication, releaseAutomation: releaseAutonomousApplication, listUnknownQuestions, saveUnknownQuestion, resolveUnknownQuestion, saveExternalAccount, getExternalAccount, findExternalAccountByIdentity, recordActivationAttempt, getActivationAttempt, refreshReadiness: refreshApplicationReadiness, playbooks: { list: listPlaybooks, steps: listPlaybookSteps, save: savePlaybook, saveStep: savePlaybookStep, repairs: listPlaybookRepairs, saveRepair: savePlaybookRepair, learningRetries: { queue: queuePlaybookLearningRetry, listPending: listPendingPlaybookLearningRetries, resolve: resolvePlaybookLearningRetry } }, resetDocuments: resetApplicationDocuments, documents: { save: saveDocument, list: listDocuments, get: getDocument, update: updateDocument, approve: approveDocument, select: selectDocument, selectMasterResume, markExport: markDocumentExport } },
    close: () => sqlite.close(),
  };
}

module.exports = { createDatabase, tables: { projects, tasks, goals, userSettings, checkIns, notes, briefings, integrationsMetadata, calendarEvents, jobOpportunities, jobApplications, jobApplicationAnswers, jobApplicationEvents, jobApplicationDocuments, jobApplicationExternalAccounts, jobApplicationUnknownQuestions }, parseCsv };
