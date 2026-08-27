const test = require('node:test'); const assert = require('node:assert/strict');
const { decideNavigation, redactUrl, isDismissLabel, buildContextMenuTemplate, handleMouseNavigationInput, createApplicationBrowser } = require('../electron/jobs/application-browser.cjs');
test('safe dismissal accepts provider overlay variants without broad substring matching', () => {
  assert.equal(isDismissLabel('No thanks, take me to the job'), true);
  assert.equal(isDismissLabel('Close this alert'), true);
  assert.equal(isDismissLabel('Related jobs'), false);
  assert.equal(isDismissLabel('Thanks for applying'), false);
});
test('browser navigation is HTTPS-only and new-host popups can be routed through a user checkpoint', () => {
  assert.equal(decideNavigation({ fromUrl: 'https://a.test/x', toUrl: 'http://a.test/y' }).action, 'deny');
  assert.equal(decideNavigation({ fromUrl: 'https://a.test/x', toUrl: 'https://b.test/y' }).action, 'ask_user');
  assert.equal(decideNavigation({ fromUrl: 'https://a.test/x', toUrl: 'https://b.test/apply?role=123', approvedHosts: new Set(['b.test']) }).action, 'allow');
  assert.equal(redactUrl('https://a.test/path?q=secret#token'), 'https://a.test/path');
});

test('browser context menu copies selected employer-page text in the remote view', () => {
  const calls = [];
  const webContents = {
    canGoBack: () => false,
    canGoForward: () => false,
    copy: () => calls.push('copy'),
    cut: () => calls.push('cut'),
    paste: () => calls.push('paste'),
    selectAll: () => calls.push('select-all'),
    reload: () => calls.push('reload'),
  };
  const template = buildContextMenuTemplate({
    params: { selectionText: 'selected job description', editFlags: { canCopy: true } },
    webContents,
    clipboard: { writeText: () => {} },
  });
  const copy = template.find((item) => item.label === 'Copy');

  assert.equal(copy.enabled, true);
  copy.click();
  assert.deepEqual(calls, ['copy']);
});

test('mouse side buttons use the embedded browser history', () => {
  const calls = [];
  const webContents = {
    canGoBack: () => true,
    canGoForward: () => true,
    goBack: () => calls.push('back'),
    goForward: () => calls.push('forward'),
  };

  assert.equal(handleMouseNavigationInput({ type: 'mouseDown', mouseButton: 'back' }, webContents), true);
  assert.equal(handleMouseNavigationInput({ type: 'mouseDown', mouseButton: 'forward' }, webContents), true);
  assert.equal(handleMouseNavigationInput({ type: 'keyDown', key: 'Backspace' }, webContents), false);
  assert.deepEqual(calls, ['back', 'forward']);
});

test('browser resumes from a persisted redacted checkpoint URL', async () => {
  const EventEmitter = require('node:events');
  const loaded = [];
  const webContents = new EventEmitter();
  webContents.isDestroyed = () => false;
  webContents.getURL = () => loaded.at(-1) || '';
  webContents.executeJavaScript = async () => ({ url: webContents.getURL(), title: 'Application', fields: [] });
  webContents.loadURL = async (url) => { loaded.push(url); webContents.emit('did-finish-load'); };
  webContents.close = () => {};
  webContents.setWindowOpenHandler = () => {};
  webContents.canGoBack = () => false;
  webContents.canGoForward = () => false;
  webContents.debugger = { isAttached: () => false, attach() {}, detach() {}, sendCommand: async () => ({ result: { objectId: 'document' } }) };
  class WebContentsView { constructor() { this.webContents = webContents; } setBounds() {} }
  const adapter = createApplicationBrowser({
    electron: { WebContentsView, session: { fromPartition: () => ({ setPermissionCheckHandler() {}, setPermissionRequestHandler() {} }) }, Menu: { buildFromTemplate: () => ({ popup() {} }) }, clipboard: { writeText() {} } },
    getApplicationUrl: () => 'https://listing.example/jobs/1',
    attachView: () => {},
    detachView: () => {}
  });
  await adapter.open({ applicationId: 'resume-application', resumeUrl: 'https://ats.example/apply/step-2' });
  assert.deepEqual(loaded, ['https://ats.example/apply/step-2']);
});
