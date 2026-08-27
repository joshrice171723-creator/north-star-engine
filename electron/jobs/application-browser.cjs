const path = require('node:path');
const { chooseNativeFile } = require('./native-file-picker.cjs');
const { normalizeSnapshot, INSPECTION_SCRIPT, PAGE_STATUS_SCRIPT } = require('./application-inspector.cjs');
const { buildFillPlan, validatePlanForFill } = require('./application-fill-engine.cjs');
const { detectConfirmation } = require('./application-confirmation.cjs');
const redactUrl = (value) => { try { const url = new URL(value); return `${url.origin}${url.pathname}`; } catch { return ''; } };
const isHttps = (value) => { try { return new URL(value).protocol === 'https:'; } catch { return false; } };
// Provider overlays often append safe explanatory text to a dismissal label,
// such as "No thanks, take me to the job". Keep this a bounded prefix match so
// recovery can dismiss known popup variants without clicking arbitrary text.
const isDismissLabel = (value) => /^(?:no thanks|close|dismiss|not now|skip|decline|reject cookies)\b/i.test(String(value || '').replace(/\s+/g, ' ').trim());
function decideNavigation({ fromUrl, toUrl, isMainFrame = true, approvedHosts = new Set() }) { if (!isMainFrame || !isHttps(toUrl)) return { action: 'deny', reason: 'only_main_frame_https' }; const target = new URL(toUrl); if (!fromUrl || new URL(fromUrl).origin === target.origin || approvedHosts.has(target.host)) return { action: 'allow', reason: 'same_or_approved_origin' }; return { action: 'ask_user', reason: 'new_https_host', host: target.host }; }

function buildContextMenuTemplate({ params = {}, webContents, clipboard }) {
  const editFlags = params.editFlags || {};
  const hasSelection = Boolean(params.selectionText?.trim());
  const hasLink = Boolean(params.linkURL);
  // Invoke editing commands on the isolated employer page itself. A role-only
  // menu can target the React window instead when a WebContentsView has focus.
  return [
    { label: 'Back', enabled: Boolean(webContents.canGoBack()), click: () => webContents.goBack() },
    { label: 'Forward', enabled: Boolean(webContents.canGoForward()), click: () => webContents.goForward() },
    { label: 'Reload', click: () => webContents.reload() },
    { type: 'separator' },
    { label: 'Cut', enabled: Boolean(params.isEditable && editFlags.canCut), click: () => webContents.cut() },
    { label: 'Copy', enabled: Boolean(hasSelection || editFlags.canCopy), click: () => webContents.copy() },
    { label: 'Paste', enabled: Boolean(params.isEditable && editFlags.canPaste), click: () => webContents.paste() },
    { label: 'Select all', enabled: editFlags.canSelectAll !== false, click: () => webContents.selectAll() },
    { type: 'separator' },
    { label: 'Copy link address', enabled: hasLink, click: () => clipboard.writeText(params.linkURL) },
  ];
}

function handleMouseNavigationInput(input, webContents) {
  if (input?.type !== 'mouseDown') return false;
  const button = input.mouseButton || input.button;
  if (button === 'back') {
    if (webContents.canGoBack()) webContents.goBack();
    return true;
  }
  if (button === 'forward') {
    if (webContents.canGoForward()) webContents.goForward();
    return true;
  }
  return false;
}

function createApplicationBrowser({ electron, getApplicationUrl, attachView = () => {}, detachView = () => {}, onSnapshot = () => {}, onState = () => {} }) {
  const { WebContentsView, session, Menu, clipboard } = electron; let view = null; let active = null;
  const hide = () => { if (view) view.setBounds({ x: 0, y: 0, width: 1, height: 1 }); };
  const inspect = async () => { if (!view || view.webContents.isDestroyed()) return null; const raw = await view.webContents.executeJavaScript(INSPECTION_SCRIPT, true); const pageSignals = await view.webContents.executeJavaScript(PAGE_STATUS_SCRIPT, true).catch(() => []); const snapshot = normalizeSnapshot({ ...raw, pageSignals }); active.snapshot = snapshot; active.lastObservedAt = new Date().toISOString(); onSnapshot(active); return snapshot; };
  const open = async ({ applicationId, resumeUrl = '' }) => { const initialUrl = resumeUrl || getApplicationUrl(applicationId); if (!isHttps(initialUrl)) throw new Error('The saved application URL must use HTTPS.'); close(); active = { applicationId, initialHost: new URL(initialUrl).host, approvedHosts: new Set([new URL(initialUrl).host]), snapshot: null, plans: new Map(), currentUrl: redactUrl(initialUrl), status: 'navigating' };
    view = new WebContentsView({ webPreferences: { partition: 'persist:job-application-copilot', contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } }); attachView(view);
    const appSession = session.fromPartition('persist:job-application-copilot');
    // Both handlers are installed because Chromium may consult either path depending on API.
    appSession.setPermissionCheckHandler(() => false); appSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    const requestNavigation = async (url, isMainFrame = true) => {
      const decision = decideNavigation({ fromUrl: view.webContents.getURL(), toUrl: url, isMainFrame, approvedHosts: active.approvedHosts });
      if (decision.action === 'allow') return view.webContents.loadURL(url);
      if (decision.action === 'ask_user') {
        // Application providers commonly hand off from a job board to a separate
        // ATS host. Approve that HTTPS handoff automatically within this isolated
        // session so the user is not interrupted mid-apply.
        active.approvedHosts.add(decision.host);
        return view.webContents.loadURL(url);
      }
      return null;
    };
    // Remote pages never receive a second window. A user-triggered target=_blank link
    // is routed through the same isolated view and the normal host checkpoint instead.
    view.webContents.setWindowOpenHandler(({ url }) => { requestNavigation(url, true).catch(() => {}); return { action: 'deny' }; });
    view.webContents.on('before-input-event', (event, input) => {
      // Electron reports mouse side buttons as navigation input. Consume them
      // here so the isolated employer page owns history instead of the shell.
      if (handleMouseNavigationInput(input, view.webContents)) event.preventDefault();
    });
    view.webContents.on('context-menu', (_event, params) => {
      Menu.buildFromTemplate(buildContextMenuTemplate({ params, webContents: view.webContents, clipboard })).popup();
    });
    const sessionView = view;
    const guard = (event, url, details = {}) => {
      // A redirect can arrive after the queue has closed this view. Ignore that
      // stale event instead of dereferencing the replacement session or null.
      if (view !== sessionView || !active || !sessionView.webContents || sessionView.webContents.isDestroyed()) return;
      const decision = decideNavigation({ fromUrl: sessionView.webContents.getURL(), toUrl: url, isMainFrame: details.isMainFrame !== false, approvedHosts: active.approvedHosts });
      if (decision.action !== 'allow') { event.preventDefault(); requestNavigation(url, details.isMainFrame !== false).catch(() => {}); }
    };
    sessionView.webContents.on('will-navigate', guard); sessionView.webContents.on('will-redirect', guard); sessionView.webContents.on('did-finish-load', async () => { if (view !== sessionView || !active || sessionView.webContents.isDestroyed()) return; active.currentUrl = redactUrl(sessionView.webContents.getURL()); active.status = 'observing'; try { await inspect(); onState(active); } catch { onState({ ...active, error: 'Inspection was unavailable for this page.' }); } });
    await view.webContents.loadURL(initialUrl); if (!active.snapshot) await inspect(); return publicState(); };
  const approveHost = async (host) => { if (!active?.pendingHost || host !== active.pendingHost || !active.pendingUrl) throw new Error('No matching navigation approval is pending.'); const pendingUrl = active.pendingUrl; active.approvedHosts.add(host); active.pendingHost = ''; active.pendingUrl = ''; await view.webContents.loadURL(pendingUrl); return publicState(); };
  const createFillPlan = async (profile, aiDecisions = {}, diagnostics = {}) => { if (!active) throw new Error('Open an application page before building a fill plan.'); const snapshot = await inspect(); const plan = buildFillPlan({ sessionId: active.applicationId, applicationId: active.applicationId, pageFingerprint: snapshot.pageFingerprint, fields: snapshot.fields, profile, aiDecisions, diagnostics }); active.plans.set(plan.id, plan); return plan; };
  const fillPlan = async (planId, profile = {}) => {
    if (!active?.plans.has(planId)) throw new Error('Fill plan not found. Build and review a new plan.');
    const plan = active.plans.get(planId); const snapshot = await inspect();
    const permitted = validatePlanForFill({ plan, currentPageFingerprint: snapshot.pageFingerprint, fields: snapshot.fields, profile });
    const byFingerprint = new Map(snapshot.fields.map((field) => [field.fieldFingerprint, field]));
    const operations = permitted.filter((entry) => entry.action === 'fill' && entry.displayValue).map((entry) => ({ ...entry, field: byFingerprint.get(entry.fieldFingerprint) })).filter((entry) => entry.field && (['input', 'textarea'].includes(entry.field.elementType) && ['text', 'email', 'tel', 'url', 'number', 'date', 'search', 'textarea', ''].includes(entry.field.inputType) || entry.field.elementType === 'select'));
    if (!operations.length) return { attempted: 0, results: [], reason: 'No approved supported fields are currently eligible.' };
    const debuggerClient = view.webContents.debugger; let attached = false; const results = [];
    try {
      if (!debuggerClient.isAttached()) { debuggerClient.attach('1.3'); attached = true; }
      const documentRef = await debuggerClient.sendCommand('Runtime.evaluate', { expression: 'document', returnByValue: false });
      // CDP contract: arguments: [{ value: operations }] is represented by a
      // per-operation structured argument below so each live field is rechecked.
      // Re-query the live DOM for every field. React/Vue employer forms can replace
      // sibling controls after input/change, making one bulk query stale after field one.
      for (const operation of operations) {
        const currentSnapshot = await inspect();
        const currentField = currentSnapshot.fields.find((field) => field.fieldFingerprint === operation.fieldFingerprint);
        if (!currentField) { results.push({ fieldFingerprint: operation.fieldFingerprint, status: 'failed', reason: 'field_changed' }); continue; }
        const currentPlan = { ...plan, pageFingerprint: currentSnapshot.pageFingerprint };
        const currentEntry = validatePlanForFill({ plan: currentPlan, currentPageFingerprint: currentSnapshot.pageFingerprint, fields: currentSnapshot.fields, profile }).find((entry) => entry.fieldFingerprint === operation.fieldFingerprint);
        if (!currentEntry?.displayValue) { results.push({ fieldFingerprint: operation.fieldFingerprint, status: 'blocked', reason: currentEntry?.reasonCode || 'field_changed' }); continue; }
        const result = await debuggerClient.sendCommand('Runtime.callFunctionOn', { objectId: documentRef.result.objectId, returnByValue: true, functionDeclaration: `function (op) { const clean = (v) => String(v || '').replace(/\\s+/g, ' ').trim(); const label = (el) => { const linked = el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); return clean(linked?.innerText || el.closest('label')?.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder')); }; const candidates = Array.from(document.querySelectorAll('input,select,textarea')).filter((el) => el.type !== 'hidden' && el.tagName.toLowerCase() === op.field.elementType && (el.tagName.toLowerCase() === 'select' || String(el.type || '').toLowerCase() === op.field.inputType)); const matches = candidates.filter((el) => { const sameLabel = !op.field.label || label(el) === op.field.label; const sameId = op.field.id && el.id === op.field.id; const sameName = op.field.name && clean(el.name) === op.field.name; const sameAutocomplete = op.field.autocomplete && clean(el.autocomplete) === op.field.autocomplete; return sameLabel && (sameId || sameName || sameAutocomplete || (!op.field.id && !op.field.name && !op.field.autocomplete)); }); if (matches.length !== 1) return { fieldFingerprint: op.fieldFingerprint, status: 'failed', reason: 'ambiguous_or_changed' }; const el = matches[0]; if (el.disabled || el.readOnly || (!op.replaceExisting && String(el.value || '').trim())) return { fieldFingerprint: op.fieldFingerprint, status: 'skipped', reason: 'protected_or_user_entered' }; if (el.tagName.toLowerCase() === 'select') { const wanted = clean(op.displayValue).toLowerCase(); const option = Array.from(el.options).find((item) => clean(item.text).toLowerCase() === wanted || clean(item.value).toLowerCase() === wanted); if (!option) return { fieldFingerprint: op.fieldFingerprint, status: 'failed', reason: 'option_not_found' }; el.value = option.value; } else { const prototype = el.tagName.toLowerCase() === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set; if (!setter) return { fieldFingerprint: op.fieldFingerprint, status: 'failed', reason: 'value_setter_unavailable' }; setter.call(el, op.displayValue); } el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); const verified = el.tagName.toLowerCase() === 'select' ? clean(el.options[el.selectedIndex]?.text || el.value).toLowerCase() === clean(op.displayValue).toLowerCase() || clean(el.value).toLowerCase() === clean(op.displayValue).toLowerCase() : String(el.value) === op.displayValue; return { fieldFingerprint: op.fieldFingerprint, status: verified ? 'filled' : 'failed', reason: verified ? 'verified' : 'rejected' }; }`, arguments: [{ value: { ...operation, replaceExisting: currentField.category === 'identity_contact', field: { ...currentField, id: currentField.id || operation.field.id, name: currentField.name || operation.field.name, autocomplete: currentField.autocomplete || operation.field.autocomplete }, displayValue: currentEntry.displayValue } }] });
        results.push(result.result.value || { fieldFingerprint: operation.fieldFingerprint, status: 'failed', reason: 'no_result' });
      }
      await inspect(); return { attempted: operations.length, results };
    } finally { if (attached && debuggerClient.isAttached()) debuggerClient.detach(); }
  };
  const executeOnDocument = async (functionDeclaration, argument) => {
    if (!view || view.webContents.isDestroyed()) throw new Error('The application browser is not open.');
    const debuggerClient = view.webContents.debugger; let attached = false;
    try {
      if (!debuggerClient.isAttached()) { debuggerClient.attach('1.3'); attached = true; }
      const documentRef = await debuggerClient.sendCommand('Runtime.evaluate', { expression: 'document', returnByValue: false });
      const result = await debuggerClient.sendCommand('Runtime.callFunctionOn', { objectId: documentRef.result.objectId, returnByValue: true, functionDeclaration, arguments: [{ value: argument }] });
      return result.result?.value;
    } finally { if (attached && debuggerClient.isAttached()) debuggerClient.detach(); }
  };
  const inspectUploadControls = async () => {
    const controls = await executeOnDocument(`function () {
      const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const context = (element) => {
        let node = element;
        const parts = [];
        for (let depth = 0; node && depth < 4; depth += 1, node = node.parentElement) parts.push(node.innerText || '');
        return clean([element.id, element.name, element.getAttribute('aria-label'), element.getAttribute('accept'), ...parts].join(' ')).slice(0, 500);
      };
      return Array.from(document.querySelectorAll('input[type="file"],button,a,label,[role="button"],[role="menuitem"]'))
        .filter((element) => !element.disabled && element.getAttribute('aria-hidden') !== 'true' && element.offsetParent !== null)
        .slice(0, 80)
        .map((element) => ({ tag: element.tagName.toLowerCase(), label: clean(element.innerText || element.value || element.getAttribute('aria-label') || element.getAttribute('placeholder')), accept: clean(element.getAttribute('accept')), context: context(element) }));
    }`);
    return { pageFingerprint: active?.snapshot?.pageFingerprint || '', controls: Array.isArray(controls) ? controls : [] };
  };
  const uploadDocuments = async (files = {}, options = {}) => {
    const requested = ['resume', 'cover_letter'].filter((type) => typeof files[type] === 'string' && files[type].trim());
    if (!requested.length) throw new Error('No approved application document was provided.');
    const snapshot = await inspect();
    // File controls are often created only after the visible drop zone is
    // activated. Inspect visible context first so an optional cover letter is
    // never mistaken for a missing required application field.
    const coverLetterOptional = Boolean((await executeOnDocument(`function () { const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim().toLowerCase(); const context = (el) => { let node = el; const parts = []; for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) parts.push(node.innerText || el.getAttribute('aria-label') || ''); return clean(parts.join(' ')); }; return Array.from(document.querySelectorAll('input[type="file"],button,a,[role="button"],label,[role="presentation"]')).filter((el) => !el.disabled && el.offsetParent !== null).some((el) => /cover|letter|writing sample/.test(context(el)) && /\boptional\b/.test(context(el))); }`).catch(() => false)));
    const results = [];
    for (const documentType of requested) {
      const repairTarget = options.repairTargets?.[documentType];
      let repairActivated = false;
      // Prefer a DOM file input when it already exists. Clicking a provider's
      // visible Attach/Choose File control first can open a native picker and
      // block CDP before DOM.setFileInputFiles gets a chance to run.
      const existingInput = await executeOnDocument(`function (type) {
        const clean = (v) => String(v || '').replace(/\\s+/g, ' ').trim().toLowerCase();
        const context = (el) => {
          let node = el;
          const parts = [];
          for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) parts.push(node.innerText || '');
          return clean([el.id, el.name, el.getAttribute('aria-label'), el.getAttribute('accept'), ...parts].join(' '));
        };
        const inputs = Array.from(document.querySelectorAll('input[type="file"]')).filter((el) => !el.disabled && !el.readOnly);
        const match = inputs.find((el) => { const text = context(el); return type === 'resume' ? /resume|cv/.test(text) : /cover|letter|writing sample/.test(text); });
        // A lone unlabeled input is not enough to prove that it belongs to
        // this document type. In particular, a visible cover-letter drop zone
        // can coexist with the profile's resume input; treating that resume
        // input as reusable would upload the resume into the cover-letter slot.
        return match || inputs.length > 1 ? { status: 'available', inputCount: inputs.length } : { status: 'missing' };
      }`, documentType);
      if (repairTarget?.label && existingInput?.status !== 'available') {
        const activated = await executeOnDocument(`function (request) {
          const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
          const context = (element) => { let node = element; const parts = []; for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) parts.push(node.innerText || ''); return clean(parts.join(' ')).toLowerCase(); };
          const controls = Array.from(document.querySelectorAll('button,a,label,[role="button"],[role="menuitem"]')).filter((element) => !element.disabled && element.getAttribute('aria-hidden') !== 'true' && element.offsetParent !== null);
          const matches = controls.filter((element) => clean(element.innerText || element.value || element.getAttribute('aria-label') || element.getAttribute('placeholder')) === clean(request.label));
          if (!matches.length) return { status: 'blocked', reason: 'upload_repair_target_missing' };
          const term = request.documentType === 'cover_letter' ? /cover|letter|writing sample/ : /resume|cv/;
          matches.sort((a, b) => Number(term.test(context(b))) - Number(term.test(context(a))) || a.getBoundingClientRect().top - b.getBoundingClientRect().top);
          if (!term.test(context(matches[0]))) return { status: 'blocked', reason: 'upload_repair_target_wrong_document' };
          matches[0].focus(); matches[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          return { status: 'activated' };
        }`, { label: repairTarget.label, documentType });
        if (activated?.status === 'activated') { repairActivated = true; await new Promise((resolve) => setTimeout(resolve, 600)); }
      }
      let result = await executeOnDocument(`function (type) { const clean = (v) => String(v || '').replace(/\\s+/g, ' ').trim().toLowerCase(); const context = (el) => { let node = el; const parts = []; for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) parts.push(node.innerText || ''); return clean([el.id, el.name, el.getAttribute('aria-label'), el.getAttribute('accept'), ...parts].join(' ')); }; const inputs = Array.from(document.querySelectorAll('input[type="file"]')).filter((el) => !el.disabled && !el.readOnly); const match = inputs.find((el) => { const text = context(el); return type === 'resume' ? /resume|cv/.test(text) : /cover|letter|writing sample/.test(text); }); if (!match && type === 'resume' && Array.from(document.querySelectorAll('button,a,[role="button"]')).some((el) => clean(el.innerText || el.textContent || el.getAttribute('aria-label')) === 'file options')) return { status: 'options' }; if (!match && inputs.length === 1) return { status: 'candidate', inputCount: 1 }; if (!match && inputs.length > 1) return { status: 'candidate', inputCount: inputs.length, fallbackIndex: type === 'resume' ? 0 : 1 }; if (!match) return { status: 'missing' }; return { status: 'ready', selector: match.id ? '#' + CSS.escape(match.id) : '', inputCount: inputs.length }; }`, documentType);
      if (result?.status === 'missing' && repairActivated) {
        // Some ATS widgets invoke the Windows picker directly and never mount
        // an input element. Let the bounded OS fallback finish that action,
        // then rescan; if the provider still exposes no input, verify the
        // expected filename in its visible upload surface.
        const native = await chooseNativeFile(files[documentType]);
        if (native.status === 'selected') {
          await new Promise((resolve) => setTimeout(resolve, 700));
          result = await executeOnDocument(`function (type) { const clean = (v) => String(v || '').replace(/\\s+/g, ' ').trim().toLowerCase(); const context = (el) => { let node = el; const parts = []; for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) parts.push(node.innerText || ''); return clean([el.id, el.name, el.getAttribute('aria-label'), el.getAttribute('accept'), ...parts].join(' ')); }; const inputs = Array.from(document.querySelectorAll('input[type="file"]')).filter((el) => !el.disabled && !el.readOnly); const match = inputs.find((el) => { const text = context(el); return type === 'resume' ? /resume|cv/.test(text) : /cover|letter|writing sample/.test(text); }); return match ? { status: 'ready', inputCount: inputs.length } : inputs.length ? { status: 'candidate', inputCount: inputs.length } : { status: 'native_selected' }; }`, documentType);
          if (result?.status === 'native_selected') {
            // A native picker does not expose the selected File object back to
            // CDP. The picker accepted an existing exact path, so that dialog
            // acknowledgement is the verification boundary for this class of
            // provider; DOM-backed controls still use filename verification.
            results.push({ documentType, status: 'uploaded', nativePicker: true, verification: 'native_dialog_accepted_existing_path', optional: documentType === 'cover_letter' && coverLetterOptional, pageFingerprint: snapshot.pageFingerprint });
            continue;
          }
        }
      }
      if (result?.status === 'missing') {
        const autofill = await executeOnDocument(`function () { const clean = (v) => String(v || '').replace(/\\s+/g, ' ').trim().toLowerCase(); const controls = Array.from(document.querySelectorAll('button,a,[role="button"]')).filter((el) => !el.disabled && el.offsetParent !== null); const match = controls.find((el) => clean(el.innerText || el.textContent || el.getAttribute('aria-label')) === 'autofill my application'); if (!match) return { status: 'missing' }; match.focus(); match['click'](); return { status: 'activated' }; }`);
        if (autofill?.status === 'activated') {
          for (let attempt = 0; attempt < 6; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            result = await executeOnDocument(`function (type) { const clean = (v) => String(v || '').replace(/\\s+/g, ' ').trim().toLowerCase(); const context = (el) => { let node = el; const parts = []; for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) parts.push(node.innerText || ''); return clean([el.id, el.name, el.getAttribute('aria-label'), el.getAttribute('accept'), ...parts].join(' ')); }; const inputs = Array.from(document.querySelectorAll('input[type="file"]')).filter((el) => !el.disabled && !el.readOnly); const match = inputs.find((el) => { const text = context(el); return type === 'resume' ? /resume|cv/.test(text) : /cover|letter|writing sample/.test(text); }); return match ? { status: 'ready', inputCount: inputs.length } : inputs.length ? { status: 'candidate', inputCount: inputs.length } : { status: 'missing' }; }`, documentType);
            if (result?.status !== 'missing') break;
          }
        }
      }
      if (result?.status === 'options') {
        await executeOnDocument(`function () { const clean = (v) => String(v || '').replace(/\\s+/g, ' ').trim().toLowerCase(); const controls = Array.from(document.querySelectorAll('button,a,[role="button"]')); const options = controls.find((el) => clean(el.innerText || el.textContent || el.getAttribute('aria-label')) === 'file options'); if (!options) return { status: 'blocked', reason: 'file_options_not_found' }; options.focus(); options['click'](); return { status: 'activated' }; }`);
        await new Promise((resolve) => setTimeout(resolve, 600));
        await executeOnDocument(`function () { const clean = (v) => String(v || '').replace(/\\s+/g, ' ').trim().toLowerCase(); const controls = Array.from(document.querySelectorAll('button,a,[role="button"],[role="menuitem"]')); const replacement = controls.find((el) => /^(?:replace(?: .*)?|upload (?:a )?new (?:resume|file)|choose another resume)$/.test(clean(el.innerText || el.textContent || el.getAttribute('aria-label')))); if (!replacement) return { status: 'blocked', reason: 'resume_replacement_not_found' }; replacement.focus(); replacement['click'](); return { status: 'activated' }; }`);
        await new Promise((resolve) => setTimeout(resolve, 600));
        result = await executeOnDocument(`function (type) { const clean = (v) => String(v || '').replace(/\\s+/g, ' ').trim().toLowerCase(); const context = (el) => { let node = el; const parts = []; for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) parts.push(node.innerText || ''); return clean([el.id, el.name, el.getAttribute('aria-label'), el.getAttribute('accept'), ...parts].join(' ')); }; const inputs = Array.from(document.querySelectorAll('input[type="file"]')).filter((el) => !el.disabled && !el.readOnly); const match = inputs.find((el) => { const text = context(el); return type === 'resume' ? /resume|cv/.test(text) : /cover|letter|writing sample/.test(text); }); if (match) return { status: 'ready', inputCount: inputs.length }; if (inputs.length === 1) return { status: 'candidate', inputCount: 1 }; if (inputs.length > 1) return { status: 'candidate', inputCount: inputs.length, fallbackIndex: type === 'resume' ? 0 : 1 }; return { status: 'missing' }; }`, documentType);
      }
      if (result?.status === 'missing' && documentType === 'cover_letter') {
        const activated = await executeOnDocument(`function () { const clean = (v) => String(v || '').replace(/\\s+/g, ' ').trim().toLowerCase(); const controls = Array.from(document.querySelectorAll('button,a,[role="button"],label,[role="presentation"]')).filter((el) => !el.disabled && el.offsetParent !== null); const upload = controls.find((el) => /^(upload your cover letter|upload cover letter|choose file)$/.test(clean(el.innerText || el.textContent || el.getAttribute('aria-label')))); if (!upload) return { status: 'missing' }; upload.focus(); upload['click'](); return { status: 'activated' }; }`);
        if (activated?.status === 'activated') {
          // Custom upload widgets may create their file input asynchronously
          // after the visible drop zone is activated; poll briefly before
          // classifying the cover letter as missing.
          for (let attempt = 0; attempt < 6; attempt += 1) {
            result = await executeOnDocument(`function () { const inputs = Array.from(document.querySelectorAll('input[type="file"]')).filter((el) => !el.disabled && !el.readOnly); return inputs.length ? { status: 'candidate', inputCount: inputs.length } : { status: 'missing' }; }`);
            if (result?.status === 'candidate') break;
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }
      }
      if (!['ready', 'candidate'].includes(result?.status)) { results.push({ documentType, status: result?.status || 'missing', optional: documentType === 'cover_letter' && coverLetterOptional, pageFingerprint: snapshot.pageFingerprint }); continue; }
      const debuggerClient = view.webContents.debugger; let attached = false;
      try {
        if (!debuggerClient.isAttached()) { debuggerClient.attach('1.3'); attached = true; }
        const documentRef = await debuggerClient.sendCommand('Runtime.evaluate', { expression: 'document', returnByValue: false });
        const node = await debuggerClient.sendCommand('Runtime.callFunctionOn', { objectId: documentRef.result.objectId, returnByValue: false, functionDeclaration: `function (type) { const clean = (v) => String(v || '').replace(/\\s+/g, ' ').trim().toLowerCase(); const context = (el) => { let node = el; const parts = []; for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) parts.push(node.innerText || ''); return clean([el.id, el.name, el.getAttribute('aria-label'), el.getAttribute('accept'), ...parts].join(' ')); }; const inputs = Array.from(document.querySelectorAll('input[type="file"]')).filter((el) => !el.disabled && !el.readOnly); const match = inputs.find((el) => { const text = context(el); return type === 'resume' ? /resume|cv/.test(text) : /cover|letter|writing sample/.test(text); }); return match || inputs[type === 'resume' ? 0 : 1] || null; }`, arguments: [{ value: documentType }] });
        if (!node.result?.objectId) throw new Error('The document upload control changed.');
        await debuggerClient.sendCommand('DOM.getDocument');
        const { nodeId } = await debuggerClient.sendCommand('DOM.requestNode', { objectId: node.result.objectId });
        await debuggerClient.sendCommand('DOM.setFileInputFiles', { nodeId, files: [files[documentType]] });
        const assignedName = await debuggerClient.sendCommand('Runtime.callFunctionOn', { objectId: node.result.objectId, returnByValue: true, functionDeclaration: "function () { return this.files && this.files[0] ? this.files[0].name : ''; }" });
        const expectedName = path.basename(files[documentType]);
        if (assignedName.result?.value !== expectedName) throw new Error(`The ${documentType} upload control received ${assignedName.result?.value || 'no file'} instead of ${expectedName}.`);
        results.push({ documentType, status: 'uploaded', optional: documentType === 'cover_letter' && coverLetterOptional, pageFingerprint: snapshot.pageFingerprint });
      } finally { if (attached && debuggerClient.isAttached()) debuggerClient.detach(); }
    }
    await inspect(); return { results };
  };
  const advance = async ({ handoffOnly = false, googleLoginOnly = false, accountOnly = false } = {}) => {
    const snapshot = await inspect();
    if (snapshot.pageSignals?.length) return { status: 'unavailable', reason: 'job_listing_unavailable', signals: snapshot.pageSignals, pageFingerprint: snapshot.pageFingerprint };
    const dismiss = snapshot.fields.find((field) => isDismissLabel(field.label));
    const dismissed = await executeOnDocument(`function (expectedLabel) { const clean = (v) => String(v || '').replace(/\\s+/g, ' ').trim(); const safe = (v) => /^(?:no thanks|close|dismiss|not now|skip|decline|reject cookies)\\b/i.test(clean(v)); const controls = Array.from(document.querySelectorAll('button,input[type="button"],a,a[role="button"],[role="link"],[role="button"],div,span')).filter((el) => !el.disabled && el.getAttribute('aria-hidden') !== 'true' && el.offsetParent !== null && (el.getAttribute('role') || el.onclick || getComputedStyle(el).cursor === 'pointer')); const matches = controls.filter((el) => { const label = clean(el.innerText || el.value || el.getAttribute('aria-label')); return expectedLabel ? label === expectedLabel : safe(label); }); if (!matches.length) return { status: 'not_found' }; matches.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top); matches[0]['click'](); return { status: 'activated' }; }`, dismiss?.label || '');
    if (dismissed?.status === 'activated') { await new Promise((resolve) => setTimeout(resolve, 250)); return advance({ handoffOnly, googleLoginOnly, accountOnly }); }
    const allowedLabel = accountOnly ? /^(create account|register|sign up)$/i : googleLoginOnly ? /^continue with google$/i : handoffOnly ? /^(?:easy )?apply(?: now| for this job| on company site| externally)?$|^continue application$|^view application$/i : /^(next|continue|continue application|continue with google|save and continue|proceed|review|easy apply|apply|apply now|apply for this job|apply on company site|apply externally|view application)$/i;
    const exactLabels = accountOnly ? ['Create account', 'Register', 'Sign up'] : googleLoginOnly ? ['Continue with Google'] : handoffOnly ? ['Apply', 'Apply Now', 'Easy Apply', 'Apply for this job', 'Apply on company site', 'Apply externally', 'Continue Application', 'View application'] : ['Next', 'Continue', 'Continue Application', 'Continue with Google', 'Save and continue', 'Proceed', 'Review', 'Easy Apply', 'Apply', 'Apply Now', 'Apply for this job', 'Apply on company site', 'Apply externally', 'View application'];
    // Job boards frequently render Apply as an anchor styled like a button.
    // The category is the safety boundary; the DOM element type is not.
    const candidate = snapshot.fields.find((field) => field.category === 'navigation' && allowedLabel.test(field.label));
    // Some job-board variants expose the same safe handoff as a styled anchor
    // without a button role. Keep the fallback exact-label and visible-only so
    // recipe recovery cannot click arbitrary links.
    const result = await executeOnDocument(`function (labels) { const clean = (v) => String(v || '').replace(/\\s+/g, ' ').trim(); const controls = Array.from(document.querySelectorAll('button,input[type="button"],a[role="button"],a[href]')).filter((el) => !el.disabled && el.getAttribute('aria-hidden') !== 'true' && el.offsetParent !== null); const matches = controls.filter((el) => labels.some((label) => clean(el.innerText || el.value || el.getAttribute('aria-label')).toLowerCase() === label.toLowerCase())); if (!matches.length) return { status: 'blocked', reason: 'next_control_not_found' }; matches.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top); const firstTop = matches[0].getBoundingClientRect().top; if (matches.filter((el) => Math.abs(el.getBoundingClientRect().top - firstTop) < 40).length > 1) return { status: 'blocked', reason: 'next_control_changed' }; const el = matches[0]; el.focus(); // Prefer the primary top-of-page handoff over related-job links lower in the page.
      // Native click dispatch is required by SPA employer controls that ignore a manually constructed MouseEvent.
      el['click'](); return { status: 'activated' }; }`, candidate?.label ? [candidate.label] : exactLabels);
    if (result?.status !== 'activated') return result || { status: 'blocked', reason: 'next_control_failed' };
    await new Promise((resolve) => setTimeout(resolve, 150));
    const nextSnapshot = await inspect(); return { status: 'advanced', previousPageFingerprint: snapshot.pageFingerprint, pageFingerprint: nextSnapshot.pageFingerprint };
  };
  const clickSafeControl = async ({ action = '', targetLabel = '' } = {}) => {
    const snapshot = await inspect(); const label = String(targetLabel || '').replace(/\s+/g, ' ').trim();
    const allowed = action === 'dismiss' ? isDismissLabel : action === 'handoff' ? /^(?:easy )?apply(?: now| for this job| on company site| externally)?$|^continue application$|^view application$/i : /^(next|continue|save and continue|proceed|review)$/i;
    // Recovery may target a visible anchor as well as a button. Keep the
    // exact label/category/allowlist checks so broader anchor support cannot
    // turn an AI suggestion into arbitrary navigation.
    const candidate = snapshot.fields.find((field) => ['button', 'a'].includes(field.elementType) && field.category === 'navigation' && field.label === label && allowed.test(field.label));
    if (!candidate) return { status: 'blocked', reason: 'safe_control_not_found', pageFingerprint: snapshot.pageFingerprint };
    const result = await executeOnDocument(`function (field) { const clean = (v) => String(v || '').replace(/\\s+/g, ' ').trim(); const buttons = Array.from(document.querySelectorAll('button,input[type="button"],a[role="button"],a[href]')).filter((el) => !el.disabled && !el.readOnly && el.offsetParent !== null); const matches = buttons.filter((el) => clean(el.innerText || el.value || el.getAttribute('aria-label')) === field.label); if (matches.length !== 1) return { status: 'blocked', reason: 'safe_control_changed' }; const el = matches[0]; el.focus(); el['click'](); return { status: 'activated', label: field.label }; }`, candidate);
    if (result?.status !== 'activated') return result || { status: 'blocked', reason: 'safe_control_failed' };
    await new Promise((resolve) => setTimeout(resolve, 250)); const nextSnapshot = await inspect();
    return { status: 'activated', action, targetLabel: label, previousPageFingerprint: snapshot.pageFingerprint, pageFingerprint: nextSnapshot.pageFingerprint };
  };
  const submit = async () => {
    const snapshot = await inspect();
    const candidates = snapshot.fields.filter((field) => field.elementType === 'button' && field.category === 'final_submit' && /^(submit|submit application|send application|finish application|complete application)$/i.test(field.label));
    if (candidates.length !== 1) return { status: 'blocked', reason: candidates.length ? 'final_submit_ambiguous' : 'final_submit_not_found', pageFingerprint: snapshot.pageFingerprint };
    const result = await executeOnDocument(`function (field) { const clean = (v) => String(v || '').replace(/\\s+/g, ' ').trim(); const controls = Array.from(document.querySelectorAll('button,input[type="submit"],input[type="button"]')).filter((el) => !el.disabled && !el.readOnly); const matches = controls.filter((el) => clean(el.innerText || el.value || el.getAttribute('aria-label')) === field.label && /^(submit|submit application|send application|finish application|complete application)$/i.test(clean(el.innerText || el.value || el.getAttribute('aria-label')))); if (matches.length !== 1) return { status: 'blocked', reason: matches.length ? 'final_submit_changed' : 'final_submit_missing' }; const el = matches[0]; el.focus(); el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); return { status: 'activated', label: field.label }; }`, candidates[0]);
    if (result?.status !== 'activated') return result || { status: 'blocked', reason: 'final_submit_failed' };
    await new Promise((resolve) => setTimeout(resolve, 300));
    const nextSnapshot = await inspect();
    return { status: 'submitted', previousPageFingerprint: snapshot.pageFingerprint, pageFingerprint: nextSnapshot.pageFingerprint };
  };
  const fillSavedCredentials = async ({ username = '', password = '' } = {}) => {
    const snapshot = await inspect();
    if ((snapshot.fields || []).some((field) => /captcha|recaptcha|hcaptcha|challenge/i.test(`${field.label || ''} ${field.name || ''}`))) return { status: 'blocked', reason: 'captcha_detected', pageFingerprint: snapshot.pageFingerprint };
    if (!username || !password || !(snapshot.fields || []).some((field) => field.inputType === 'password')) return { status: 'not_needed', pageFingerprint: snapshot.pageFingerprint };
    // Credentials are passed from Electron main directly into this isolated
    // DOM call. They are never included in browser snapshots or AI prompts.
    const result = await executeOnDocument(`function (credentials) { const clean = (v) => String(v || '').replace(/\\s+/g, ' ').trim().toLowerCase(); const visible = (el) => !el.disabled && !el.readOnly && el.offsetParent !== null; const inputs = Array.from(document.querySelectorAll('input')).filter(visible); const passwords = inputs.filter((el) => String(el.type || '').toLowerCase() === 'password'); const usernames = inputs.filter((el) => ['text', 'email'].includes(String(el.type || '').toLowerCase()) && /email|user|login|account/i.test(clean([el.id, el.name, el.getAttribute('aria-label'), el.getAttribute('autocomplete'), el.placeholder].join(' ')))); if (passwords.length !== 1 || usernames.length !== 1) return { status: 'blocked', reason: passwords.length !== 1 ? 'password_control_ambiguous' : 'username_control_ambiguous' }; const set = (el, value) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; if (!setter) throw new Error('value_setter_unavailable'); setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }; set(usernames[0], credentials.username); set(passwords[0], credentials.password); const controls = Array.from(document.querySelectorAll('button,input[type="submit"],input[type="button"]')).filter(visible); const submits = controls.filter((el) => /^(sign in|log in|login|continue)$/i.test(String(el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim())); if (submits.length !== 1) return { status: 'filled', submit: 'manual' }; submits[0].focus(); submits[0]['click'](); return { status: 'submitted' }; }`, { username, password });
    if (result?.status === 'submitted') await new Promise((resolve) => setTimeout(resolve, 250));
    const nextSnapshot = await inspect();
    return { ...(result || { status: 'blocked', reason: 'credential_fill_failed' }), pageFingerprint: nextSnapshot.pageFingerprint };
  };
  const activate = async ({ url = '', code = '' } = {}) => {
    if (!active) throw new Error('Open the employer application before activating the account.');
    if (url) {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || !active.approvedHosts.has(parsed.host)) throw new Error('The activation link is not an approved HTTPS employer host.');
      await view.webContents.loadURL(url);
      return { status: 'activated', method: 'link' };
    }
    if (!code) return { status: 'blocked', reason: 'activation_payload_missing' };
    const result = await executeOnDocument(`function (activationCode) { const clean = (v) => String(v || '').replace(/\\s+/g, ' ').trim(); const controls = Array.from(document.querySelectorAll('input')).filter((el) => !el.disabled && !el.readOnly && el.type !== 'hidden'); const matches = controls.filter((el) => /activation|verification|verify|confirmation|one.?time|otp|pin|code/i.test(clean((el.id || '') + ' ' + (el.name || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('placeholder') || '') + ' ' + (el.closest('label')?.innerText || '')))); if (matches.length !== 1) return { status: 'blocked', reason: matches.length ? 'activation_control_ambiguous' : 'activation_control_not_found' }; const el = matches[0]; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; if (!setter) return { status: 'blocked', reason: 'activation_value_setter_unavailable' }; setter.call(el, activationCode); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); const buttons = Array.from(document.querySelectorAll('button,input[type="button"],a[role="button"]')).filter((item) => !item.disabled); const activationButtons = buttons.filter((item) => /activate|verify|confirm|continue/i.test(clean(item.innerText || item.value || item.getAttribute('aria-label')))); if (activationButtons.length === 1) { activationButtons[0].focus(); activationButtons[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); } return { status: 'activated', method: 'code', buttonActivated: activationButtons.length === 1 }; }`, code);
    if (result?.status !== 'activated') return result || { status: 'blocked', reason: 'activation_failed' };
    await new Promise((resolve) => setTimeout(resolve, 150));
    const snapshot = await inspect();
    return { status: 'activated', method: 'code', pageFingerprint: snapshot.pageFingerprint };
  };
  const detectConfirmationPage = async () => {
    const snapshot = await inspect();
    // Confirmation detection receives only bounded title, URL, and control
    // labels; page text and field values never leave the isolated view.
    return detectConfirmation({ url: active.currentUrl, title: snapshot.pageTitle, text: snapshot.fields.map((field) => field.label).join(' ') });
  };
  const captureScreenshot = async ({ quality = 55, maxWidth = 1440 } = {}) => {
    if (!view || view.webContents.isDestroyed()) return null;
    const image = await view.webContents.capturePage();
    if (image.isEmpty()) return null;
    const size = image.getSize();
    const boundedWidth = Math.max(320, Math.min(Number(maxWidth) || 1440, size.width || 1440));
    const rendered = size.width > boundedWidth
      ? image.resize({ width: boundedWidth })
      : image;
    return `data:image/jpeg;base64,${rendered.toJPEG(Math.max(35, Math.min(75, Number(quality) || 55))).toString('base64')}`;
  };
  const setBounds = (bounds) => { if (!view) return; const x = Math.max(0, Math.round(bounds?.x || 0)); const y = Math.max(0, Math.round(bounds?.y || 0)); const width = Math.max(1, Math.round(bounds?.width || 1)); const height = Math.max(1, Math.round(bounds?.height || 1)); view.setBounds({ x, y, width, height }); };
  const close = () => { if (view) { detachView(view); try { view.webContents.close(); } catch {} view = null; } active = null; };
  const publicState = () => active ? { applicationId: active.applicationId, status: active.status, initialHost: active.initialHost, currentHost: active.currentUrl ? (() => { try { return new URL(active.currentUrl).host; } catch { return ''; } })() : '', redirectedToExternalHost: Boolean(active.currentUrl && active.initialHost && (() => { try { return new URL(active.currentUrl).host !== active.initialHost; } catch { return false; } })()), currentUrl: active.currentUrl, pendingHost: active.pendingHost || '', snapshot: active.snapshot, lastObservedAt: active.lastObservedAt || null } : null;
  return { open, close, hide, setBounds, inspect, captureScreenshot, inspectUploadControls, approveHost, createFillPlan, fillPlan, uploadDocuments, advance, clickSafeControl, submit, fillSavedCredentials, activate, detectConfirmationPage, publicState, goBack: () => view?.webContents.canGoBack() && view.webContents.goBack(), goForward: () => view?.webContents.canGoForward() && view.webContents.goForward(), reload: () => view?.webContents.reload(), clearSession: async () => session.fromPartition('persist:job-application-copilot').clearStorageData() };
}
module.exports = { redactUrl, isHttps, isDismissLabel, decideNavigation, buildContextMenuTemplate, handleMouseNavigationInput, createApplicationBrowser };
