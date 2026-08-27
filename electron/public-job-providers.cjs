const timeoutFetch = async (url, options = {}, timeoutMs = 15000) => { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); try { return await fetch(url, { ...options, signal: controller.signal }); } finally { clearTimeout(timer); } };
const text = (value, max = 50000) => String(value ?? '').trim().slice(0, max);
const list = (value) => Array.isArray(value) ? value : [];

function laneQuery(lane = {}, brief = {}) { return text(lane.search || (Array.isArray(lane.searchTerms) ? lane.searchTerms.join(' ') : '') || lane.what || lane.keyword || lane.positionTitle || brief.targetIntent || brief.jobFamilies?.[0] || 'technology', 120); }
function matches(query, job) {
  const ignored = new Set(['and', 'for', 'find', 'full', 'time', 'roles', 'role', 'with', 'near', 'associated', 'stated', 'where', 'show', 'jobs', 'job']);
  const terms = String(query || '').toLowerCase().match(/[a-z0-9]+/g)?.filter((term) => term.length > 2 && !ignored.has(term)) || [];
  const title = String(job.title || '').toLowerCase();
  const haystack = `${job.title || ''} ${job.description || ''} ${job.category || ''}`.toLowerCase();
  if (!terms.length) return true;
  const required = terms.length >= 3 ? 2 : terms.length;
  // Public feeds can match unrelated prose in a long description (for
  // example, a marketing role mentioning an engineering team). A role search
  // must have its core terms in the title before description keywords count.
  return terms.filter((term) => title.includes(term)).length >= required
    && terms.filter((term) => haystack.includes(term)).length >= required;
}
function matchesRequestedLocation(item, scope = {}, brief = {}) {
  const requested = text(scope.locationName || '', 160).toLowerCase();
  if (!requested) return true;
  const location = text(item.location || item.candidate_required_location || item.locations || item.city || '', 240).toLowerCase();
  const remote = /\bremote\b|\banywhere\b/.test(location);
  // Remote is a standing option in every location search. The final AI
  // evaluator weighs it against local roles, so a city-targeted search must
  // not discard remote listings before that comparison happens.
  if (remote) return true;
  const words = requested.match(/[a-z0-9]+/g) || [];
  const city = words.find((word) => word.length > 2);
  const state = words.find((word) => word.length === 2);
  return Boolean((city && location.includes(city)) || (state && new RegExp(`\\b${state}\\b`).test(location)) || location.includes(requested));
}
function normalize(item, provider, evidence = {}) {
  const location = text(item.location || item.candidate_required_location || item.locations || item.city || 'Remote', 240);
  const description = text(item.description || item.snippet || item.job_description || '', 50000);
  return { providerKey: provider, externalId: String(item.id || item.slug || item.url || item.job_url || ''), canonicalUrl: item.url || item.url_apply || item.job_url || '', applicationUrl: item.url || item.url_apply || item.job_url || '', title: text(item.title || item.position || item.role, 300), company: text(item.company_name || item.company || item.organization || 'Unknown employer', 240), location, locations: location ? [location] : [], description, duties: description, qualifications: '', requirements: [], benefits: '', salaryMin: Number.isFinite(Number(item.salary_min)) ? Number(item.salary_min) : null, salaryMax: Number.isFinite(Number(item.salary_max)) ? Number(item.salary_max) : null, salaryCurrency: 'USD', salaryInterval: 'unknown', employmentType: text(item.job_type || item.job_types?.[0] || item.type || 'Not specified', 80), remoteType: provider === 'remotive' || /remote|anywhere/i.test(location) ? 'remote' : 'unknown', postedAt: item.publication_date || item.created_at || item.date || null, expiresAt: null, category: text(item.category || item.job_category || '', 160), searchEvidence: { provider, laneId: evidence.laneId || '', type: evidence.type || '', query: evidence.query || '', locationScope: evidence.locationScope || '' } };
}

async function searchRemotive({ lane = {}, scope = {}, brief = {} }) {
  const query = lane.search || laneQuery(lane, brief); const params = new URLSearchParams(); if (query) params.set('search', query); if (lane.category) params.set('category', text(lane.category, 100)); if (lane.company_name) params.set('company_name', text(lane.company_name, 160)); params.set('limit', '100'); const started = Date.now(); const diagnostics = { provider: 'remotive', httpStatus: null, query, location: scope.locationName || '', request: Object.fromEntries(params), resultCount: 0, durationMs: 0 };
  try { const response = await timeoutFetch(`https://remotive.com/api/remote-jobs?${params}`); diagnostics.httpStatus = response.status; const body = await response.json(); if (!response.ok) return { jobs: [], resultCount: 0, rawResultCount: 0, totalAvailable: 0, diagnostics: { ...diagnostics, durationMs: Date.now() - started }, error: { code: 'provider_error', message: `Remotive returned HTTP ${response.status}.`, retryable: true } }; const feed = list(body?.jobs); const rawExternalIds = feed.map((item) => String(item.id || item.url || '')).filter(Boolean); const items = feed.filter((item) => matches(query, { title: item.title, description: item.description, category: item.category || item.job_category })); const jobs = items.map((item) => normalize(item, 'remotive', { ...lane, query, locationScope: scope.locationName })); const responseFingerprint = rawExternalIds.slice(0, 20).join('|'); return { jobs, resultCount: jobs.length, rawResultCount: feed.length, rawExternalIds, responseFingerprint, totalAvailable: Number(body?.['job-count']) || feed.length, diagnostics: { ...diagnostics, resultCount: jobs.length, feedCount: feed.length, durationMs: Date.now() - started }, error: null }; } catch (cause) { return { jobs: [], resultCount: 0, rawResultCount: 0, totalAvailable: 0, diagnostics: { ...diagnostics, durationMs: Date.now() - started }, error: { code: cause?.name === 'AbortError' ? 'timeout' : 'network', message: 'Could not reach Remotive.', retryable: true } }; }
}

module.exports = { matches, matchesRequestedLocation, searchRemotive };
