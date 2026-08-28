'use strict';

// MiniSimplify engine unit + contract tests. The engine itself runs inside a
// browser page; here we pin the compiled source contract (APIs, policy
// handling, decisive-radio logic) and the main-process profile mapping.

const test = require('node:test');
const assert = require('node:assert');
const { buildMiniSimplifySource, buildMiniSimplifyProfile } = require('../electron/jobs/automation/minisimplify.cjs');

const root = require('node:path').join(__dirname, '..');
const read = (p) => require('node:fs').readFileSync(require('node:path').join(root, p), 'utf8');

test('profile mapping flattens the North Star profile onto engine fields', () => {
  const profile = buildMiniSimplifyProfile({ profile: { firstName: 'Josh', lastName: 'Rivera', email: 'josh@example.com', phone: '555-0100', city: 'Austin', state: 'TX', postalCode: '78701', street: '1 Main St', requiresSponsorship: false, veteranStatus: true, openToRelocation: false }, job: { salaryExpectation: '$120k' } });
  assert.equal(profile.fullName, 'Josh Rivera');
  assert.equal(profile.email, 'josh@example.com');
  assert.equal(profile.zip, '78701');
  assert.equal(profile.salary, '$120k');
  assert.equal(profile.sponsor, false);
  assert.equal(profile.veteran, true);
  assert.equal(profile.relocate, false);
  assert.equal(profile.remoteOk, true);
});

test('compiled source is syntactically valid JavaScript with the boot payload baked in', () => {
  const profile = buildMiniSimplifyProfile({ profile: { firstName: 'A', email: 'a@b.co' } });
  const source = buildMiniSimplifySource({ profile, policy: { route: 'autopilot', force: false } });
  assert.doesNotThrow(() => new Function(source), 'compiled MiniSimplify source must parse');
  assert.ok(source.includes('"firstName":"A"'), 'profile must be injected into the boot payload');
  assert.ok(source.includes('"route":"autopilot"'), 'policy must be injected into the boot payload');
});

test('engine pins the agreed fill policy and safety behavior', () => {
  const source = buildMiniSimplifySource({ profile: {}, policy: {} });
  // Headless document injection (no native dialog) — the autopilot enabler.
  assert.match(source, /fillFileFromBase64/);
  assert.match(source, /DataTransfer/);
  // Autopilot overwrites stale values; assistant fills empties unless forced.
  assert.match(source, /overwriteText = POLICY\.route === 'autopilot' \|\| POLICY\.force === true/);
  assert.match(source, /kept\.push/);
  // Select support.
  assert.match(source, /setSelect/);
  // Decisive-evidence-only radios; undecided groups are reported, not guessed.
  assert.match(source, /decisive/);
  assert.match(source, /undecided\.push/);
  // Post-upload verification helper stays available.
  assert.match(source, /inspectFiles/);
});

test('engine never fills fields whose question text is unrecoverable', () => {
  const source = buildMiniSimplifySource({ profile: {}, policy: {} });
  // Hash-only or framework-internal hints (React state keys like page.label,
  // hex hashes like b8af6f) must not classify as fillable fields.
  assert.match(source, /plainIdentifier/, 'plain-identifier gate for name/id attributes');
  assert.match(source, /readableText/, 'readable-text gate for visible labels');
  assert.match(source, /if \(!visible\.length && !identifiers\.length\) return null;/);
  // data-automation-id counts as vendor-applied label evidence.
  assert.match(source, /data-automation-id/);
});

test('document slot discovery pierces shadow DOM and includes hidden inputs', () => {
  const source = buildMiniSimplifySource({ profile: {}, policy: {} });
  assert.match(source, /function fileInputs\(\)/, 'shared collector for light DOM and open shadow roots');
  assert.match(source, /shadowRoot/);
  assert.match(source, /slotContextLabel/);
  assert.match(source, /checkVisibility/, 'hidden slots are reported with an accurate visibility flag');
  // Both injection and inspection use the same discovery path.
  const uses = source.match(/fileInputs\(\)/g) || [];
  assert.ok(uses.length >= 2, 'fillFileFromBase64 and inspectFiles must share fileInputs()');
});

test('EEO self-identification groups are reported as skipped, never clicked', () => {
  const source = buildMiniSimplifySource({ profile: {}, policy: {} });
  assert.match(source, /eeo_self_identification/);
  assert.match(source, /eeoGroup\.test\(g\)/);
});

test('multi-step progress detection exposes step position and safe Next controls', () => {
  const source = buildMiniSimplifySource({ profile: {}, policy: {} });
  assert.match(source, /detectProgress/);
  assert.match(source, /nextControlPresent/);
});

test('main process wires the guarded assistant and durable orchestrator routes', () => {
  const main = read('electron/main.cjs');
  assert.match(main, /createApplicationOrchestrator/);
  assert.match(main, /applicationWorkflowOrchestrator = createApplicationOrchestrator/);
  assert.match(main, /executeSafeStep: createSafeExecutor/);
  assert.match(main, /verifyStepResult: createStepVerifier/);
  // Both visible queue routes delegate to the one durable owner.
  assert.match(main, /ipcMain\.handle\('jobs:applications:workflow-queue:start'[\s\S]*?startDurableApplicationQueue\(input\)/);
  assert.match(main, /ipcMain\.handle\('jobs:applications:automation-queue:start'[\s\S]*?startDurableApplicationQueue\(input\)/);
  // Browser execution requires the assistant claim and a selected application.
  assert.match(main, /if \(!targetApplicationId\)[\s\S]*?Select the application in the AI application assistant/);
  assert.match(main, /applicationAssistantOwnerApplicationId !== targetApplicationId/);
});

test('document upload uses the guarded browser path and blocks incomplete required uploads', () => {
  const main = read('electron/main.cjs');
  const browser = read('electron/jobs/application-browser.cjs');
  assert.match(main, /ipcMain\.handle\('jobs:browser:upload-documents'/);
  assert.match(main, /applicationBrowser\.uploadDocuments\(files\)/);
  assert.match(main, /requiredUploadFailures = uploadResults\.filter\(\(entry\) => entry\.status !== 'uploaded' && !entry\.optional\)/);
  assert.match(main, /if \(requiredUploadFailures\.length\) throw new Error\(`Document upload incomplete:/);
  // Native picker and DOM upload paths both verify the selected existing file.
  assert.match(browser, /chooseNativeFile\(files\[documentType\]\)/);
  assert.match(browser, /native_dialog_accepted_existing_path/);
  assert.match(browser, /setFileInputFiles/);
});

test('renderer exposes the claimed assistant and explicit review/submission boundaries', () => {
  const preload = read('electron/preload.cjs');
  assert.match(preload, /claimApplicationAssistant/);
  assert.match(preload, /authorizeApplicationWorkflowSubmission/);
  assert.match(preload, /submitApplication/);
  const panel = read('src/jobs/ApplicationBrowserPanel.jsx');
  assert.match(panel, /claimApplicationAssistant\?\.\(\{ applicationId \}\)/);
  assert.match(panel, /Safe autopilot/);
  assert.match(panel, /Build fill details/);
  assert.match(panel, /Upload approved documents/);
  assert.match(panel, /Submit application/);
  assert.match(panel, /userApproved: true/);
  assert.match(panel, /Add to reviewed batch/);
  assert.match(panel, /Verify confirmation/);
  const drawer = read('src/jobs/ApplicationQueueDrawer.jsx');
  assert.match(drawer, /onOpenJob/);
  assert.match(drawer, /needsOpen/);
  assert.match(drawer, /state === 'ready_for_review' \? 'Review'/);
  const jobsView = read('src/JobsView.jsx');
  assert.match(jobsView, /onOpenWorkflowJob=\{openWorkflowJob\}/);
  assert.match(jobsView, /Open application assistant/);
});
