const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildUsaJobsParams,
  normalizeUsaJobsItem,
  searchUsaJobs,
  searchJobs,
  calculateRetrievalScore,
  qualificationReason,
  plannedProviderLanes,
  MAX_PROVIDER_REQUESTS,
  filterJobs,
  excludePipelineJobs,
  selectTopJobsPerProvider,
} = require('../electron/job-search.cjs');
const { fallbackSearchBrief, buildProviderLanes } = require('../electron/job-search-planner.cjs');
const { parseUsLocation, formatLocationForProvider, formatLocationScope } = require('../electron/location-format.cjs');

function aiSearchPlan(brief, includeAdzuna = false) {
  return {
    ...brief,
    source: 'ai',
    searchBrief: brief,
    providerLanes: buildProviderLanes(brief),
    ...(includeAdzuna ? { adzunaQueries: [{ laneId: 'adzuna-test', type: 'adzuna-query', what: 'AI engineer' }] } : {}),
  };
}

function usaItem(overrides = {}) {
  return {
    MatchedObjectId: '123',
    MatchedObjectDescriptor: {
      PositionID: 'AI-123',
      PositionTitle: 'Computer Scientist',
      PositionURI: 'https://www.usajobs.gov/job/AI-123',
      ApplyURI: ['https://www.usajobs.gov/job/AI-123/apply'],
      OrganizationName: 'Example Agency',
      DepartmentName: 'Example Department',
      SubAgencyName: 'Example Subagency',
      PositionLocationDisplay: 'Dallas, Texas',
      PositionLocation: [{ LocationName: 'Dallas, Texas', CityName: 'Dallas', StateCode: 'TX' }],
      PositionRemuneration: [{ MinimumRange: '100000', MaximumRange: '140000', RateIntervalCode: 'PA' }],
      PositionSchedule: [{ Name: 'Full-time', Code: '1' }],
      JobCategory: [{ Name: 'Computer Science', Code: '1550' }],
      JobGrade: [{ Code: 'GS-13' }],
      LowGrade: '13',
      HighGrade: '14',
      PublicationStartDate: '2026-08-01',
      ApplicationCloseDate: '2026-08-31',
      QualificationSummary: 'Experience with machine learning and Python.',
      PositionFormattedDescription: [{ Label: 'Major Duties', Content: 'Build machine learning systems.' }],
      UserArea: { Details: { JobSummary: 'Build machine learning systems.', MajorDuties: 'Build AI systems.', Education: 'Degree or equivalent.', Requirements: 'Public trust.', Benefits: 'Benefits.' } },
      ...overrides,
    },
  };
}

test('title-first lane uses PositionTitle and does not send broad Keyword', () => {
  const params = buildUsaJobsParams({ laneId: 'title-1', type: 'position-title', positionTitle: 'Computer Scientist', filters: {} }, { locationName: 'Dallas, TX', radiusMiles: 50 }, 1);
  assert.equal(params.get('PositionTitle'), 'Computer Scientist');
  assert.equal(params.get('Keyword'), null);
  assert.equal(params.get('LocationName'), 'Dallas, TX');
  assert.equal(params.get('Radius'), '50');
  assert.equal(params.get('Fields'), 'Full');
});

test('keyword support lane is bounded and carries title context when supplied', () => {
  const params = buildUsaJobsParams({ laneId: 'keyword-1', type: 'keyword-support', keyword: 'machine learning', positionTitle: 'Computer Scientist', filters: {} }, { locationName: '', radiusMiles: null }, 1);
  assert.equal(params.get('Keyword'), 'machine learning');
  assert.equal(params.get('PositionTitle'), 'Computer Scientist');
  assert.equal(params.get('LocationName'), null);
});

test('fallback brief expands rough AI intent into federal job families and lanes', () => {
  const brief = fallbackSearchBrief({ targetRoles: ['AI FDW'], interests: ['automation'], targetLocations: ['Dallas, TX'] }, { rawText: '' });
  assert.ok(brief.jobFamilies.some((value) => /computer scientist|it specialist|data scientist/i.test(value)));
  const lanes = buildProviderLanes(brief);
  assert.ok(lanes.some((lane) => lane.type === 'position-title'));
  assert.ok(lanes.some((lane) => lane.type === 'keyword-support'));
});

test('USAJOBS item normalization exposes matching evidence fields', () => {
  const job = normalizeUsaJobsItem(usaItem(), { laneId: 'title-1', type: 'position-title', positionTitle: 'Computer Scientist', locationScope: 'Dallas, TX' });
  assert.equal(job.externalId, 'AI-123');
  assert.equal(job.agency, 'Example Agency');
  assert.equal(job.salaryMin, 100000);
  assert.equal(job.salaryInterval, 'yearly');
  assert.equal(job.jobCategoryCodes[0], '1550');
  assert.equal(job.searchEvidence.laneId, 'title-1');
  assert.match(job.duties, /machine learning|AI systems/i);
});

test('normalization never leaks object placeholders into searchable text', () => {
  const job = normalizeUsaJobsItem(usaItem({ UserArea: { Details: { JobSummary: { Content: 'Build machine learning systems.' }, MajorDuties: [{ Content: 'Deploy AI services.' }], Requirements: [{ Label: 'Requirement', Content: 'Python.' }] } } }), { laneId: 'title-1', type: 'position-title', positionTitle: 'Computer Scientist' });
  assert.doesNotMatch(job.description, /\[object Object\]/);
  assert.doesNotMatch(job.duties, /\[object Object\]/);
  assert.match(job.description, /machine learning/i);
  assert.match(job.duties, /AI services/i);
});

test('searchUsaJobs reports request diagnostics and valid empty results', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.match(String(url), /PositionTitle=Computer\+Scientist/);
    return { ok: true, status: 200, json: async () => ({ SearchResult: { SearchResultItems: [], SearchResultCountAll: 0 } }) };
  };
  try {
    const result = await searchUsaJobs({ credentials: { usajobsEmail: 'test@example.com', usajobsApiKey: 'test-key' }, lane: { laneId: 'title-1', type: 'position-title', positionTitle: 'Computer Scientist', filters: {} }, scope: { locationName: '' }, page: 1 });
    assert.equal(result.error, null);
    assert.equal(result.resultCount, 0);
    assert.equal(result.totalAvailable, 0);
    assert.equal(result.diagnostics.httpStatus, 200);
  } finally { global.fetch = originalFetch; }
});

test('searchUsaJobs distinguishes unauthorized responses without leaking credentials', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  try {
    const result = await searchUsaJobs({ credentials: { usajobsEmail: 'test@example.com', usajobsApiKey: 'secret-key' }, lane: { laneId: 'title-1', type: 'position-title', positionTitle: 'Computer Scientist', filters: {} }, scope: { locationName: '' }, page: 1 });
    assert.equal(result.error.code, 'unauthorized');
    assert.doesNotMatch(JSON.stringify(result), /secret-key|test@example.com/);
  } finally { global.fetch = originalFetch; }
});

test('searchJobs keeps relevant jobs and exposes lane counts', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ SearchResult: { SearchResultCountAll: '1', SearchResultItems: [usaItem()] } }) });
  try {
    const brief = fallbackSearchBrief({ targetRoles: ['AI engineer'], targetLocations: ['Dallas, TX'] }, {});
    const result = await searchJobs({ profile: { targetRoles: ['AI engineer'], targetLocations: ['Dallas, TX'], remotePreference: 'any' }, credentials: { usajobsEmail: 'test@example.com', usajobsApiKey: 'test-key' }, plan: aiSearchPlan(brief) });
    assert.ok(result.jobs.length >= 1);
    assert.ok(result.diagnostics.attempts.length >= 1);
    assert.equal(result.counts.retrieved, 1);
    assert.equal(result.counts.unique, 1);
    assert.equal(result.counts.filtered, 0);
    assert.equal(result.counts.aiSubmitted, 1);
    assert.equal(result.sourceStats[0].fetched, 1);
    assert.equal(result.sourceStats[0].filtered, 0);
    assert.equal(result.sourceStats[0].aiSubmitted, 1);
  } finally { global.fetch = originalFetch; }
});

test('Adzuna failure does not hide successful USAJOBS results', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => String(url).includes('api.adzuna.com')
    ? { ok: false, status: 400, json: async () => ({ error: 'Invalid location parameter' }) }
    : { ok: true, status: 200, json: async () => ({ SearchResult: { SearchResultCountAll: '1', SearchResultItems: [usaItem()] } }) };
  try {
    const brief = fallbackSearchBrief({ targetRoles: ['AI engineer'], targetLocations: ['Dallas, TX'] }, {});
    const result = await searchJobs({ profile: { targetRoles: ['AI engineer'], targetLocations: ['Dallas, TX'], remotePreference: 'any' }, credentials: { usajobsEmail: 'test@example.com', usajobsApiKey: 'test-key', adzunaAppId: 'app-1', adzunaApiKey: 'key-1' }, plan: aiSearchPlan(brief, true) });
    assert.ok(result.jobs.length >= 1);
    assert.equal(result.error, null);
    assert.match(result.warning, /job-source requests failed/);
    assert.ok(result.sourceStats.some((source) => source.key === 'adzuna' && source.errors > 0));
    assert.doesNotMatch(JSON.stringify(result), /app-1|key-1/);
  } finally { global.fetch = originalFetch; }
});

test('Adzuna sends five planned role titles as five separate what requests', async () => {
  const originalFetch = global.fetch;
  const queries = [];
  const expected = ['Forward Deployed Engineer', 'AI Implementation Engineer', 'Solutions Engineer AI', 'Applied AI Engineer', 'Technical Solutions Engineer'];
  global.fetch = async (url) => {
    const value = String(url);
    assert.match(value, /api\.adzuna\.com/);
    queries.push(new URL(value).searchParams.get('what'));
    return { ok: true, status: 200, json: async () => ({ results: [], count: 0 }) };
  };
  try {
    const result = await searchJobs({
      profile: {},
      credentials: { adzunaAppId: 'app-1', adzunaApiKey: 'key-1' },
      plan: {
        source: 'ai',
        searchBrief: { targetIntent: expected[0], jobFamilies: [expected[0]], locations: [] },
        providerLanes: [],
        adzunaQueries: expected.map((what, index) => ({ laneId: `adzuna-${index + 1}`, what })),
        publicQueries: { remotive: [], dice: [] },
      },
    });
    assert.deepEqual(queries, expected);
    assert.equal(result.sourceStats.find((entry) => entry.key === 'adzuna').requestsAttempted, 5);
  } finally { global.fetch = originalFetch; }
});

test('retrieval score favors title and skills and hard exclusions remove aviation', () => {
  const brief = fallbackSearchBrief({ targetRoles: ['AI engineer'], excludedKeywords: ['aviation'] }, {});
  const relevant = normalizeUsaJobsItem(usaItem(), { laneId: 'title-1', type: 'position-title', positionTitle: 'Computer Scientist' });
  const unrelated = { ...relevant, title: 'Aviation Safety Inspector', description: 'aircraft and aviation operations', company: 'FAA' };
  assert.ok(calculateRetrievalScore(relevant, brief) > calculateRetrievalScore(unrelated, brief));
  assert.equal(filterJobs([unrelated], brief).length, 0);
});

test('retrieval uses a 40-point minimum and does not score salary', () => {
  const brief = fallbackSearchBrief({ targetRoles: ['AI engineer'], targetLocations: ['Dallas, TX'] }, {});
  const relevant = normalizeUsaJobsItem(usaItem(), { laneId: 'title-1', type: 'position-title', positionTitle: 'Computer Scientist' });
  const withoutSalary = { ...relevant, salaryMin: null, salaryMax: null };
  assert.equal(calculateRetrievalScore(withoutSalary, brief), calculateRetrievalScore(relevant, brief));
  assert.ok(calculateRetrievalScore(withoutSalary, brief) >= 40);
  const weak = { ...relevant, title: 'Administrative Assistant', description: '', duties: '', qualifications: '', requirements: [] };
  assert.ok(calculateRetrievalScore(weak, brief) < 40);
  assert.deepEqual(filterJobs([withoutSalary, weak], brief), [withoutSalary]);
});


test('provider failure remains distinct from an empty successful search', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  try {
    const brief = fallbackSearchBrief({ targetRoles: ['AI engineer'] }, {});
    const result = await searchJobs({ profile: { targetRoles: ['AI engineer'], targetLocations: [] }, credentials: { usajobsEmail: 'test@example.com', usajobsApiKey: 'test-key' }, plan: aiSearchPlan(brief) });
    assert.ok(result.error);
    assert.equal(result.error.code, 'provider_error');
    assert.equal(result.counts.retrieved, 0);
  } finally { global.fetch = originalFetch; }
});


test('network failure is retryable and safe', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('network down'); };
  try {
    const result = await searchUsaJobs({ credentials: { usajobsEmail: 'test@example.com', usajobsApiKey: 'test-key' }, lane: { laneId: 'title-1', type: 'position-title', positionTitle: 'Computer Scientist', filters: {} }, scope: { locationName: '' }, page: 1 });
    assert.equal(result.error.code, 'network');
    assert.equal(result.error.retryable, true);
  } finally { global.fetch = originalFetch; }
});

test('retrieval starts all four providers before waiting and reports every provider', async () => {
  const originalFetch = global.fetch; const started = []; const releases = []; let released = false;
  global.fetch = async (url) => { started.push(String(url)); if (!released) await new Promise((resolve) => releases.push(resolve)); if (String(url).includes('usajobs')) return { ok: true, status: 200, json: async () => ({ SearchResult: { SearchResultItems: [], SearchResultCountAll: 0 } }) }; if (String(url).includes('adzuna')) return { ok: true, status: 200, json: async () => ({ results: [], count: 0 }) }; if (String(url).includes('remotive')) return { ok: true, status: 200, json: async () => ({ jobs: [] }) }; return { ok: true, status: 200, json: async () => ({ jobs: [] }) }; };
  try {
    const brief = fallbackSearchBrief({ targetRoles: ['AI engineer'] }, {}); const plan = { ...aiSearchPlan(brief, true), publicQueries: { remotive: [{ laneId: 'r', search: 'AI engineer' }], dice: [{ laneId: 'd', keyword: 'AI engineer' }] } };
    const pending = searchJobs({ profile: {}, credentials: { usajobsEmail: 'x@y.com', usajobsApiKey: 'x', adzunaAppId: 'x', adzunaApiKey: 'x' }, plan });
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(started.some((url) => url.includes('usajobs'))); assert.ok(started.some((url) => url.includes('adzuna'))); assert.ok(started.some((url) => url.includes('remotive'))); assert.ok(started.some((url) => url.includes('mcp.dice.com')));
    released = true; while (releases.length) releases.shift()();
    const result = await pending;
    assert.deepEqual(result.providerResults.map((entry) => entry.provider), ['usajobs', 'adzuna', 'remotive', 'dice']);
  } finally { global.fetch = originalFetch; }
});

test('deterministic provider selection keeps high-quality jobs eligible beyond 20 per provider', () => {
  const candidate = (providerKey, id) => ({ providerKey, externalId: `${providerKey}-${id}`, title: 'Machine Learning Engineer', description: 'machine learning', requirements: [] });
  const result = selectTopJobsPerProvider([...Array.from({ length: 25 }, (_, index) => candidate('usajobs', index)), ...Array.from({ length: 3 }, (_, index) => candidate('remotive', index)), { ...candidate('adzuna', 'excluded'), title: 'Aviation AI Engineer', description: 'aviation' }], { exclusions: ['aviation'], jobFamilies: ['Machine Learning Engineer'] });
  assert.equal(result.jobs.filter((job) => job.providerKey === 'usajobs').length, 25);
  assert.equal(result.jobs.filter((job) => job.providerKey === 'remotive').length, 3);
  assert.equal(result.providerStats.adzuna.hardFiltered, 1);
  assert.ok(result.jobs.every((job) => job.scoreType === 'deterministic'));
});

test('qualification uses only the deterministic score threshold as its gate', () => {
  const unrelated = { providerKey: 'remotive', externalId: 'unrelated', title: 'Customer Success Manager', description: 'Own renewals and account plans.', location: 'Remote', remoteType: 'remote' };
  const valid = { providerKey: 'remotive', externalId: 'valid', title: 'Machine Learning Engineer', description: 'Python machine learning systems.', location: 'Remote', remoteType: 'remote' };
  const brief = { jobFamilies: ['Machine Learning Engineer'], mustHaveSkills: ['python'], remotePreference: 'any' };
  assert.equal(qualificationReason(unrelated, brief), 'deterministic_score_below_minimum');
  const selected = selectTopJobsPerProvider([unrelated, valid], brief);
  assert.equal(selected.jobs.length, 1);
  assert.equal(selected.providerStats.remotive.rejectionReasons.deterministic_score_below_minimum, 1);
});

test('Remotive continues with distinct query variants until it has 20 qualified jobs', async () => {
  const originalFetch = global.fetch; const remotiveQueries = [];
  const remotiveJob = (id, title, description) => ({ id: `remote-${id}`, title, description, company_name: 'Example', candidate_required_location: 'Remote', url: `https://example.test/${id}` });
  global.fetch = async (url) => {
    const value = String(url);
    if (value.includes('remotive.com')) {
      const query = new URL(value).searchParams.get('search'); remotiveQueries.push(query);
      const poor = query === 'data scientist';
      return { ok: true, status: 200, json: async () => ({ 'job-count': 20, jobs: Array.from({ length: 20 }, (_, index) => remotiveJob(`${poor ? 'poor' : 'good'}-${index}`, poor ? 'Customer Success Manager' : 'Machine Learning Engineer', poor ? 'Own account renewals.' : 'Build Python machine learning systems.')) }) };
    }
    throw new Error(`Unexpected request: ${value}`);
  };
  try {
    const brief = { jobFamilies: ['Machine Learning Engineer'], mustHaveSkills: ['python'], remotePreference: 'any', locations: [] };
    const result = await searchJobs({ plan: { source: 'ai', searchBrief: brief, providerLanes: [], adzunaQueries: [], publicQueries: { remotive: [{ laneId: 'narrow', search: 'data scientist' }] } }, refineQuery: async ({ provider }) => provider === 'remotive' ? { laneId: 'ai-refined', search: 'Machine Learning Engineer' } : null });
    const remotive = result.sourceStats.find((entry) => entry.key === 'remotive');
    assert.deepEqual(remotiveQueries.slice(0, 2), ['data scientist', 'Machine Learning Engineer']);
    assert.equal(remotive.requestsAttempted, 2);
    assert.equal(remotive.qualifiedCount, 20);
    assert.equal(remotive.exhausted, false);
    assert.equal(result.jobs.filter((job) => job.providerKey === 'remotive').length, 20);
  } finally { global.fetch = originalFetch; }
});

test('planned provider query contract preserves only distinct AI-created lanes within the five-request budget', () => {
  const lanes = plannedProviderLanes('remotive', [{ laneId: 'one', search: 'narrow role' }, { laneId: 'duplicate', search: 'narrow role' }, { laneId: 'two', search: 'better role' }]);
  assert.equal(MAX_PROVIDER_REQUESTS, 5);
  assert.ok(lanes.length <= MAX_PROVIDER_REQUESTS);
  assert.equal(new Set(lanes.map((lane) => lane.search)).size, lanes.length);
});

test('a query-capable provider uses all five request slots when it never reaches 20 qualified jobs', async () => {
  const originalFetch = global.fetch; let remotiveCalls = 0;
  global.fetch = async (url) => {
    const value = String(url);
    if (value.includes('remotive.com')) {
      remotiveCalls += 1;
      return { ok: true, status: 200, json: async () => ({ 'job-count': 20, jobs: Array.from({ length: 20 }, (_, index) => ({ id: `unqualified-${remotiveCalls}-${index}`, title: 'Customer Success Manager', description: 'Own renewals.', company_name: 'Example', candidate_required_location: 'Remote', url: `https://example.test/${remotiveCalls}/${index}` })) }) };
    }
    throw new Error(`Unexpected request: ${value}`);
  };
  try {
    const brief = { targetIntent: 'AI engineer', jobFamilies: ['Machine Learning Engineer', 'Data Scientist', 'Platform Engineer'], mustHaveSkills: ['python', 'aws'], remotePreference: 'any', locations: [] };
    const result = await searchJobs({ plan: { source: 'ai', searchBrief: brief, providerLanes: [], adzunaQueries: [], publicQueries: { remotive: [{ laneId: 'narrow', search: 'narrow role' }] } }, refineQuery: async ({ provider, attemptedLanes }) => provider === 'remotive' ? { laneId: `ai-${attemptedLanes.length + 1}`, search: `AI tailored query ${attemptedLanes.length + 1}` } : null });
    const remotive = result.sourceStats.find((entry) => entry.key === 'remotive');
    assert.equal(remotiveCalls, MAX_PROVIDER_REQUESTS);
    assert.equal(remotive.requestsAttempted, MAX_PROVIDER_REQUESTS);
    assert.equal(remotive.qualifiedCount, 0);
    assert.equal(remotive.exhausted, true);
  } finally { global.fetch = originalFetch; }
});

test('selected US locations normalize to each provider contract', () => {
  const parsed = parseUsLocation('Oklahoma City, OK');
  assert.deepEqual({ city: parsed.city, stateCode: parsed.stateCode, stateName: parsed.stateName }, { city: 'Oklahoma City', stateCode: 'OK', stateName: 'Oklahoma' });
  assert.equal(formatLocationForProvider(parsed, 'usajobs'), 'Oklahoma City, Oklahoma');
  assert.equal(formatLocationForProvider(parsed, 'adzuna'), 'Oklahoma City, OK');
  assert.equal(formatLocationForProvider(parsed, 'dice'), 'Oklahoma City, OK');
  assert.equal(formatLocationScope({ locationName: 'Oklahoma City, OK', radiusMiles: 100 }, 'usajobs').locationName, 'Oklahoma City, Oklahoma');
});

test('pipeline jobs are excluded from later AI-ranking candidates by provider and listing ID', () => {
  const candidates = [
    { providerKey: 'dice', externalId: 'already-saved', title: 'Saved role' },
    { providerKey: 'dice', externalId: 'new-role', title: 'New role' },
    { providerKey: 'adzuna', externalId: 'already-saved', title: 'Same ID from another provider' },
  ];
  const saved = [{ apiSource: 'dice', externalId: 'already-saved' }];

  assert.deepEqual(excludePipelineJobs(candidates, saved).map((job) => job.title), ['New role', 'Same ID from another provider']);
});

test('remote candidates remain eligible and receive a modest retrieval preference', () => {
  const brief = { jobFamilies: ['Machine Learning Engineer'], locations: [{ raw: 'Dallas, TX' }], remotePreference: 'any' };
  const remote = { providerKey: 'dice', externalId: 'remote', title: 'Machine Learning Engineer', description: 'Build machine learning systems.', location: 'Remote', remoteType: 'remote' };
  const local = { ...remote, externalId: 'local', location: 'Dallas, TX', remoteType: 'onsite' };
  assert.ok(qualificationReason(remote, brief) === null);
  assert.equal(calculateRetrievalScore(remote, brief) > calculateRetrievalScore(local, brief), true);
});
