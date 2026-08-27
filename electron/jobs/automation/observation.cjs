'use strict';

// Keep browser observations bounded and provider-neutral. The orchestrator
// receives page shape and status signals, never page text, cookies, or values.
function observePage({ browserState = null, expectedStep = '', site = '', atsKey = '' } = {}) {
  const snapshot = browserState?.snapshot || {};
  return {
    site: String(site || browserState?.currentHost || '').slice(0, 253),
    atsKey: String(atsKey || '').slice(0, 80),
    expectedStep: String(expectedStep || '').slice(0, 80),
    currentUrl: String(browserState?.currentUrl || '').slice(0, 2000),
    pageTitle: String(snapshot.pageTitle || '').slice(0, 300),
    pageFingerprint: String(snapshot.pageFingerprint || '').slice(0, 240),
    pageSignals: Array.isArray(snapshot.pageSignals) ? snapshot.pageSignals.slice(0, 12) : [],
    fields: Array.isArray(snapshot.fields) ? snapshot.fields.slice(0, 120) : [],
    lastObservedAt: browserState?.lastObservedAt || null,
  };
}

module.exports = { observePage };
