const USAJOBS_URL = 'https://data.usajobs.gov/api/search';
const ZIP_LOOKUP_URL = 'https://api.zippopotam.us/us/';
const MAX_REQUESTS = 24;
const MAX_RESULTS_PER_REQUEST = 50;
const TARGET_RETRIEVAL_COUNT = 100;
// Ranking has a bounded 80-candidate safety limit, but no product-level
// per-provider limit of 20; high-quality provider candidates remain eligible.
const TARGET_TOP_COUNT = 80;
const TARGET_QUALIFIED_COUNT = 20;
const MAX_PROVIDER_REQUESTS = 5;
const MIN_DETERMINISTIC_SCORE = 40;
const { searchAdzuna } = require('./adzuna-provider.cjs');
const { searchRemotive } = require('./public-job-providers.cjs');
const { searchDice, diceParams } = require('./dice-provider.cjs');
const { parseUsLocation, formatLocationScope } = require('./location-format.cjs');
const timeoutFetch = async (url, options = {}, timeoutMs = 15000) => { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); try { return await fetch(url, { ...options, signal: controller.signal }); } finally { clearTimeout(timer); } };
const text = (value, max = 50000) => String(value ?? '').trim().slice(0, max);
const list = (value, max = 30) => (Array.isArray(value) ? value : []).map((entry) => text(entry, 160)).filter(Boolean).slice(0, max);
const isZip = (value) => /^\d{5}(?:-\d{4})?$/.test(String(value || '').trim());

async function normalizeLocation(value) {
  const location = text(value, 160); if (!isZip(location)) return { value: location, error: null };
  const zip = location.slice(0, 5);
  try { const response = await timeoutFetch(`${ZIP_LOOKUP_URL}${zip}`, { headers: { Accept: 'application/json' } }, 8000); if (!response.ok) throw new Error('lookup failed'); const body = await response.json(); const place = body?.places?.[0]; if (!place?.['place name'] || !place?.['state abbreviation']) throw new Error('lookup failed'); const parsed = parseUsLocation(`${place['place name']}, ${place['state abbreviation']}`); return { value: parsed.compact, parsed, error: null }; }
  catch { return { value: '', error: { code: 'invalid_location', message: `Could not resolve ZIP code ${zip}. Enter a city and state, such as Dallas, TX.`, retryable: false } }; }
}

function locationScopes(brief = {}, profile = {}) {
  const location = brief.locations?.[0];
  const raw = location?.raw || location || profile.targetLocations?.[0] || '';
  const first = text(raw, 160); if (!first) return [{ locationName: '', label: 'nationwide' }];
  const scopes = [{ locationName: first, label: 'requested location' }];
  const state = brief.locations?.[0]?.state || first.match(/\b([A-Za-z]{2})\b\s*$/)?.[1]?.toUpperCase();
  if (state && state !== first) scopes.push({ locationName: state, label: 'state fallback' });
  const remote = brief.remotePreference || profile.remotePreference;
  if (remote === 'remote' || brief.locations?.length === 0) scopes.push({ locationName: '', label: 'nationwide' });
  return [...new Map(scopes.map((scope) => [scope.locationName, scope])).values()];
}

function filterParams(filters = {}, brief = {}) {
  const params = {};
  if (filters.remoteIndicator !== null && filters.remoteIndicator !== undefined) params.RemoteIndicator = String(Boolean(filters.remoteIndicator));
  if (Number.isFinite(Number(filters.radiusMiles)) && Number(filters.radiusMiles) > 0) params.Radius = String(Math.min(100, Number(filters.radiusMiles)));
  if (Number.isInteger(brief.minimumSalary) && brief.minimumSalary > 0) params.RemunerationMinimumAmount = String(brief.minimumSalary);
  if (brief.hiringPaths?.length) params.HiringPath = brief.hiringPaths.join(';');
  if (brief.scheduleTypes?.includes('full-time')) params.PositionScheduleTypeCode = '1';
  if (Number.isInteger(filters.datePosted) && filters.datePosted >= 0) params.DatePosted = String(Math.min(60, filters.datePosted));
  return params;
}

function buildUsaJobsParams(lane = {}, scope = {}, page = 1, brief = {}) {
  const params = new URLSearchParams({ ResultsPerPage: String(MAX_RESULTS_PER_REQUEST), Page: String(page), Fields: 'Full', SortField: 'opendate', SortDirection: 'Desc' });
  if (lane.type === 'keyword-support' && lane.keyword) params.set('Keyword', text(lane.keyword, 120));
  if (lane.positionTitle) params.set('PositionTitle', text(lane.positionTitle, 120));
  if (scope.locationName) params.set('LocationName', text(scope.locationName, 160));
  const merged = { ...(lane.filters || {}), ...(scope.radiusMiles ? { radiusMiles: scope.radiusMiles } : {}) };
  for (const [key, value] of Object.entries(filterParams(merged, brief))) params.set(key, value);
  return params;
}

function valueToText(value) { if (value === null || value === undefined) return ''; if (Array.isArray(value)) return value.map(valueToText).filter(Boolean).join(' '); if (typeof value === 'object') return value.Content || value.content || value.Label || value.label || value.Text || value.text || Object.values(value).map(valueToText).filter(Boolean).join(' '); return String(value); }
function extractText(d, keys) { return keys.map((key) => valueToText(d?.[key])).filter(Boolean).join('\n'); }
function extractCodes(values) { return (Array.isArray(values) ? values : []).map((entry) => entry?.Code || entry?.Value || entry?.Name || entry).filter(Boolean).map(String); }
function normalizeUsaJobsItem(item, searchEvidence = {}) {
  const d = item?.MatchedObjectDescriptor || {}; const pay = d.PositionRemuneration?.[0] || {}; const locations = Array.isArray(d.PositionLocation) ? d.PositionLocation : [];
  const details = d.UserArea?.Details || {};
  const description = [details.JobSummary, d.QualificationSummary, details.MajorDuties, details.Requirements].map(valueToText).filter(Boolean).join('\n');
  const duties = valueToText(details.MajorDuties) || extractText(d.PositionFormattedDescription, ['Major Duties']);
  const qualifications = valueToText(d.QualificationSummary || details.Evaluations);
  const requirements = [details.Requirements, details.KeyRequirements, d.MinimumQualifications, qualifications].flatMap((value) => Array.isArray(value) ? value : [value]).filter(Boolean).map((value) => typeof value === 'object' ? (value.Content || value.Label || '') : String(value)).filter(Boolean);
  const location = d.PositionLocationDisplay || locations.map((entry) => entry.LocationName || entry.CityName || '').filter(Boolean).join('; ');
  const min = Number(pay.MinimumRange); const max = Number(pay.MaximumRange); const interval = String(pay.RateIntervalCode || '').toUpperCase();
  return { providerKey: 'usajobs', externalId: String(d.PositionID || item?.MatchedObjectId || d.PositionURI || ''), canonicalUrl: d.PositionURI || '', applicationUrl: Array.isArray(d.ApplyURI) ? d.ApplyURI[0] : (d.ApplyURI || d.PositionURI || ''), title: valueToText(d.PositionTitle), company: valueToText(d.OrganizationName || d.DepartmentName) || 'Federal government', agency: valueToText(d.OrganizationName), subAgency: valueToText(d.SubAgencyName), location: valueToText(location), locations, description: text(description), duties: text(duties), qualifications: text(qualifications), education: text(details.Education), requirements, benefits: valueToText(details.Benefits), travel: valueToText(details.Travel), salaryMin: Number.isFinite(min) ? min : null, salaryMax: Number.isFinite(max) ? max : null, salaryCurrency: 'USD', salaryInterval: interval === 'PA' ? 'yearly' : interval === 'PH' ? 'hourly' : 'unknown', employmentType: valueToText(d.PositionSchedule?.[0]?.Name) || 'Full-time', scheduleCodes: extractCodes(d.PositionSchedule), hiringPaths: extractCodes(details.WhoMayApply ? [details.WhoMayApply] : []), clearanceRequired: valueToText(details.SecurityClearance), securityClearance: valueToText(details.SecurityClearance), jobCategories: (d.JobCategory || []).map((entry) => valueToText(entry?.Name || entry)).filter(Boolean), jobCategoryCodes: extractCodes(d.JobCategory), payPlan: valueToText(d.JobGrade?.[0]?.Code), lowGrade: valueToText(d.LowGrade), highGrade: valueToText(d.HighGrade), remoteType: /remote|telework/i.test(`${location} ${description}`) ? 'remote' : 'onsite', postedAt: valueToText(d.PublicationStartDate || d.PositionStartDate) || null, expiresAt: valueToText(d.ApplicationCloseDate || d.PositionEndDate) || null, searchEvidence: { laneId: searchEvidence.laneId || '', type: searchEvidence.type || '', positionTitleQuery: searchEvidence.positionTitle || '', keywordQuery: searchEvidence.keyword || '', locationScope: searchEvidence.locationScope || '', relevanceRank: d.RelevanceRank || null } };
}

async function searchUsaJobs({ credentials = {}, lane = {}, scope = {}, page = 1, brief = {} }) {
  const key = credentials.usajobsApiKey || process.env.USAJOBS_API_KEY; const email = credentials.usajobsEmail || process.env.USAJOBS_EMAIL;
  if (!key || !email) return { jobs: [], resultCount: 0, totalAvailable: 0, diagnostics: { provider: 'usajobs', httpStatus: null, query: lane.positionTitle || lane.keyword || '', location: scope.locationName || '', resultCount: 0, durationMs: 0 }, error: { code: 'not_configured', message: 'Configure USAJOBS credentials in Profile & resume before searching.', retryable: false } };
  const params = buildUsaJobsParams(lane, scope, page, brief); const started = Date.now(); let response;
  try { response = await timeoutFetch(`${USAJOBS_URL}?${params}`, { headers: { Host: 'data.usajobs.gov', 'User-Agent': email, 'Authorization-Key': key, Accept: 'application/json' } }); }
  catch (cause) { return { jobs: [], resultCount: 0, totalAvailable: 0, diagnostics: { provider: 'usajobs', httpStatus: null, query: lane.positionTitle || lane.keyword || '', location: scope.locationName || '', resultCount: 0, durationMs: Date.now() - started }, error: { code: cause?.name === 'AbortError' ? 'timeout' : 'network', message: cause?.name === 'AbortError' ? 'USAJOBS request timed out. Try again.' : 'Could not reach USAJOBS. Check your connection and try again.', retryable: true } }; }
  if (!response.ok) { const code = response.status === 401 || response.status === 403 ? 'unauthorized' : response.status === 429 ? 'rate_limited' : response.status >= 500 ? 'provider_error' : 'provider_error'; return { jobs: [], resultCount: 0, totalAvailable: 0, diagnostics: { provider: 'usajobs', httpStatus: response.status, query: lane.positionTitle || lane.keyword || '', location: scope.locationName || '', resultCount: 0, durationMs: Date.now() - started }, error: { code, message: code === 'unauthorized' ? 'USAJOBS rejected the saved credentials.' : code === 'rate_limited' ? 'USAJOBS rate limit reached. Try again later.' : `USAJOBS returned HTTP ${response.status}.`, retryable: code !== 'unauthorized' } }; }
  let body; try { body = await response.json(); } catch { return { jobs: [], resultCount: 0, totalAvailable: 0, diagnostics: { provider: 'usajobs', httpStatus: response.status, query: lane.positionTitle || lane.keyword || '', location: scope.locationName || '', resultCount: 0, durationMs: Date.now() - started }, error: { code: 'invalid_response', message: 'USAJOBS returned an invalid response.', retryable: false } }; }
  const result = body?.SearchResult; const items = result?.SearchResultItems; if (!Array.isArray(items)) return { jobs: [], resultCount: 0, totalAvailable: 0, diagnostics: { provider: 'usajobs', httpStatus: response.status, query: lane.positionTitle || lane.keyword || '', location: scope.locationName || '', resultCount: 0, durationMs: Date.now() - started }, error: { code: 'invalid_response', message: 'USAJOBS returned an unexpected response shape.', retryable: false } };
  const evidence = { ...lane, locationScope: scope.locationName || scope.label || 'nationwide' }; const jobs = items.map((item) => normalizeUsaJobsItem(item, evidence)); return { jobs, resultCount: jobs.length, totalAvailable: Number(result.SearchResultCountAll || result.SearchResultCount || jobs.length), diagnostics: { provider: 'usajobs', httpStatus: response.status, query: lane.positionTitle || lane.keyword || '', location: scope.locationName || scope.label || 'nationwide', resultCount: jobs.length, durationMs: Date.now() - started }, error: null };
}

function jobIdentity(job = {}) { const provider = text(job.providerKey || job.apiSource || job.source, 40).toLowerCase(); const listingId = text(job.externalId || job.canonicalUrl || job.url, 1000); return provider && listingId ? `${provider}:${listingId}` : ''; }
function dedupeJobs(jobs) { const seen = new Set(); return jobs.filter((job) => { const key = jobIdentity(job); if (!key || seen.has(key)) return false; seen.add(key); return true; }); }
function excludePipelineJobs(jobs, pipelineJobs = []) { const saved = new Set((Array.isArray(pipelineJobs) ? pipelineJobs : []).map(jobIdentity).filter(Boolean)); return (Array.isArray(jobs) ? jobs : []).filter((job) => !saved.has(jobIdentity(job))); }
function normalizeMatchText(value) { return text(value, 50000).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function matchesHardExclusion(job, exclusions = []) { const haystack = normalizeMatchText(`${job.title} ${job.company} ${job.agency} ${job.description} ${job.duties} ${job.qualifications} ${(job.requirements || []).join(' ')}`); return exclusions.some((term) => { const needle = normalizeMatchText(term); return needle && haystack.includes(needle); }); }
function expandSearchAliases(value) { return normalizeMatchText(value).replace(/\bai\b/g, 'artificial intelligence').replace(/\bml\b/g, 'machine learning').replace(/\bnlp\b/g, 'natural language processing').replace(/\bgenai\b/g, 'generative ai'); }
function calculateRetrievalScore(job, brief = {}) { if (matchesHardExclusion(job, brief.exclusions || brief.excludedTerms)) return -1; const title = expandSearchAliases(job.title); const body = expandSearchAliases(`${job.description} ${job.duties} ${job.qualifications} ${(job.requirements || []).join(' ')}`); const families = list(brief.jobFamilies || brief.jobTypes || brief.searchQueries, 12).map(expandSearchAliases); const must = list(brief.mustHaveSkills, 12).map(expandSearchAliases); const nice = list(brief.niceToHaveSkills, 12).map(expandSearchAliases); const domainHit = /\b(artificial intelligence|machine learning|generative ai|natural language processing|software|computer|data)\b/.test(title); const technicalTitle = /\b(engineer|scientist|architect|specialist|developer|researcher|analyst|technologist|programmer|computer|software|data|systems)\b/.test(title); const descriptionDomainHit = /\b(artificial intelligence|machine learning|generative ai|natural language processing|software|computer|data)\b/.test(body); const titleScore = Math.max(families.reduce((best, family) => Math.max(best, family && title.includes(family) ? 39 : family.split(' ').filter((word) => word.length > 2 && title.includes(word)).length >= 2 ? 28 : 0), 0), technicalTitle && domainHit && descriptionDomainHit ? 28 : 0); const skillScore = Math.min(22, must.filter((skill) => skill && body.includes(skill)).length * 9 + nice.filter((skill) => skill && body.includes(skill)).length * 4); const hasCoreSignal = titleScore > 0 || skillScore > 0 || (technicalTitle && domainHit && descriptionDomainHit); if (!hasCoreSignal) return 0; const isRemote = job.remoteType === 'remote' || /\bremote\b|\banywhere\b/.test(normalizeMatchText(job.location)); const locationScore = !brief.locations?.length || isRemote || brief.remotePreference === 'remote' || brief.locations.some((loc) => normalizeMatchText(job.location).includes(normalizeMatchText(loc.raw || loc.city || loc.state))) ? 17 : 0; const remotePreferenceScore = isRemote ? 5 : 0; const seniorityScore = !brief.seniority?.length || brief.seniority.some((level) => normalizeMatchText(`${job.title} ${job.lowGrade} ${job.highGrade}`).includes(level)) ? 11 : 0; return Math.min(100, titleScore + skillScore + locationScore + remotePreferenceScore + seniorityScore); }
function filterJobs(jobs, plan = {}) { return jobs.filter((job) => calculateRetrievalScore(job, plan) >= 40); }
function scoreJobs(jobs, brief) { return jobs.map((job) => ({ job, retrievalScore: calculateRetrievalScore(job, brief) })).filter((entry) => entry.retrievalScore >= 40).sort((a, b) => b.retrievalScore - a.retrievalScore || String(a.job.title).localeCompare(String(b.job.title))); }
const PROVIDERS = ['usajobs', 'adzuna', 'remotive', 'dice'];
const PROVIDER_LABELS = { usajobs: 'USAJOBS / federal jobs', adzuna: 'Adzuna', remotive: 'Remotive', dice: 'Dice' };
// New providers must opt into this shared contract. Query-capable sources are
// given distinct variants until they collect 20 qualified jobs; feed-only
// sources are fetched once and report an honest shortfall, never fake retries.
const PROVIDER_CAPABILITIES = { usajobs: { queryCapable: true }, adzuna: { queryCapable: true }, remotive: { queryCapable: true }, dice: { queryCapable: true } };
function providerEnvelope(provider, result = {}) {
  const jobs = Array.isArray(result.jobs) ? result.jobs : [];
  const error = result.error || null;
  return { provider, status: error ? (['not_configured', 'no_valid_lane'].includes(error.code) ? 'skipped' : 'failed') : (jobs.length ? 'success' : 'empty'), jobs, error, diagnostics: result.diagnostics || {} };
}
function locationEligibility(job, brief = {}) {
  const requested = (brief.locations || []).map((entry) => normalizeMatchText(entry?.raw || entry)).filter(Boolean);
  const location = normalizeMatchText(job.location);
  const isRemote = job.remoteType === 'remote' || /\bremote\b|\banywhere\b/.test(location);
  const remoteAllowed = ['any', 'remote', 'hybrid'].includes(String(brief.remotePreference || 'any').toLowerCase());
  if (isRemote) return remoteAllowed ? null : 'not_remote_eligible';
  if (!requested.length) return null;
  return requested.some((place) => {
    const words = place.split(' ').filter((word) => word.length > 1);
    const city = words[0]; const state = words.find((word) => word.length === 2);
    // Listings commonly use "Irving, Dallas" or only "TX".  A city or state
    // token is enough evidence; remote was handled above and is never local.
    return location.includes(place) || place.includes(location)
      || (city && city.length > 2 && location.includes(city))
      || (state && new RegExp(`\\b${state}\\b`).test(location));
  }) ? null : 'wrong_location';
}
function qualificationReason(job, brief = {}) {
  const score = calculateRetrievalScore(job, brief);
  // The deterministic score is the only gate before the final AI. This keeps
  // provider-specific title, location, and exclusion heuristics from silently
  // removing listings that the AI may be able to evaluate from their evidence.
  return score >= MIN_DETERMINISTIC_SCORE ? null : 'deterministic_score_below_minimum';
}
function selectTopJobsPerProvider(jobs, plan = {}, { limitPerProvider = TARGET_TOP_COUNT } = {}) {
  const brief = plan.searchBrief || plan;
  const unique = dedupeJobs(Array.isArray(jobs) ? jobs : []);
  const selected = [];
  const providerStats = {};
  for (const provider of PROVIDERS) {
    const source = unique.filter((job) => job.providerKey === provider);
    const rejectionReasons = {};
    // Retrieval should remove only hard exclusions and clear location misses.
    // The final AI evaluator needs to see valid listings even when the local
    // heuristic cannot recognize a title family or skill phrasing.
    const eligible = source.filter((job) => {
      const reason = qualificationReason(job, brief);
      if (reason) { rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1; return false; }
      return true;
    });
    const ranked = eligible.map((job) => ({ ...job, retrievalScore: calculateRetrievalScore(job, brief), scoreType: 'deterministic' }))
      .sort((a, b) => b.retrievalScore - a.retrievalScore || String(a.title).localeCompare(String(b.title)) || String(a.externalId).localeCompare(String(b.externalId)));
    selected.push(...ranked.slice(0, limitPerProvider));
    providerStats[provider] = { unique: source.length, hardFiltered: source.length - eligible.length, eligible: eligible.length, qualified: eligible.length, deterministicTop: Math.min(ranked.length, limitPerProvider), rejectionReasons };
  }
  return { jobs: selected, providerStats };
}
function recoveryUsaJobsLanes(brief = {}) {
  const titles = ['IT Specialist', 'Computer Scientist', 'Computer Engineer', 'Systems Engineer'];
  return titles.map((positionTitle, index) => ({ laneId: `recovery-title-${index + 1}`, type: 'position-title', positionTitle, filters: {}, recovery: true, reason: 'Bounded broad federal-title recovery after zero AI-lane results' }));
}
function plannedProviderLanes(provider, planned = []) {
  const seen = new Set();
  return (Array.isArray(planned) ? planned : []).filter((lane) => {
    const query = text(lane.search || lane.what || lane.positionTitle || lane.keyword || (lane.searchTerms || []).join(' '), 160).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!query || seen.has(query)) return false; seen.add(query); return true;
  }).slice(0, MAX_PROVIDER_REQUESTS);
}

async function searchJobs({ profile = {}, credentials, plan = {}, diagnostics = null, refineQuery = null }) {
  // The normal path is AI planning and AI query refinement. A deterministic
  // plan remains available only when explicitly requested by configuration.
  if (!['ai', 'deterministic-fallback'].includes(plan.source)) throw new Error('A valid search plan is required.');
  const brief = plan.searchBrief || plan; const lanes = Array.isArray(plan.providerLanes) ? plan.providerLanes.slice(0, 8) : []; const adzunaLanes = Array.isArray(plan.adzunaQueries) ? plan.adzunaQueries.slice(0, MAX_PROVIDER_REQUESTS) : []; const firstLocation = brief.locations?.[0]; const normalized = await normalizeLocation(firstLocation?.raw || firstLocation || profile.targetLocations?.[0]); if (normalized.error) return { jobs: [], counts: { requests: 0, retrieved: 0, unique: 0, eligible: 0, deterministicTop: 0, aiSubmitted: 0 }, diagnostics: { attempts: [] }, error: normalized.error, warning: '' };
  const parsedLocation = normalized.parsed || parseUsLocation(normalized.value);
  const baseScope = normalized.value ? { locationName: normalized.value, location: parsedLocation, label: 'requested location', radiusMiles: brief.radiusMiles } : { locationName: '', label: 'nationwide' };
  const providerScopes = Object.fromEntries(PROVIDERS.map((provider) => [provider, formatLocationScope(baseScope, provider)]));
  const attempts = []; const results = []; const providerRunStats = {};
  const record = (provider, lane, scope, result, request) => { attempts.push({ provider, lane, scope, request }); results.push(result); };
  const safeResult = async (run) => { try { return await run(); } catch (cause) { return { jobs: [], resultCount: 0, diagnostics: {}, error: { code: 'provider_exception', message: cause?.message || 'Provider request failed unexpectedly.', retryable: true } }; } };
  async function paged(provider, providerLanes, search, requestFor, configured = true, maxPages = Math.ceil(TARGET_RETRIEVAL_COUNT / MAX_RESULTS_PER_REQUEST), providerScope = baseScope) {
    if (!configured) { record(provider, { laneId: `${provider}-not-configured`, type: 'skipped' }, providerScope, { jobs: [], resultCount: 0, diagnostics: {}, error: { code: 'not_configured', message: `${provider} credentials are not configured.`, retryable: false } }); return; }
    if (!providerLanes.length) { record(provider, { laneId: `${provider}-no-lane`, type: 'skipped' }, providerScope, { jobs: [], resultCount: 0, diagnostics: {}, error: { code: 'no_valid_lane', message: `No valid ${provider} lane was available.`, retryable: false } }); return; }
    const collected = []; const seen = new Set(); const qualified = new Set(); const attemptedQueries = new Set(); const laneQueue = [...providerLanes]; let requestsMade = 0; let diagnosticAttempts = 0;
    for (const lane of laneQueue) {
      let laneRaw = 0; let laneQualifiedStart = qualified.size;
      for (let page = 1; page <= maxPages && qualified.size < TARGET_QUALIFIED_COUNT && requestsMade < MAX_PROVIDER_REQUESTS; page += 1) {
      const queryKey = JSON.stringify({ lane: lane.positionTitle || lane.keyword || lane.what || lane.search || lane.searchTerms || '', page, location: providerScope.locationName || '' });
      if (attemptedQueries.has(queryKey)) continue;
      attemptedQueries.add(queryKey);
      let result = await safeResult(() => search({ credentials, lane, scope: providerScope, page, brief })); requestsMade += 1;
      // One bounded retry for retryable transport/provider errors; do not retry unauthorized or malformed responses.
      if (result.error?.retryable && requestsMade < MAX_PROVIDER_REQUESTS) {
        record(provider, lane, providerScope, result, requestFor ? () => requestFor(lane, page) : null);
        result = await safeResult(() => search({ credentials, lane, scope: providerScope, page, brief })); requestsMade += 1;
      }
      record(provider, lane, providerScope, result, requestFor ? () => requestFor(lane, page) : null);
      laneRaw += Number(result.resultCount) || 0;
      for (const job of result.jobs || []) { const key = `${job.providerKey}:${job.externalId || job.canonicalUrl}`; if (job.externalId && !seen.has(key)) { seen.add(key); collected.push(job); if (!qualificationReason(job, brief)) qualified.add(key); } }
       const noProviderResults = PROVIDER_CAPABILITIES[provider]?.paginated ? !result.rawResultCount : !result.resultCount;
       if (result.error || noProviderResults || (PROVIDER_CAPABILITIES[provider]?.paginated && result.hasNextPage === false) || (!PROVIDER_CAPABILITIES[provider]?.paginated && Number.isFinite(result.totalAvailable) && page * MAX_RESULTS_PER_REQUEST >= result.totalAvailable)) break;
      }
    if (qualified.size < TARGET_QUALIFIED_COUNT && requestsMade < MAX_PROVIDER_REQUESTS && PROVIDER_CAPABILITIES[provider]?.queryCapable && typeof refineQuery === 'function') {
      let nextLane = null;
      const refinementContext = { provider, brief, attemptedLanes: laneQueue, outcome: { query: lane.positionTitle || lane.keyword || lane.what || lane.search || '', rawRetrieved: laneRaw, newlyQualified: qualified.size - laneQualifiedStart, qualifiedCount: qualified.size, requestCount: requestsMade, diagnosticAttempt: true, failureReason: laneRaw === 0 ? 'provider_returned_zero_matches' : 'zero_jobs_reached_deterministic_threshold', requiredChange: provider === 'usajobs' ? 'Use a materially different position-title query before trying keyword-support again; do not repeat a failed Keyword query.' : 'Use a materially different query and explain what signal was missing from the prior query.' } };
      diagnosticAttempts += 1;
      try { nextLane = await refineQuery(refinementContext); } catch { nextLane = null; }
      const nextKey = nextLane && text(nextLane.search || nextLane.what || nextLane.positionTitle || nextLane.keyword || (nextLane.searchTerms || []).join(' '), 160).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const nextAttemptKey = nextLane && JSON.stringify({ lane: nextLane.positionTitle || nextLane.keyword || nextLane.what || nextLane.search || nextLane.searchTerms || '', page: 1, location: providerScope.locationName || '' });
      if (nextKey && !attemptedQueries.has(nextAttemptKey)) laneQueue.push(nextLane);
      else if (requestsMade < MAX_PROVIDER_REQUESTS) {
        // A failed or duplicate refinement gets one explicit diagnostic retry so
        // a bad Keyword lane cannot end the provider search prematurely.
        diagnosticAttempts += 1;
        try { nextLane = await refineQuery({ ...refinementContext, outcome: { ...refinementContext.outcome, diagnosticRetry: true, requiredChange: 'The prior refinement was empty or duplicated. Diagnose the failure and return a new valid query with different wording and a different search mode.' } }); } catch { nextLane = null; }
        const retryKey = nextLane && text(nextLane.search || nextLane.what || nextLane.positionTitle || nextLane.keyword || (nextLane.searchTerms || []).join(' '), 160).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const retryAttemptKey = nextLane && JSON.stringify({ lane: nextLane.positionTitle || nextLane.keyword || nextLane.what || nextLane.search || nextLane.searchTerms || '', page: 1, location: providerScope.locationName || '' });
        if (retryKey && !attemptedQueries.has(retryAttemptKey)) laneQueue.push(nextLane);
      }
      }
      if (qualified.size >= TARGET_QUALIFIED_COUNT || requestsMade >= MAX_PROVIDER_REQUESTS) break;
    }
    providerRunStats[provider] = { diagnosticAttempts, requestsMade, qualifiedCount: qualified.size };
    return { collected, qualifiedCount: qualified.size, queriesAttempted: attemptedQueries.size, exhausted: qualified.size < TARGET_QUALIFIED_COUNT, requestsMade, diagnosticAttempts };
  }
  const publicQueries = plan.publicQueries || {};
  const adaptiveLanes = Object.fromEntries(PROVIDERS.map((provider) => {
    const planned = provider === 'usajobs' ? lanes : provider === 'adzuna' ? adzunaLanes : publicQueries[provider];
    return [provider, plannedProviderLanes(provider, planned)];
  }));
  // Start all configured provider pipelines together; each pipeline owns its pagination bound.
  await Promise.allSettled([
    paged('usajobs', adaptiveLanes.usajobs, searchUsaJobs, (lane, page) => Object.fromEntries(buildUsaJobsParams(lane, providerScopes.usajobs, page, brief)), Boolean(credentials?.usajobsApiKey && credentials?.usajobsEmail), Math.ceil(TARGET_RETRIEVAL_COUNT / MAX_RESULTS_PER_REQUEST), providerScopes.usajobs),
    paged('adzuna', adaptiveLanes.adzuna, searchAdzuna, (lane, page) => { const params = require('./adzuna-provider.cjs').buildAdzunaParams(lane, providerScopes.adzuna, page, brief); return Object.fromEntries([...params].filter(([key]) => !['app_id', 'app_key'].includes(key))); }, Boolean(credentials?.adzunaAppId && credentials?.adzunaApiKey), Math.ceil(TARGET_RETRIEVAL_COUNT / MAX_RESULTS_PER_REQUEST), providerScopes.adzuna),
    paged('remotive', adaptiveLanes.remotive, searchRemotive, null, true, MAX_PROVIDER_REQUESTS, providerScopes.remotive),
    paged('dice', adaptiveLanes.dice, searchDice, (lane, page) => diceParams(lane, providerScopes.dice, page, brief), true, MAX_PROVIDER_REQUESTS, providerScopes.dice),
  ]);
  const envelopes = PROVIDERS.map((provider) => { const providerResults = results.filter((_, index) => attempts[index].provider === provider); const jobs = dedupeJobs(providerResults.flatMap((result) => Array.isArray(result.jobs) ? result.jobs : [])); const error = providerResults.find((result) => result.error)?.error || null; return providerEnvelope(provider, { jobs, error, diagnostics: { requests: providerResults.length } }); });
  const fetched = dedupeJobs(envelopes.flatMap((envelope) => envelope.jobs));
  const selection = selectTopJobsPerProvider(fetched, brief);
  const jobs = selection.jobs;
  const attemptsDiagnostics = results.map((result, index) => ({ ...result.diagnostics, provider: attempts[index].provider, laneId: attempts[index].lane.laneId, type: attempts[index].lane.type, recovery: Boolean(attempts[index].lane.recovery), errorCode: result.error?.code || null, errorMessage: result.error?.message || null, totalAvailable: result.totalAvailable }));
  for (let index = 0; index < results.length; index += 1) if (diagnostics) diagnostics.record({ provider: attempts[index].provider, lane: attempts[index].lane, scope: attempts[index].scope, result: results[index], request: attempts[index].request ? attempts[index].request() : (results[index].diagnostics?.request || { query: results[index].diagnostics?.query || '', location: results[index].diagnostics?.location || '' }) });
  const sourceStats = PROVIDERS.map((provider) => { const providerResults = results.filter((_, index) => attempts[index].provider === provider); const envelope = envelopes.find((entry) => entry.provider === provider); const stats = selection.providerStats[provider]; const rawKeys = new Set(providerResults.flatMap((result) => Array.isArray(result.rawExternalIds) ? result.rawExternalIds : (result.jobs || []).map((job) => String(job.externalId || job.canonicalUrl || '')).filter(Boolean))); const retrievedRaw = rawKeys.size || providerResults.reduce((sum, result) => sum + (Number(result.rawResultCount ?? result.resultCount) || 0), 0); const shortfall = !envelope.error && stats.qualified < TARGET_QUALIFIED_COUNT; const status = !envelope.error && stats.unique > 0 && stats.qualified === 0 ? 'filtered-out' : envelope.status === 'success' && shortfall ? 'shortfall' : envelope.status; const rejectionSummary = Object.entries(stats.rejectionReasons).map(([reason, count]) => `${count} ${reason.replaceAll('_', ' ')}`).join(', '); const queryRounds = new Set(providerResults.map((result) => result.diagnostics?.query).filter(Boolean)); return { provider: PROVIDER_LABELS[provider], key: provider, status, requests: providerResults.length, requestsAttempted: providerResults.length, requestBudget: MAX_PROVIDER_REQUESTS, pagesAttempted: providerResults.length, queryRounds: queryRounds.size, queriesAttempted: [...queryRounds], diagnosticAttempts: providerRunStats[provider]?.diagnosticAttempts || 0, exhausted: shortfall, shortfallReason: shortfall ? `Only ${stats.qualified} qualified listings after bounded query rounds${rejectionSummary ? `; rejected: ${rejectionSummary}` : ''}.` : '', retrievedRaw, fetched: retrievedRaw, uniqueCount: stats.unique, unique: stats.unique, hardFilteredCount: stats.hardFiltered, hardFiltered: stats.hardFiltered, filtered: stats.hardFiltered, eligibleCount: stats.eligible, eligible: stats.eligible, qualifiedCount: stats.qualified, deterministicTopCount: stats.deterministicTop, deterministicTop: stats.deterministicTop, finalSelectedCount: 0, aiSubmitted: stats.deterministicTop, targetRetrievalCount: TARGET_RETRIEVAL_COUNT, targetQualifiedCount: TARGET_QUALIFIED_COUNT, targetTopCount: TARGET_TOP_COUNT, errors: providerResults.filter((result) => result.error && result.error.code !== 'not_configured').length, failures: providerResults.map((result) => result.error?.message).filter(Boolean), rejectionReasons: stats.rejectionReasons, recoveryAttempts: 0 }; });
  const errors = results.map((result) => result.error).filter(Boolean); const warning = errors.length ? `${errors.length} job-source requests failed or did not return results; available results are still shown.` : jobs.length ? '' : fetched.length ? `Job sources returned ${fetched.length} listings.` : 'No job sources returned listings.';
  return { jobs, providerResults: envelopes, fetchedCount: fetched.length, filteredCount: Object.values(selection.providerStats).reduce((sum, stat) => sum + stat.hardFiltered, 0), counts: { requests: attempts.length, retrieved: sourceStats.reduce((sum, source) => sum + source.retrievedRaw, 0), unique: fetched.length, filtered: Object.values(selection.providerStats).reduce((sum, stat) => sum + stat.hardFiltered, 0), eligible: Object.values(selection.providerStats).reduce((sum, stat) => sum + stat.eligible, 0), deterministicTop: jobs.length, aiSubmitted: jobs.length }, sourceStats, attemptsDiagnostics, diagnostics: diagnostics || { attempts: attemptsDiagnostics }, warning, error: errors.length && !jobs.length ? { code: 'provider_error', message: warning, retryable: true } : null }; }
async function testUsaJobs(credentials) { const result = await searchUsaJobs({ credentials, lane: { laneId: 'connection-test', type: 'position-title', positionTitle: 'Computer Scientist', filters: {} }, scope: { locationName: '' }, page: 1, brief: {} }); if (result.error) return { ok: false, ...result.error }; return { ok: true, status: 200, count: result.resultCount }; }
module.exports = { searchJobs, searchUsaJobs, testUsaJobs, filterJobs, matchesExcluded: matchesHardExclusion, matchesHardExclusion, calculateRetrievalScore, qualificationReason, plannedProviderLanes, PROVIDER_CAPABILITIES, MAX_PROVIDER_REQUESTS, MIN_DETERMINISTIC_SCORE, buildUsaJobsParams, normalizeUsaJobsItem, dedupeJobs, excludePipelineJobs, selectTopJobsPerProvider, recoveryUsaJobsLanes, PROVIDERS };
