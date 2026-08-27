const crypto = require('crypto');

let activeRunId = null;
let currentPurpose = 'unscoped';
let persist = null;
let installed = false;
const originalFetch = globalThis.fetch;

const setAuditPersistence = (fn) => { persist = typeof fn === 'function' ? fn : null; };
const setAuditRun = (runId) => { activeRunId = runId || null; };
const clearAuditRun = () => { activeRunId = null; currentPurpose = 'unscoped'; };
const setAuditPurpose = (purpose) => { currentPurpose = purpose || 'job-search'; };

function safeHeaders(headers) {
  const result = {};
  try {
    for (const [key, value] of new Headers(headers || {}).entries()) {
      result[key] = /authorization|api[-_]?key|cookie|token|secret/i.test(key) ? '[REDACTED]' : value;
    }
  } catch {}
  return result;
}

function safeUrl(value) {
  try {
    const url = new URL(String(value));
    for (const key of ['app_id', 'app_key', 'api_key', 'apikey', 'key', 'token']) {
      if (url.searchParams.has(key)) url.searchParams.set(key, '[REDACTED]');
    }
    return url.toString();
  } catch { return String(value || ''); }
}

function bodyText(body) {
  if (body === undefined || body === null) return '';
  if (typeof body === 'string') return body;
  try { return JSON.stringify(body); } catch { return String(body); }
}

function installApiAuditFetch() {
  if (installed || typeof originalFetch !== 'function') return;
  installed = true;
  globalThis.fetch = async (input, init = {}) => {
    const started = Date.now();
    const request = input instanceof Request ? input : null;
    const url = safeUrl(request?.url || input);
    const method = String(init.method || request?.method || 'GET').toUpperCase();
    const requestHeaders = safeHeaders(init.headers || request?.headers);
    const requestBody = bodyText(init.body);
    const record = (extra) => persist?.({
      id: `api-${crypto.randomUUID()}`,
      runId: activeRunId,
      purpose: currentPurpose,
      method,
      url,
      requestHeaders,
      requestBody,
      durationMs: Date.now() - started,
      ...extra,
    });
    try {
      const response = await originalFetch(input, init);
      let responseBody = '';
      try { responseBody = await response.clone().text(); } catch (error) { responseBody = `[response body unavailable: ${error.message}]`; }
      record({ responseStatus: response.status, responseHeaders: safeHeaders(response.headers), responseBody, responseOk: response.ok ? 1 : 0, timedOut: 0, errorName: '', errorMessage: '' });
      return response;
    } catch (error) {
      record({ responseStatus: null, responseHeaders: {}, responseBody: '', responseOk: 0, timedOut: error?.name === 'AbortError' ? 1 : 0, errorName: error?.name || 'Error', errorMessage: error?.message || String(error) });
      throw error;
    }
  };
}

// Audio payloads contain a user's voice and must not be copied into the job-search
// API audit log. Callers can use this only for intentionally non-audited requests.
const getUninstrumentedFetch = () => originalFetch;

module.exports = { installApiAuditFetch, setAuditPersistence, setAuditRun, clearAuditRun, setAuditPurpose, getUninstrumentedFetch };
