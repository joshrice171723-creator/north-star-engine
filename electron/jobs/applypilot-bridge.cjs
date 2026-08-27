const crypto = require('node:crypto');
const http = require('node:http');

const DEFAULT_PORT = 38741;
const LOOPBACK = '127.0.0.1';
const SESSION_TTL_MS = 10 * 60 * 1000;
const MAX_BODY_BYTES = 32 * 1024;

function cleanHost(value) {
  try {
    const parsed = new URL(String(value || '').includes('://') ? String(value) : `https://${value}`);
    return parsed.hostname.toLowerCase();
  } catch { return ''; }
}

function writeJson(response, status, body, origin = 'null') {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-north-star-session',
  });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; if (raw.length > MAX_BODY_BYTES) reject(new Error('Request is too large.')); });
    request.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { reject(new Error('Invalid JSON.')); } });
    request.on('error', reject);
  });
}

function redactObservation(body, session) {
  const fields = Array.isArray(body.fields) ? body.fields.slice(0, 200).map((field) => ({
    fingerprint: String(field?.fingerprint || '').slice(0, 160), label: String(field?.label || '').slice(0, 160),
    type: String(field?.type || '').slice(0, 40), required: Boolean(field?.required),
    optionCount: Array.isArray(field?.options) ? Math.min(field.options.length, 100) : 0,
  })) : [];
  return { requestId: String(body.requestId || '').slice(0, 120), applicationId: session.applicationId,
    employerHost: session.employerHost, pageFingerprint: String(body.pageFingerprint || '').slice(0, 160),
    pageTitle: String(body.pageTitle || '').slice(0, 200), fieldCount: fields.length, fields, observedAt: new Date().toISOString() };
}

function redactResult(body, session) {
  const statuses = new Set(['observed', 'filled', 'advanced', 'paused', 'blocked', 'submitted', 'failed']);
  return { requestId: String(body.requestId || '').slice(0, 120), applicationId: session.applicationId,
    employerHost: session.employerHost, status: statuses.has(body.status) ? body.status : 'failed',
    filledCount: Number.isInteger(body.filledCount) ? Math.max(0, Math.min(body.filledCount, 200)) : 0,
    unmappedCount: Number.isInteger(body.unmappedCount) ? Math.max(0, Math.min(body.unmappedCount, 200)) : 0,
    pageFingerprint: String(body.pageFingerprint || '').slice(0, 160), reasonCode: String(body.reasonCode || '').slice(0, 120),
    reportedAt: new Date().toISOString() };
}

function createApplyPilotBridge({ port = DEFAULT_PORT, version = '0.1.0' } = {}) {
  let server = null;
  let lastError = '';
  let signal = { state: 'green', source: 'north-star', updatedAt: new Date().toISOString() };
  const issuedTokens = new Map();
  const sessions = new Map();
  const status = () => ({ running: Boolean(server?.listening), host: LOOPBACK, port, protocolVersion: 2, lastError, signal });
  const issueSession = ({ applicationId, employerHost, accountRef = '' } = {}) => {
    const host = cleanHost(employerHost);
    if (!/^[A-Za-z0-9._:-]{1,120}$/.test(String(applicationId || '')) || !host) throw new Error('Application and employer host are required.');
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + SESSION_TTL_MS;
    issuedTokens.set(crypto.createHash('sha256').update(token).digest('hex'), { applicationId, employerHost: host, accountRef: String(accountRef || '').slice(0, 120), expiresAt });
    return { token, applicationId, employerHost: host, expiresAt: new Date(expiresAt).toISOString(), protocolVersion: 2 };
  };
  const claimSession = ({ token, employerHost } = {}) => {
    const hash = crypto.createHash('sha256').update(String(token || '')).digest('hex');
    const pending = issuedTokens.get(hash); issuedTokens.delete(hash);
    if (!pending || pending.expiresAt <= Date.now() || cleanHost(employerHost) !== pending.employerHost) throw new Error('Session pairing is invalid or expired.');
    const sessionToken = crypto.randomBytes(32).toString('base64url');
    sessions.set(crypto.createHash('sha256').update(sessionToken).digest('hex'), { ...pending, requests: new Map() });
    return { sessionToken, applicationId: pending.applicationId, employerHost: pending.employerHost, expiresAt: new Date(pending.expiresAt).toISOString(), protocolVersion: 2 };
  };
  const authorize = (request, body) => {
    const hash = crypto.createHash('sha256').update(String(request.headers['x-north-star-session'] || '')).digest('hex');
    const session = sessions.get(hash);
    if (!session || session.expiresAt <= Date.now() || body.applicationId !== session.applicationId || cleanHost(body.employerHost) !== session.employerHost) throw new Error('Authenticated application session is invalid.');
    return session;
  };
  const idempotent = (session, requestId, build) => {
    if (!/^[A-Za-z0-9._:-]{8,120}$/.test(String(requestId || ''))) throw new Error('A requestId is required for idempotency.');
    if (session.requests.has(requestId)) return session.requests.get(requestId);
    const result = build(); session.requests.set(requestId, result); return result;
  };
  const start = () => new Promise((resolve) => {
    if (server?.listening) return resolve(status());
    server = http.createServer(async (request, response) => {
      const requestOrigin = String(request.headers.origin || '');
      const origin = requestOrigin.startsWith('chrome-extension://') ? requestOrigin : 'null';
      if (request.method === 'OPTIONS') return writeJson(response, 204, {}, origin);
      try {
        if (request.method === 'GET' && request.url === '/v1/health') return writeJson(response, 200, { ok: true, service: 'north-star', bridge: 'applypilot', protocolVersion: 2, version, capabilities: ['connection-check', 'session-pairing', 'observation', 'result'], timestamp: new Date().toISOString(), signal }, origin);
        if (request.method !== 'POST') return writeJson(response, 404, { ok: false, error: 'Not found.' }, origin);
        const body = await readJson(request);
        if (request.url === '/v1/session/claim') return writeJson(response, 200, { ok: true, session: claimSession(body) }, origin);
        if (request.url === '/v1/signal') { if (!['green', 'red'].includes(body.state)) throw new Error('Signal must be green or red.'); signal = { state: body.state, source: body.source === 'applypilot' ? 'applypilot' : 'north-star', updatedAt: new Date().toISOString() }; return writeJson(response, 200, { ok: true, signal }, origin); }
        if (request.url === '/v1/application/observation' || request.url === '/v1/application/result') { const session = authorize(request, body); const observation = request.url.endsWith('/observation'); const payload = observation ? redactObservation(body, session) : redactResult(body, session); const result = idempotent(session, payload.requestId, () => payload); return writeJson(response, 200, { ok: true, [observation ? 'observation' : 'result']: result }, origin); }
        return writeJson(response, 404, { ok: false, error: 'Not found.' }, origin);
      } catch (error) { return writeJson(response, 400, { ok: false, error: String(error?.message || 'Request rejected.').slice(0, 200) }, origin); }
    });
    server.once('error', (error) => { lastError = error.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : 'Connection bridge could not start.'; server = null; resolve(status()); });
    server.listen(port, LOOPBACK, () => { lastError = ''; resolve(status()); });
  });
  const stop = () => new Promise((resolve) => { if (!server) return resolve(status()); const current = server; server = null; current.close(() => resolve(status())); });
  const setSignal = (state, source = 'north-star') => { if (!['green', 'red'].includes(state)) throw new Error('Signal must be green or red.'); signal = { state, source: source === 'applypilot' ? 'applypilot' : 'north-star', updatedAt: new Date().toISOString() }; return status(); };
  return { start, stop, status, setSignal, issueSession, claimSession, port };
}

module.exports = { DEFAULT_PORT, createApplyPilotBridge };
