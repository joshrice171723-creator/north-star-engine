const DICE_MCP_URL = 'https://mcp.dice.com/mcp';
const timeoutFetch = async (url, options = {}, timeoutMs = 15000) => { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); try { return await fetch(url, { ...options, signal: controller.signal }); } finally { clearTimeout(timer); } };
const text = (value, max = 50000) => String(value ?? '').trim().slice(0, max);
const list = (value) => Array.isArray(value) ? value : [];
const EMPLOYMENT_TYPE_VALUES = new Map([
  ['FULLTIME', 'FULLTIME'], ['FULL-TIME', 'FULLTIME'], ['FULL TIME', 'FULLTIME'], ['FULL-TIME', 'FULLTIME'],
  ['CONTRACTS', 'CONTRACTS'], ['CONTRACT', 'CONTRACTS'],
  ['PARTTIME', 'PARTTIME'], ['PART-TIME', 'PARTTIME'], ['PART TIME', 'PARTTIME'],
  ['THIRD_PARTY', 'THIRD_PARTY'], ['THIRD-PARTY', 'THIRD_PARTY'], ['THIRD PARTY', 'THIRD_PARTY'],
  ['INTERNSHIP', 'INTERNSHIP'], ['INTERNSHIPS', 'INTERNSHIP']
]);

function normalizeEmploymentTypes(values) {
  return list(values).map((value) => EMPLOYMENT_TYPE_VALUES.get(String(value).trim().toUpperCase()) || String(value).trim()).filter(Boolean);
}

function diceParams(lane = {}, scope = {}, page = 1, brief = {}) {
  const keyword = text(lane.keyword || lane.search || brief.jobFamilies?.[0] || brief.targetIntent || 'technology', 120);
  const params = { keyword, jobs_per_page: Math.max(1, Math.min(100, Number(lane.jobsPerPage || lane.jobs_per_page) || 50)), page_number: Math.max(1, Number(page) || 1) };
  // A selected profile location wins over planner wording so Dice uses the canonical pair.
  const location = text(scope.locationName || lane.location, 160); if (location) params.location = location;
  // Dice's public documentation lists "miles", but the live MCP schema
  // validates the abbreviated enum value "mi" (or "km") only.
  const radius = Number(lane.radius || brief.radiusMiles); if (Number.isFinite(radius) && radius >= 1) { params.radius = Math.min(100, radius); params.radius_unit = 'mi'; }
  const remote = String(lane.workplaceType || brief.remotePreference || '').toLowerCase(); if (remote === 'remote') params.workplace_types = ['Remote']; else if (remote === 'hybrid') params.workplace_types = ['Hybrid'];
  if (Array.isArray(lane.employmentTypes) && lane.employmentTypes.length) params.employment_types = normalizeEmploymentTypes(lane.employmentTypes);
  if (['ONE', 'THREE', 'SEVEN'].includes(lane.postedDate)) params.posted_date = lane.postedDate;
  if (typeof lane.willingToSponsor === 'boolean') params.willing_to_sponsor = lane.willingToSponsor;
  if (typeof lane.easyApply === 'boolean') params.easy_apply = lane.easyApply;
  return params;
}

function normalize(item, evidence = {}) {
  const location = text(item?.jobLocation?.displayName || item?.location || 'Remote', 240);
  const description = text(item?.summary || item?.description || '', 50000);
  return { providerKey: 'dice', externalId: text(item?.id || item?.detailsPageUrl || item?.applicationUrl, 300), canonicalUrl: text(item?.detailsPageUrl, 1000), applicationUrl: text(item?.detailsPageUrl, 1000), title: text(item?.title, 300), company: text(item?.companyName || 'Unknown employer', 240), location, locations: location ? [location] : [], description, duties: description, qualifications: '', requirements: [], benefits: '', salaryMin: null, salaryMax: null, salaryCurrency: 'USD', salaryInterval: 'unknown', salary: text(item?.salary, 160), employmentType: text(item?.employmentType || 'Not specified', 80), remoteType: item?.isRemote || list(item?.workplaceTypes).includes('Remote') ? 'remote' : list(item?.workplaceTypes).includes('Hybrid') ? 'hybrid' : 'onsite', postedAt: item?.postedDate || null, expiresAt: null, category: '', searchEvidence: { provider: 'dice', laneId: evidence.laneId || '', type: evidence.type || '', query: evidence.keyword || '', locationScope: evidence.locationScope || '' } };
}

async function readMcpJson(response) {
  // Dice's Streamable HTTP endpoint currently returns JSON-RPC messages as
  // SSE frames, even when the request also accepts application/json.
  const isEventStream = /text\/event-stream/i.test(response.headers?.get?.('content-type') || '');
  const raw = isEventStream ? await response.text() : null;
  const payloads = isEventStream
    ? raw.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).filter(Boolean)
    : [];
  // Streamable HTTP may emit more than one SSE frame; the JSON-RPC response is
  // the frame matching the request, while keep-alive/notification frames are not.
  const body = payloads.length ? JSON.parse(payloads[payloads.length - 1]) : await response.json();
  if (body?.result) return body.result;
  return body;
}

async function searchDice({ lane = {}, scope = {}, page = 1, brief = {} }) {
  const params = diceParams(lane, scope, page, brief); const started = Date.now(); const diagnostics = { provider: 'dice', httpStatus: null, query: params.keyword, location: params.location || '', request: params, resultCount: 0, durationMs: 0 };
  const headers = { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' };
  try {
    // Dice documents a Streamable HTTP MCP endpoint. Initialize each bounded
    // search session before calling search_jobs so this works with servers
    // that require the negotiated MCP session header.
    const initialized = await timeoutFetch(DICE_MCP_URL, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'north-star-job-search', version: '1.0.0' } } }) });
    diagnostics.httpStatus = initialized.status;
    if (!initialized.ok) return { jobs: [], resultCount: 0, rawResultCount: 0, totalAvailable: 0, diagnostics: { ...diagnostics, durationMs: Date.now() - started }, error: { code: initialized.status === 429 ? 'rate_limited' : 'provider_error', message: `Dice MCP returned HTTP ${initialized.status}.`, retryable: initialized.status !== 401 && initialized.status !== 403 } };
    await readMcpJson(initialized);
    const sessionId = initialized.headers?.get?.('mcp-session-id'); if (sessionId) headers['mcp-session-id'] = sessionId;
    // MCP requires this notification before the server will accept tool calls.
    await timeoutFetch(DICE_MCP_URL, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) });
    const response = await timeoutFetch(DICE_MCP_URL, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search_jobs', arguments: params } }) });
    diagnostics.httpStatus = response.status;
    if (!response.ok) return { jobs: [], resultCount: 0, rawResultCount: 0, totalAvailable: 0, diagnostics: { ...diagnostics, durationMs: Date.now() - started }, error: { code: response.status === 429 ? 'rate_limited' : 'provider_error', message: `Dice MCP returned HTTP ${response.status}.`, retryable: response.status !== 401 && response.status !== 403 } };
    const result = await readMcpJson(response); const content = list(result?.content); const payload = content.find((entry) => entry?.type === 'text')?.text || result?.structuredContent || result;
    if (result?.isError) return { jobs: [], resultCount: 0, rawResultCount: 0, totalAvailable: 0, diagnostics: { ...diagnostics, durationMs: Date.now() - started }, error: { code: 'provider_error', message: text(content.find((entry) => entry?.type === 'text')?.text || 'Dice MCP could not complete the job search.', 500), retryable: true } };
    let data = payload; if (typeof payload === 'string') { try { data = JSON.parse(payload); } catch { return { jobs: [], resultCount: 0, rawResultCount: 0, totalAvailable: 0, diagnostics: { ...diagnostics, durationMs: Date.now() - started }, error: { code: 'provider_error', message: text(payload, 500), retryable: true } }; } }
    if (data?.isError) return { jobs: [], resultCount: 0, rawResultCount: 0, totalAvailable: 0, diagnostics: { ...diagnostics, durationMs: Date.now() - started }, error: { code: 'provider_error', message: text(data?.message || 'Dice MCP could not complete the job search.', 500), retryable: true } };
    const items = list(data?.data || data?.jobs); const jobs = items.map((item) => normalize(item, { ...lane, keyword: params.keyword, locationScope: scope.locationName })); const total = Number(data?.meta?.totalResults ?? data?.metadata?.total);
    return { jobs, resultCount: jobs.length, rawResultCount: jobs.length, rawExternalIds: jobs.map((job) => job.externalId).filter(Boolean), totalAvailable: Number.isFinite(total) ? total : jobs.length, diagnostics: { ...diagnostics, resultCount: jobs.length, durationMs: Date.now() - started }, error: null };
  } catch (cause) { return { jobs: [], resultCount: 0, rawResultCount: 0, totalAvailable: 0, diagnostics: { ...diagnostics, durationMs: Date.now() - started }, error: { code: cause?.name === 'AbortError' ? 'timeout' : 'network', message: cause instanceof SyntaxError ? 'Dice MCP returned an invalid response.' : 'Could not reach Dice MCP.', retryable: true } }; }
}

module.exports = { DICE_MCP_URL, diceParams, searchDice };
