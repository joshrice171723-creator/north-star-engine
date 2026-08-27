const assert = require('node:assert/strict');
const test = require('node:test');
const { createSearchPlan, refineProviderQuery, parsePlannerResponse, parseSearchBriefResponse, refinementForPlanner, fallbackPlan } = require('../electron/job-search-planner.cjs');
const { filterJobs } = require('../electron/job-search.cjs');

test('refinement planner context accepts only known feedback and keeps only safe aggregate counts', () => {
  const result = refinementForPlanner({ action: 'more_remote', report: { providers: [{ provider: 'remotive', status: 'success', retrieved: 12, filtered: 4, submitted: 8, selected: 3, displayed: 3, credentials: 'never include' }] } });
  assert.deepEqual(result, { action: 'more_remote', providers: [{ provider: 'remotive', status: 'success', retrieved: 12, filtered: 4, submitted: 8, selected: 3, displayed: 3 }] });
  assert.equal(refinementForPlanner({ action: 'arbitrary instructions' }), null);
});

test('planner accepts structured AI output and preserves user exclusions', () => {
  const plan = parsePlannerResponse({ ok: true, message: { content: JSON.stringify({ interpretation: 'AI architecture work', jobTypes: ['AI Solutions Architect', 'AI Automation Architect'], searchQueries: ['AI solutions architect', 'AI automation architect'], preferredIndustries: ['technology'], excludedTerms: ['aviation'], locationStrategy: 'near target location' }) } }, { excludedKeywords: ['government'] });
  assert.deepEqual(plan.searchQueries, ['AI solutions architect', 'AI automation architect']);
  assert.deepEqual(plan.excludedTerms, ['government', 'aviation']);
});

test('planner fallback creates related queries instead of using one raw target phrase', () => {
  const plan = fallbackPlan({ targetRoles: ['AI FDW'], targetIndustries: ['technology'], interests: ['automation'] });
  assert.ok(plan.searchQueries.length >= 2);
  assert.ok(plan.excludedTerms.includes('aviation'));
  assert.ok(plan.providerQueries.usajobs.some((lane) => lane.positionTitle === 'IT Specialist'));
  assert.ok(plan.providerQueries.adzuna.length > 0);
  assert.equal(plan.source, 'deterministic-fallback');
});

test('planner fallback prioritizes explicit AI implementation target titles', () => {
  const plan = fallbackPlan({
    targetRoles: ['AI Automation Engineer', 'AI Implementation Engineer', 'Forward Deployed Engineer', 'Solutions Engineer (AI)', 'Technical Consultant (AI)'],
    interests: ['workflow automation'],
  });
  const targetTitles = ['AI Automation Engineer', 'AI Implementation Engineer', 'Forward Deployed Engineer', 'Solutions Engineer (AI)', 'Technical Consultant (AI)'];
  assert.deepEqual(plan.jobFamilies.slice(0, 5), targetTitles);
  assert.deepEqual(plan.providerQueries.usajobs.slice(0, 5).map((lane) => lane.positionTitle), targetTitles);
});

test('provider filter removes excluded aviation listings before ranking', () => {
  const plan = { jobTypes: ['AI Solutions Architect'], excludedTerms: ['aviation', 'aircraft'] };
  const jobs = [
    { title: 'PUBLIC NOTICE - Aviation Safety Inspector', company: 'FAA', description: 'aircraft airworthiness', requirements: [] },
    { title: 'AI Solutions Architect', company: 'Example', description: 'design generative AI platforms', requirements: [] }
  ];
  assert.deepEqual(filterJobs(jobs, plan).map((job) => job.title), ['AI Solutions Architect']);
});

test('provider filter accepts common USAJOBS AI and technical title variants', () => {
  const plan = { jobTypes: ['AI Engineer'], excludedTerms: ['aviation'] };
  const jobs = [
    { title: 'Artificial Intelligence Engineer', description: '', requirements: [] },
    { title: 'IT Specialist (Artificial Intelligence)', description: 'machine learning and software systems', requirements: [] },
    { title: 'Computer Scientist', description: 'develop machine learning models and artificial intelligence systems', requirements: [] },
    { title: 'Accounting Technician', description: 'financial records', requirements: [] }
  ];
  assert.deepEqual(filterJobs(jobs, plan).map((job) => job.title), [
    'Artificial Intelligence Engineer',
    'IT Specialist (Artificial Intelligence)',
    'Computer Scientist'
  ]);
});

test('planner uses nested AI output and preserves all provider queries', async () => {
  const adzuna = ['AI FDW', 'AI Architect', 'AI Implementation Engineer', 'Solutions Engineer AI', 'Applied AI Engineer'].map((what, index) => ({ laneId: `adzuna-${index + 1}`, what, where: 'Dallas, TX' }));
  const plan = await createSearchPlan({ profile: { targetRoles: ['AI FDW'] }, resume: { rawText: 'cloud architecture and automation' }, openRouter: async () => ({ ok: true, message: { content: JSON.stringify({ searchBrief: { interpretation: 'AI architecture', jobFamilies: ['AI Architect'], searchQueries: ['AI architect'], exclusions: ['aviation'] }, providerQueries: { usajobs: [{ laneId: 'usa-1', type: 'position-title', positionTitle: 'Computer Scientist' }], adzuna, remotive: [{ laneId: 'remotive-1', search: 'AI architect', limit: 50 }], dice: [{ laneId: 'dice-1', keyword: 'AI architect' }] } }) } }) });
  assert.equal(plan.source, 'ai');
  assert.deepEqual(plan.searchQueries, ['AI architect']);
  assert.equal(plan.providerQueries.usajobs[0].positionTitle, 'Computer Scientist');
  assert.deepEqual(plan.adzunaQueries.map((lane) => lane.what), ['AI FDW', 'AI Architect', 'AI Implementation Engineer', 'Solutions Engineer AI', 'Applied AI Engineer']);
  assert.equal(plan.publicQueries.remotive[0].search, 'AI architect');
  assert.equal(plan.publicQueries.dice[0].keyword, 'AI architect');
});

test('planner accepts object content and a short wrapper sentence', () => {
  const response = {
    ok: true,
    message: {
      content: { text: `Here is the plan:\n${JSON.stringify({
        searchBrief: { jobFamilies: ['AI Engineer'] },
        providerQueries: {
          usajobs: [{ positionTitle: 'Computer Scientist' }],
          adzuna: [{ what: 'AI Engineer' }],
          remotive: [{ search: 'AI Engineer' }],
          dice: [{ keyword: 'AI Engineer' }],
        },
      })}` },
    },
  };
  const plan = parseSearchBriefResponse(response, { targetRoles: ['AI Engineer'] });
  assert.equal(plan.providerQueries.usajobs[0].positionTitle, 'Computer Scientist');
});

test('planner rejects an AI response that omits a provider query set', async () => {
  await assert.rejects(() => createSearchPlan({ profile: { targetRoles: ['AI engineer'] }, openRouter: async () => ({ ok: true, message: { content: JSON.stringify({ searchBrief: { jobFamilies: ['AI engineer'] }, providerQueries: { usajobs: [{ positionTitle: 'Computer Scientist' }] } }) } }) }), /adzuna.*at least one AI-generated query/i);
});

test('AI planner preserves provider-compatible queries separately from conceptual queries', () => {
  const plan = parsePlannerResponse({ ok: true, message: { content: JSON.stringify({ interpretation: 'AI engineering', jobTypes: ['AI Engineer'], searchQueries: ['Applied AI Engineer'], providerQueries: ['IT Specialist', 'Computer Scientist', 'Artificial Intelligence'], excludedTerms: [] }) } }, {});
  assert.deepEqual(plan.searchQueries, ['Applied AI Engineer']);
  assert.deepEqual(plan.providerQueries, ['IT Specialist', 'Computer Scientist', 'Artificial Intelligence']);
});

test('planner accepts fenced JSON and content-part responses', () => {
  const response = {
    ok: true,
    message: {
      content: [
        { type: 'text', text: '```json\n' },
        { type: 'text', text: JSON.stringify({ searchBrief: { jobFamilies: ['AI Engineer'] }, providerQueries: {
          usajobs: [{ positionTitle: 'Computer Scientist' }],
          adzuna: [{ what: 'AI Engineer' }],
          remotive: [{ search: 'AI Engineer' }],
          dice: [{ keyword: 'AI Engineer' }],
        } }) },
        { type: 'text', text: '\n```' },
      ],
    },
  };
  const plan = parseSearchBriefResponse(response, { targetRoles: ['AI Engineer'] });
  assert.equal(plan.providerQueries.usajobs[0].positionTitle, 'Computer Scientist');
  assert.equal(plan.providerQueries.remotive[0].search, 'AI Engineer');
});

test('planner preserves the OpenRouter error when planning fails', async () => {
  await assert.rejects(
    () => createSearchPlan({ profile: { targetRoles: ['AI engineer'] }, openRouter: async () => ({ ok: false, error: 'OpenRouter request failed (401).' }) }),
    /AI search planning failed.*OpenRouter request failed \(401\)/,
  );
});

test('planner retries once after truncated JSON and accepts the repaired plan', async () => {
  let calls = 0;
  const adzuna = ['AI Engineer', 'Applied AI Engineer', 'AI Implementation Engineer', 'Solutions Engineer AI', 'AI Platform Engineer'].map((what) => ({ what }));
  const valid = { searchBrief: { jobFamilies: ['AI Engineer'] }, providerQueries: {
    usajobs: [{ type: 'position-title', positionTitle: 'Computer Scientist' }],
    adzuna,
    remotive: [{ search: 'AI Engineer' }],
    dice: [{ keyword: 'AI Engineer' }],
    dice: [{ keyword: 'AI Engineer' }],
  } };
  const plan = await createSearchPlan({ profile: { targetRoles: ['AI Engineer'] }, openRouter: async () => {
    calls += 1;
    return calls === 1
      ? { ok: true, message: { content: '{"searchBrief":{"jobFamilies":["AI Engineer"]}' }, finishReason: 'length' }
      : { ok: true, message: { content: JSON.stringify(valid) } };
  } });
  assert.equal(calls, 2);
  assert.equal(plan.source, 'ai');
  assert.equal(plan.providerQueries.adzuna[0].what, 'AI Engineer');
});

test('planner rejects an incomplete response after one repair attempt', async () => {
  let calls = 0;
  await assert.rejects(
    () => createSearchPlan({ profile: { targetRoles: ['AI Engineer'] }, openRouter: async () => { calls += 1; return { ok: true, message: { content: '{"searchBrief":' } }; } }),
    /AI search planning failed.*not valid planner JSON/i,
  );
  assert.equal(calls, 2);
});

test('planner extracts JSON when braces appear inside quoted strings', () => {
  const plan = parseSearchBriefResponse({ ok: true, message: { content: `prefix ${JSON.stringify({ searchBrief: { jobFamilies: ['AI Engineer'], interpretation: 'Build {safe} systems' }, providerQueries: {
    usajobs: [{ positionTitle: 'Computer Scientist' }], adzuna: [{ what: 'AI Engineer' }], remotive: [{ search: 'AI Engineer' }], dice: [{ keyword: 'AI Engineer' }],
  } })} suffix` } }, { targetRoles: ['AI Engineer'] });
  assert.equal(plan.interpretation, 'Build {safe} systems');
});

test('planner expands FDE into Forward Deployed Engineer before generating lanes', () => {
  const brief = fallbackPlan({ targetRoles: ['FDE'], interests: ['artificial intelligence'] }, {});
  assert.ok(brief.jobFamilies.some((value) => /Forward Deployed Engineer/i.test(value)));
});

test('AI query refinement receives retrieval feedback and returns a provider-valid next query', async () => {
  let payload;
  const lane = await refineProviderQuery({ provider: 'remotive', brief: { jobFamilies: ['Forward Deployed Engineer'] }, profile: { targetRoles: ['Forward Deployed Engineer'] }, resume: { rawText: 'Python, deployment, customer-facing systems.' }, attemptedLanes: [{ laneId: 'first', search: 'Forward Deployed Engineer' }], outcome: { rawRetrieved: 20, newlyQualified: 0, qualifiedCount: 0, requestCount: 1 }, openRouter: async (messages) => { payload = JSON.parse(messages[1].content); return { ok: true, message: { content: JSON.stringify({ providerQuery: { search: 'deployment engineer python' } }) } }; } });
  assert.equal(lane.search, 'deployment engineer python');
  assert.equal(payload.lastOutcome.newlyQualified, 0);
  assert.match(payload.resume.rawText, /Python/);
  assert.equal(payload.attemptedQueries[0].query, 'Forward Deployed Engineer');
});
