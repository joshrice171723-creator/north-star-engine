const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createDatabase } = require('../electron/database.cjs');
const { CANONICAL_APPLICATION_STATES, createApplicationQueueService } = require('../electron/jobs/application-queue-service.cjs');

function fixture() {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'north-star-queue-'));
  const db = createDatabase({ userDataPath, seedPath: path.join(userDataPath, 'missing.csv') });
  db.jobs.create({ id: 'queue-job-1', company: 'Acme', roleTitle: 'Engineer', url: 'https://example.test/apply' });
  db.jobs.create({ id: 'queue-job-2', company: 'Beta', roleTitle: 'Developer', url: 'https://example.test/apply/2' });
  const applications = [db.applications.createOrResume({ jobId: 'queue-job-1' }), db.applications.createOrResume({ jobId: 'queue-job-2' })];
  return { db, applications, close: () => { db.close(); fs.rmSync(userDataPath, { recursive: true, force: true }); } };
}

test('durable queue drains serially and survives a database reopen', async () => {
  const context = fixture();
  try {
    const visited = [];
    const service = createApplicationQueueService({ repository: context.db.applications.queue, worker: async (item) => { visited.push(item.applicationId); return { state: 'terminal', checkpoint: { reasonCode: 'test_complete' } }; } });
    const started = service.start({ applicationIds: context.applications.map((entry) => entry.id) });
    assert.equal(started.running, true);
    await service.waitForIdle();
    assert.deepEqual(visited, context.applications.map((entry) => entry.id));
    assert.equal(service.status().counts.terminal, 2);
    const runId = service.status().runId;
    const userDataPath = path.dirname(context.db.databasePath);
    context.db.close();
    const reopened = createDatabase({ userDataPath, seedPath: path.join(userDataPath, 'missing.csv') });
    assert.equal(reopened.applications.queue.getRun(runId).status, 'completed');
    assert.equal(reopened.applications.queue.listItems(runId).length, 2);
    reopened.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  } catch (error) { try { context.close(); } catch {} throw error; }
});

test('restart recovery blocks uncertain submissions and requeues safe work', () => {
  const context = fixture();
  try {
    const run = context.db.applications.queue.ensureRun({ applicationIds: context.applications.map((entry) => entry.id) });
    context.db.applications.queue.updateRun(run.id, { status: 'running' });
    const first = context.db.applications.queue.claimNext(run.id, { ownerId: 'old-main' });
    context.db.applications.queue.updateItem(first.id, { state: 'submitting' });
    const second = context.db.applications.queue.listItems(run.id)[1];
    context.db.applications.queue.updateItem(second.id, { state: 'opening', leaseOwner: 'old-main', leaseExpiresAt: new Date(Date.now() - 1000).toISOString() });
    const recovered = context.db.applications.queue.recoverInterrupted();
    const items = context.db.applications.queue.listItems(run.id);
    assert.equal(recovered.uncertainSubmissionCount, 1);
    assert.equal(items[0].state, 'blocked');
    assert.equal(items[0].blocker.code, 'submission_outcome_uncertain');
    assert.equal(items[1].state, 'queued');
    assert.equal(context.db.applications.queue.getRun(run.id).status, 'paused');
  } finally { context.close(); }
});

test('canonical queue state contract includes the full application lifecycle', () => {
  for (const state of ['researching', 'preparing_documents', 'waiting_for_login', 'creating_account', 'waiting_for_answer', 'ready_for_review', 'verifying_browser', 'verifying_email', 'applied', 'retry_wait', 'terminal']) assert.ok(CANONICAL_APPLICATION_STATES.includes(state));
});

test('mixed application batch drains without cross-item state corruption', async () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'north-star-mixed-queue-'));
  const db = createDatabase({ userDataPath, seedPath: path.join(userDataPath, 'missing.csv') });
  try {
    const scenarios = [
      ['dice', 'Dice Co', 'https://www.dice.com/job-detail/fixture', 'ready_for_review'],
      ['workday', 'Workday Co', 'https://example.wd5.myworkdayjobs.com/job/fixture', 'waiting_for_login'],
      ['generic', 'Generic Co', 'https://careers.example.test/apply', 'waiting_for_answer'],
      ['unavailable', 'Closed Co', 'https://closed.example.test/apply', 'terminal'],
      ['email', 'Email Co', 'https://email.example.test/apply', 'verifying_email'],
    ];
    const applications = scenarios.map(([id, company, url]) => {
      db.jobs.create({ id: `mixed-${id}`, company, roleTitle: 'Engineer', url });
      return db.applications.createOrResume({ jobId: `mixed-${id}` });
    });
    const resultByApplication = new Map(applications.map((application, index) => [application.id, scenarios[index]]));
    const concurrent = new Set();
    const visited = [];
    const service = createApplicationQueueService({ repository: db.applications.queue, worker: async (item, { update }) => {
      assert.equal(concurrent.size, 0, 'only one mixed-provider item may own execution');
      concurrent.add(item.applicationId);
      const [provider, , , state] = resultByApplication.get(item.applicationId);
      visited.push(provider);
      update({ state: provider === 'unavailable' ? 'detecting_flow' : 'opening', checkpoint: { provider } });
      concurrent.delete(item.applicationId);
      return { state, checkpoint: { provider, isolatedApplicationId: item.applicationId }, blocker: state === 'terminal' ? { code: 'job_listing_unavailable', message: 'The employer listing is no longer available.' } : state.startsWith('waiting_for_') ? { code: state, message: `Action required for ${provider}.`, requiresUser: true } : {} };
    } });
    service.start({ applicationIds: applications.map((application) => application.id), mode: 'reviewed_batch' });
    await service.waitForIdle();
    assert.deepEqual(visited, scenarios.map(([provider]) => provider));
    const queue = service.status().queue;
    for (const application of applications) assert.equal(queue.find((item) => item.applicationId === application.id).checkpoint.isolatedApplicationId, application.id);
    assert.equal(queue.find((item) => item.checkpoint.provider === 'unavailable').blocker.code, 'job_listing_unavailable');
    assert.equal(service.status().counts.awaitingEmail, 1);
  } finally { db.close(); fs.rmSync(userDataPath, { recursive: true, force: true }); }
});

test('a retry wait yields to the next application instead of stalling the run', async () => {
  const context = fixture();
  try {
    const visited = [];
    const service = createApplicationQueueService({
      repository: context.db.applications.queue,
      worker: async (item) => {
        visited.push(item.applicationId);
        return item.applicationId === context.applications[0].id
          ? { state: 'retry_wait', checkpoint: { reasonCode: 'transient_browser_failure' } }
          : { state: 'terminal', checkpoint: { reasonCode: 'second_item_completed' } };
      },
    });
    service.start({ applicationIds: context.applications.map((entry) => entry.id) });
    await service.waitForIdle();
    assert.deepEqual(visited, context.applications.map((entry) => entry.id));
    const queue = service.status().queue;
    assert.equal(queue.find((item) => item.applicationId === context.applications[0].id).state, 'retry_wait');
    assert.ok(queue.find((item) => item.applicationId === context.applications[0].id).nextRetryAt);
    assert.equal(queue.find((item) => item.applicationId === context.applications[1].id).state, 'terminal');
    service.pause();
  } finally { context.close(); }
});
