const assert = require('node:assert/strict');
const test = require('node:test');
const { rankJobs, MAX_FINAL_CANDIDATES, MAX_SELECTED, FINAL_SELECTION_MAX_TOKENS, jobForRanking, selectionMessages, selectionIds } = require('../electron/job-matcher.cjs');

const jobs = (count, providerKey = 'usajobs') => Array.from({ length: count }, (_, index) => ({ externalId: `${providerKey}-${index + 1}`, providerKey, title: 'Machine Learning Engineer', description: 'machine learning python', retrievalScore: 90 - index, diagnostics: { secret: 'do not send' } }));
const response = (ids, fitScore = 80, allIds = ids) => ({ ok: true, message: { content: JSON.stringify({ assessments: allIds.map((externalId) => { const score = ids.includes(externalId) ? fitScore : 60; return { externalId, requirementsMatchScore: score, candidateMatchScore: score, approval: score >= 70 ? 'pass' : 'fail', fitTier: score >= 70 ? 'good match' : 'possible match', strengths: ['Relevant experience'], gaps: ['Review the listing'], unknowns: [], reasoning: 'Evidence-based fit.' }; }) }) } });
const responseForSubmittedIds = (messages, ids, fitScore = 80) => {
  const payload = JSON.parse(messages[1].content);
  const submitted = new Set((payload.candidates || []).map((job) => job.externalId));
  return response(ids.filter((id) => submitted.has(id)), fitScore, [...submitted]);
};

test('final selector receives at most 80 deterministic candidates and may select any provider mix', async () => {
  const candidates = [...jobs(30, 'usajobs'), ...jobs(30, 'adzuna'), ...jobs(30, 'remotive')]; const prompts = [];
  const selected = await rankJobs({ jobs: candidates, profile: {}, resume: {}, openRouter: async (messages) => { prompts.push(JSON.parse(messages[1].content)); return responseForSubmittedIds(messages, ['adzuna-1', 'adzuna-2', 'adzuna-3']); } });
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].candidates.length, MAX_FINAL_CANDIDATES);
  assert.deepEqual(selected.slice(0, 3).map((entry) => entry.externalId), ['adzuna-1', 'adzuna-2', 'adzuna-3']);
  assert.equal(selected.length, 3);
  assert.equal(selected.allAssessments.length, MAX_FINAL_CANDIDATES);
  assert.equal(selected.allAssessments.filter((entry) => entry.approvalStatus === 'fail').length, MAX_FINAL_CANDIDATES - 3);
  assert.equal(selected.filter((entry) => entry.scoreType === 'deterministic-backfill').length, 0);
  assert.equal(selected[0].scoreType, 'ai-selection');
  assert.equal(selected.rankingDiagnostics.returnedCount, 3);
});

test('final selector allows an under-selection when fewer than 80 strong matches exist', async () => {
  const selected = await rankJobs({ jobs: jobs(80), profile: {}, resume: {}, openRouter: async (messages) => responseForSubmittedIds(messages, ['usajobs-1', 'usajobs-2', 'usajobs-3']) });
  assert.equal(selected.rankingDiagnostics.underSelected, false);
  assert.equal(selected.rankingDiagnostics.returnedCount, 3);
});

test('final selector displays only the high-quality IDs returned by AI', async () => {
  const selected = await rankJobs({ jobs: jobs(5), profile: {}, resume: {}, openRouter: async () => response(['usajobs-1', 'usajobs-2'], 80, jobs(5).map((job) => job.externalId)) });
  assert.equal(selected.length, 2);
  assert.equal(selected.filter((entry) => entry.scoreType === 'deterministic-backfill').length, 0);
  assert.equal(selected.rankingDiagnostics.returnedCount, 2);
});

test('final selector orders results by the highest balanced AI scores', async () => {
  const selected = await rankJobs({ jobs: jobs(3), profile: {}, resume: {}, openRouter: async () => ({ ok: true, message: { content: JSON.stringify({ selections: [
     { externalId: 'usajobs-1', requirementsMatchScore: 95, candidateMatchScore: 70, approval: 'pass', fitTier: 'good match', strengths: ['Relevant experience'], gaps: ['Location'], reasoning: 'Evidence-based fit.' },
     { externalId: 'usajobs-2', requirementsMatchScore: 85, candidateMatchScore: 85, approval: 'pass', fitTier: 'strong match', strengths: ['Relevant experience'], gaps: ['Salary'], reasoning: 'Evidence-based fit.' },
     { externalId: 'usajobs-3', requirementsMatchScore: 91, candidateMatchScore: 80, approval: 'pass', fitTier: 'good match', strengths: ['Relevant experience'], gaps: ['Seniority'], reasoning: 'Evidence-based fit.' },
  ] }) } }) });
  assert.deepEqual(selected.map((entry) => entry.externalId), ['usajobs-2', 'usajobs-3', 'usajobs-1']);
});

test('final selector prompt requires the top 20 balanced scores', () => {
  const prompt = selectionMessages({}, {}, jobs(40))[0].content;
  assert.match(prompt, /Evaluate every supplied candidate/);
  assert.match(prompt, /highest-ranked passing assessments/);
  assert.match(prompt, /up to 20/);
});

test('final selector is limited to resume, role adjacency, and remote or 100-mile location evidence', () => {
  const candidate = {
    ...jobs(1, 'dice')[0],
    company: 'Ignored employer context',
    salaryMin: 200000,
    clearanceRequired: 'Top Secret',
    retrievalScore: 99,
  };
  const messages = selectionMessages({
    targetRoles: ['Forward Deployed Engineer'],
    targetLocations: ['Ardmore, OK'],
    targetIndustries: ['ignored industry'],
    mustHaveSkills: ['ignored profile filter'],
    excludedKeywords: ['ignored exclusion'],
    minimumSalary: 200000,
    workAuthorization: 'ignored authorization',
  }, { rawText: 'Resume evidence', skills: ['Python'] }, [candidate]);
  const prompt = JSON.parse(messages[1].content);
  const projectedCandidate = prompt.candidates[0];
  assert.deepEqual(prompt.profile, { targetRoles: ['Forward Deployed Engineer'], targetLocations: ['Ardmore, OK'], radiusMiles: 100 });
  assert.equal('company' in projectedCandidate, false);
  assert.equal('providerKey' in projectedCandidate, false);
  assert.equal('salaryMin' in projectedCandidate, false);
  assert.equal('clearanceRequired' in projectedCandidate, false);
  assert.equal('deterministicScore' in projectedCandidate, false);
  assert.match(messages[0].content, /genuinely adjacent role/);
  assert.match(messages[0].content, /within 100 miles/);
  assert.match(messages[0].content, /Do not consider salary, industry, interests/);
  assert.match(messages[0].content, /company, provider, job board/);
  assert.match(messages[0].content, /work authorization, security clearance, exclusions/);
  assert.match(messages[0].content, /deterministic retrieval scores/);
  assert.match(messages[0].content, /exactly one assessment per candidate/);
  assert.match(messages[0].content, /approval must be pass if and only if/);
});

test('final selector rejects invented, duplicate, malformed, and over-limit IDs', () => {
  const candidates = jobs(81);
  assert.throws(() => selectionIds('{', candidates), { code: 'selection_invalid_json' });
  assert.throws(() => selectionIds(JSON.stringify({ selectedExternalIds: ['missing'] }), candidates), { code: 'selection_invented_id' });
  assert.throws(() => selectionIds(JSON.stringify({ selectedExternalIds: ['usajobs-1', 'usajobs-1'] }), candidates), { code: 'selection_duplicate_ids' });
  assert.throws(() => selectionIds(JSON.stringify({ selectedExternalIds: candidates.map((job) => job.externalId) }), candidates), { code: 'selection_over_limit' });
});

test('final selector failure preserves structured diagnostics for deterministic fallback', async () => {
  await assert.rejects(() => rankJobs({ jobs: jobs(2), profile: {}, resume: {}, openRouter: async () => ({ ok: true, message: { content: '{}' } }) }), (error) => error.code === 'selection_incomplete_response' && error.rankingDiagnostics.submittedCount === 2 && error.rankingDiagnostics.assessedCount === 0 && error.rankingDiagnostics.providerCounts.usajobs.assessed === 0);
});

test('final selector repairs one malformed response and preserves AI score provenance', async () => {
  let calls = 0;
  const selected = await rankJobs({ jobs: jobs(2), profile: {}, resume: {}, openRouter: async () => {
    calls += 1;
    return calls === 1
      ? { ok: true, message: { content: '{' } }
       : response(['usajobs-1'], 83, ['usajobs-1', 'usajobs-2']);
  } });
  assert.equal(calls, 2);
  assert.equal(selected[0].scoreType, 'ai-selection');
  assert.equal(selected[0].fitScore, 83);
  assert.equal(selected.rankingDiagnostics.repairAttempted, true);
  assert.equal(selected.rankingDiagnostics.totalCalls, 1);
  assert.equal(selected.rankingDiagnostics.selectionCallCount, 2);
});

test('an empty successful body is not repaired or accepted as zero selections', async () => {
  let calls = 0;
  await assert.rejects(() => rankJobs({ jobs: jobs(2), profile: {}, resume: {}, openRouter: async () => { calls += 1; return { ok: true, message: { content: '' } }; } }), (error) => error.code === 'selection_empty_response' && error.rankingDiagnostics.assessedCount === 0);
  assert.equal(calls, 1);
});

test('an OpenRouter transport failure is not sent through the selection repair path', async () => {
  let calls = 0;
  await assert.rejects(() => rankJobs({ jobs: jobs(2), profile: {}, resume: {}, openRouter: async () => { calls += 1; return { ok: false, code: 'openrouter_invalid_response_body', error: 'Unreadable body.' }; } }), (error) => error.code === 'openrouter_invalid_response_body' && error.rankingDiagnostics.repairAttempted === false);
  assert.equal(calls, 1);
});

test('final selector repairs an ID-only response instead of treating it as no qualifying AI match', async () => {
  let calls = 0;
  const selected = await rankJobs({ jobs: jobs(2), profile: {}, resume: {}, openRouter: async () => {
    calls += 1;
    return calls === 1
      ? { ok: true, message: { content: JSON.stringify({ selectedExternalIds: ['usajobs-1'] }) } }
       : response(['usajobs-1'], 86, ['usajobs-1', 'usajobs-2']);
  } });
  assert.equal(calls, 2);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].fitScore, 86);
  assert.equal(selected.rankingDiagnostics.repairAttempted, true);
});

test('AI projection is bounded and excludes provider diagnostics', () => {
  const projected = jobForRanking(jobs(1)[0]);
  assert.equal('diagnostics' in projected, false);
  assert.equal('providerKey' in projected, false);
  assert.equal('deterministicScore' in projected, false);
});

test('final selector consumes scored assessments and keeps provider representation', async () => {
  const candidates = [...jobs(5, 'usajobs'), ...jobs(5, 'adzuna'), ...jobs(5, 'remotive'), ...jobs(5, 'dice')];
  const prompts = [];
  const selected = await rankJobs({ jobs: candidates, profile: {}, resume: {}, openRouter: async (messages) => {
    const prompt = JSON.parse(messages[1].content); prompts.push(prompt);
     return response(['adzuna-1'], 88, prompt.candidates.map((candidate) => candidate.externalId));
  } });
  assert.match(prompts[0].candidates[0].externalId, /usajobs/);
  assert.deepEqual(selected[0].fitScore, 88);
  assert.equal(selected[0].scoreType, 'ai-selection');
  assert.deepEqual(selected[0].strengths, ['Relevant experience']);
  assert.equal(selected.filter((entry) => entry.job.providerKey === 'usajobs').length, 0);
  assert.equal(selected.filter((entry) => entry.job.providerKey === 'adzuna').length, 1);
  assert.equal(selected.rankingDiagnostics.finalSelectedCount, 1);
});

test('final selector accounts for Dice and preserves zero-selection diagnostics', async () => {
  const candidates = [...jobs(2, 'dice'), ...jobs(1, 'remotive')];
  const selected = await rankJobs({ jobs: candidates, profile: {}, resume: {}, openRouter: async () => response([], 80, candidates.map((job) => job.externalId)) });
  assert.equal(selected.length, 0);
  assert.equal(selected.allAssessments.length, candidates.length);
  assert.equal(selected.rankingDiagnostics.providerCounts.dice.submitted, 2);
  assert.equal(selected.rankingDiagnostics.returnedCount, 0);
});

test('final selector makes one compact request with a 20k output ceiling', async () => {
  const calls = [];
  const selected = await rankJobs({ jobs: jobs(50), profile: {}, resume: {}, openRouter: async (messages, options) => {
    const payload = JSON.parse(messages[1].content);
    calls.push({ count: payload.candidates.length, maxTokens: options.max_tokens });
     return response(payload.candidates.slice(0, MAX_SELECTED).map((job) => job.externalId), 80, payload.candidates.map((job) => job.externalId));
  } });
  assert.deepEqual(calls, [{ count: 50, maxTokens: FINAL_SELECTION_MAX_TOKENS }]);
  assert.equal(selected.length, MAX_SELECTED);
  assert.equal(selected.rankingDiagnostics.assessedCount, 50);
});
