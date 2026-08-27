const ADZUNA_URL = 'https://api.adzuna.com/v1/api/jobs/us/search';
const MAX_RESULTS = 50;

const timeoutFetch = async (url, options = {}, timeoutMs = 15000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
};
const text = (value, max = 50000) => String(value ?? '').trim().slice(0, max);
const valueText = (value) => Array.isArray(value) ? value.map(valueText).filter(Boolean).join('; ') : (value && typeof value === 'object' ? Object.values(value).map(valueText).filter(Boolean).join('; ') : text(value));

function buildAdzunaParams(lane = {}, scope = {}, page = 1, brief = {}) {
  const params = new URLSearchParams({
    results_per_page: String(MAX_RESULTS),
    'content-type': 'application/json',
  });
  const query = lane.what || lane.positionTitle || lane.keyword || brief.targetIntent || brief.jobFamilies?.[0] || 'technology';
  params.set('what', text(query, 120));
  // A selected profile location wins over planner wording so Adzuna stays anchored to it.
  const location = scope.locationName || lane.where;
  if (location && !/^[A-Za-z]{2}$/.test(String(location).trim())) params.set('where', text(location, 160));
  const salary = Number.isInteger(lane.salaryMin) ? lane.salaryMin : brief.minimumSalary;
  if (Number.isInteger(salary) && salary > 0) params.set('salary_min', String(salary));
  return params;
}

function normalizeAdzunaItem(item, searchEvidence = {}) {
  const location = valueText(item?.location?.display_name || item?.location);
  const company = valueText(item?.company?.display_name || item?.company) || 'Unknown employer';
  const min = Number(item?.salary_min); const max = Number(item?.salary_max);
  const description = text(item?.description);
  return {
    providerKey: 'adzuna', externalId: String(item?.id || item?.redirect_url || ''),
    canonicalUrl: item?.redirect_url || '', applicationUrl: item?.redirect_url || '',
    title: text(item?.title, 300), company, location, locations: location ? [location] : [],
    description, duties: description, qualifications: '', requirements: [], benefits: '',
    salaryMin: Number.isFinite(min) ? min : null, salaryMax: Number.isFinite(max) ? max : null,
    salaryCurrency: 'USD', salaryInterval: 'unknown', employmentType: valueText(item?.contract_type) || 'Not specified',
    remoteType: /remote|work from home|telecommut/i.test(`${item?.title || ''} ${description} ${location}`) ? 'remote' : 'unknown',
    postedAt: item?.created || null, expiresAt: null, category: valueText(item?.category?.label || item?.category),
    searchEvidence: { provider: 'adzuna', laneId: searchEvidence.laneId || '', type: searchEvidence.type || '', positionTitleQuery: searchEvidence.positionTitle || '', keywordQuery: searchEvidence.keyword || '', locationScope: searchEvidence.locationScope || '' },
  };
}

async function searchAdzuna({ credentials = {}, lane = {}, scope = {}, page = 1, brief = {} }) {
  const appId = credentials.adzunaAppId || process.env.ADZUNA_APP_ID;
  const appKey = credentials.adzunaApiKey || process.env.ADZUNA_API_KEY;
  const query = lane.what || lane.positionTitle || lane.keyword || brief.targetIntent || '';
  const baseDiagnostics = { provider: 'adzuna', httpStatus: null, query, location: scope.locationName || '', resultCount: 0, durationMs: 0 };
  if (!appId || !appKey) return { jobs: [], resultCount: 0, totalAvailable: 0, diagnostics: baseDiagnostics, error: null };
  const params = buildAdzunaParams(lane, scope, page, brief); params.set('app_id', appId); params.set('app_key', appKey);
  const started = Date.now(); let response;
  try { response = await timeoutFetch(`${ADZUNA_URL}/${page}?${params}`, { headers: { Accept: 'application/json' } }); }
  catch (cause) { return { jobs: [], resultCount: 0, totalAvailable: 0, diagnostics: { ...baseDiagnostics, durationMs: Date.now() - started }, error: { code: cause?.name === 'AbortError' ? 'timeout' : 'network', message: cause?.name === 'AbortError' ? 'Adzuna request timed out. Try again.' : 'Could not reach Adzuna. Check your connection and try again.', retryable: true } }; }
  const diagnostics = { ...baseDiagnostics, httpStatus: response.status, durationMs: Date.now() - started };
  if (!response.ok) { let detail = ''; try { if (typeof response.text === 'function') { const raw = await response.text(); try { const body = JSON.parse(raw); detail = text(body?.error || body?.message || body?.detail || body?.error_description || (typeof body === 'string' ? body : ''), 180); } catch { detail = text(raw, 180); } } else if (typeof response.json === 'function') { const body = await response.json(); detail = text(body?.error || body?.message || body?.detail || body?.error_description || (typeof body === 'string' ? body : ''), 180); } } catch {} const credentialFailure = response.status === 400 && /(?:app[_ -]?(?:id|key)|api\s*key|credentials?|authentication|unauthorized|invalid\s+(?:app|application))/i.test(detail); const code = response.status === 401 || response.status === 403 || credentialFailure ? 'unauthorized' : response.status === 429 ? 'rate_limited' : 'provider_error'; const message = code === 'unauthorized' ? 'Adzuna credentials were rejected.' : code === 'rate_limited' ? 'Adzuna rate limit reached.' : `Adzuna returned HTTP ${response.status}${detail ? `: ${detail}` : '.'}`; return { jobs: [], resultCount: 0, totalAvailable: 0, diagnostics: { ...diagnostics, errorSummary: detail || null }, error: { code, message, retryable: code !== 'unauthorized' } }; }
  try { const body = await response.json(); const items = Array.isArray(body?.results) ? body.results : []; return { jobs: items.map((item) => normalizeAdzunaItem(item, { ...lane, locationScope: scope.locationName })).filter((job) => job.externalId && job.title), resultCount: items.length, totalAvailable: Number(body?.count) || items.length, diagnostics: { ...diagnostics, resultCount: items.length }, error: null }; }
  catch { return { jobs: [], resultCount: 0, totalAvailable: 0, diagnostics, error: { code: 'provider_error', message: 'Adzuna returned an unreadable response.', retryable: true } }; }
}

async function testAdzuna(credentials = {}) { const result = await searchAdzuna({ credentials, lane: { positionTitle: 'Software Engineer', laneId: 'connection-test' }, scope: {}, page: 1, brief: {} }); if (result.error) return { ok: false, ...result.error }; return { ok: true, status: result.diagnostics.httpStatus, count: result.resultCount }; }

module.exports = { buildAdzunaParams, normalizeAdzunaItem, searchAdzuna, testAdzuna };
