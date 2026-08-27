const MAX_FINAL_CANDIDATES = 80;
// Keep a broad comparison set, but return the same 20 results promised by the
// UI. This avoids serial AI batches and keeps the JSON response quick to emit.
const MAX_SELECTED = 20;
const FINAL_SELECTION_MAX_TOKENS = 20_000;
const MIN_AI_FIT_SCORE = 70;
// Full-candidate assessments can legitimately take longer than the previous
// top-only response. Leave enough room for the provider to finish its JSON.
const RANKING_CALL_TIMEOUT_MS = 95_000;
const MAX_RANKING_PROMPT_CHARS = 120_000;
const MAX_PROFILE_LIST_ITEMS = 12;
const MAX_PROFILE_VALUE_CHARS = 160;
// Resume evidence is the user's requested candidate-fit signal. Keep the full
// practical resume text available instead of truncating it before the evaluator
// can compare the candidate to the listing.
const MAX_RESUME_CHARS = 10_000;
const PROVIDERS = ['usajobs', 'adzuna', 'remotive', 'dice'];

const text = (value, max) => String(value ?? '').trim().slice(0, max);
const list = (value, maxItems = MAX_PROFILE_LIST_ITEMS, maxChars = MAX_PROFILE_VALUE_CHARS) => (Array.isArray(value) ? value : []).map((entry) => text(entry, maxChars)).filter(Boolean).slice(0, maxItems);
function profileForRanking(profile = {}) {
  return {
    targetRoles: list(profile.targetRoles),
    targetLocations: list(profile.targetLocations),
    radiusMiles: 100,
  };
}
function resumeForRanking(resume = {}) { return { rawText: text(resume.rawText, MAX_RESUME_CHARS), professionalSummary: text(resume.professionalSummary, 800), skills: list(resume.skills, 20), certifications: list(resume.certifications, 12) }; }
// Allowlist only candidate fields needed for comparison. Provider payloads,
// credentials, request diagnostics, and raw API responses never enter this prompt.
function jobForRanking(job = {}) {
  return {
    externalId: text(job.externalId, 200),
    title: text(job.title, 240),
    location: text(job.location, 180),
    remoteType: text(job.remoteType, 40),
    description: text(job.description, 700),
    duties: text(job.duties, 400),
    qualifications: text(job.qualifications, 400),
    requirements: Array.isArray(job.requirements) ? job.requirements.map((entry) => text(entry, 180)).filter(Boolean).slice(0, 4) : [],
  };
}
function assertPromptSize(messages) { const characters = messages.reduce((total, message) => total + String(message.content || '').length, 0); if (characters > MAX_RANKING_PROMPT_CHARS) { const error = new Error(`Final selection prompt exceeded the ${MAX_RANKING_PROMPT_CHARS.toLocaleString()} character safety limit.`); error.code = 'selection_prompt_too_large'; throw error; } return messages; }
function selectionMessages(profile, resume, jobs) {
  const target = `Assess every supplied candidate, including jobs that fail the approval threshold. Return exactly one assessment per candidate; the application will keep the highest-ranked passing assessments (up to ${MAX_SELECTED}) for Top Jobs and place every assessment in the Advanced Search Report.`;
  return assertPromptSize([{ role: 'system', content: `You are the final job-search evaluator. Return JSON only in exactly this shape: {"assessments":[{"externalId":"provider-id","requirementsMatchScore":0,"candidateMatchScore":0,"approval":"pass|fail","fitTier":"strong match|good match|possible match","strengths":["specific evidence"],"gaps":["specific limitation"],"reasoning":"brief evidence-based comparison"}]}. ${target} Evaluate every supplied candidate before deciding. Return assessments in the same order as the supplied candidates. approval must be pass if and only if both AI scores are at least ${MIN_AI_FIT_SCORE}; otherwise it must be fail. Use only these four decision factors: (1) the supplied resume and experience, (2) the stated target role or a genuinely adjacent role whose duties materially overlap, (3) whether the listing is remote, and (4) whether a non-remote listing is within 100 miles of any supplied target location. Remote listings satisfy the location factor. If a non-remote listing has no usable location or its distance cannot be established, treat that location factor as weak. Do not consider salary, industry, interests, profile skills as separate filters, company, provider, job board, posting date, work authorization, security clearance, exclusions, or deterministic retrieval scores. Do not infer an adjacent role from any excluded factor. requirementsMatchScore measures only role/adjacent-role fit plus the remote-or-within-100-miles location rule. candidateMatchScore measures only resume and experience fit to the listing's duties and qualifications. Do not combine the scores. Select only supplied externalIds, never invent or repeat IDs. Use exactly one strength and one gap, each under 90 characters, and a reasoning under 160 characters. Finish the complete JSON object; never add markdown or commentary.` }, { role: 'user', content: JSON.stringify({ profile: profileForRanking(profile), resume: resumeForRanking(resume), candidates: jobs.map(jobForRanking) }) }]);
}
function selectionPayload(content) {
  if (typeof content !== 'string' || !content.trim()) { const error = new Error('Final AI selection returned an empty response body.'); error.code = 'selection_empty_response'; throw error; }
  let parsed; try { parsed = JSON.parse(content); } catch { const error = new Error('Final AI selection returned malformed JSON.'); error.code = 'selection_invalid_json'; throw error; }
  const entries = Array.isArray(parsed?.assessments) ? parsed.assessments : (Array.isArray(parsed?.selections) ? parsed.selections : null);
  return { parsed, entries };
}
function selectionIds(content, candidates) {
  const { parsed, entries } = selectionPayload(String(content || ''));
  const ids = entries ? entries.map((entry) => entry?.externalId) : parsed?.selectedExternalIds;
  if (!Array.isArray(ids)) { const error = new Error('Final AI selection did not include selectedExternalIds.'); error.code = 'selection_invalid_shape'; throw error; }
  if (ids.length > MAX_SELECTED && !entries) { const error = new Error(`Final AI selection returned more than ${MAX_SELECTED} jobs.`); error.code = 'selection_over_limit'; throw error; }
  const valid = new Set(candidates.map((job) => String(job.externalId)));
  const normalized = ids.map((id) => String(id));
  if (new Set(normalized).size !== normalized.length) { const error = new Error('Final AI selection included duplicate IDs.'); error.code = 'selection_duplicate_ids'; throw error; }
  if (normalized.some((id) => !valid.has(id))) { const error = new Error('Final AI selection included an ID not submitted for selection.'); error.code = 'selection_invented_id'; throw error; }
  return normalized;
}
function selectionDetails(content, candidates) {
  let entries; try { entries = selectionPayload(String(content || '')).entries || []; } catch { return new Map(); }
  const valid = new Set(candidates.map((job) => String(job.externalId)));
  return new Map(entries.filter((entry) => valid.has(String(entry?.externalId))).map((entry) => {
    const requirementsMatchScore = Number(entry.requirementsMatchScore ?? entry.fitScore);
    const candidateMatchScore = Number(entry.candidateMatchScore ?? entry.fitScore);
    const approvalStatus = Number.isFinite(requirementsMatchScore) && Number.isFinite(candidateMatchScore) && requirementsMatchScore >= MIN_AI_FIT_SCORE && candidateMatchScore >= MIN_AI_FIT_SCORE ? 'pass' : 'fail';
    return [String(entry.externalId), {
      requirementsMatchScore: Number.isFinite(requirementsMatchScore) ? Math.max(0, Math.min(100, Math.round(requirementsMatchScore))) : null,
      candidateMatchScore: Number.isFinite(candidateMatchScore) ? Math.max(0, Math.min(100, Math.round(candidateMatchScore))) : null,
      modelApproval: entry.approval === 'pass' ? 'pass' : entry.approval === 'fail' ? 'fail' : null,
      approvalStatus,
      fitTier: text(entry.fitTier, 60) || 'AI-evaluated match',
      strengths: list(entry.strengths, 5, 220), gaps: list(entry.gaps, 5, 220), unknowns: list(entry.unknowns, 5, 220),
      reasoning: text(entry.reasoning, 700) || 'Selected by the final AI comparison from the supplied listing evidence.',
    }];
  }));
}
function assertSelectionAssessments(content, ids) {
  if (!ids.length) return;
  let entries; try { entries = selectionPayload(String(content || '')).entries || []; } catch { return; }
  const byId = new Map(entries.map((entry) => [String(entry?.externalId), entry]));
  for (const id of ids) {
    const entry = byId.get(id);
    const requirementsMatchScore = Number(entry?.requirementsMatchScore ?? entry?.fitScore);
    const candidateMatchScore = Number(entry?.candidateMatchScore ?? entry?.fitScore);
    // A list of IDs without score/evidence looks valid at the JSON level, but
    // cannot be safely presented as an AI assessment. Repair it instead of
    // silently converting it into an empty selection and triggering fallback.
    if (!entry || !Number.isFinite(requirementsMatchScore) || !Number.isFinite(candidateMatchScore) || requirementsMatchScore < MIN_AI_FIT_SCORE || requirementsMatchScore > 100 || candidateMatchScore < MIN_AI_FIT_SCORE || candidateMatchScore > 100 || !text(entry.fitTier, 60) || !Array.isArray(entry.strengths) || !Array.isArray(entry.gaps) || !text(entry.reasoning, 700)) {
      const error = new Error('Final AI selection omitted a required scored assessment.'); error.code = 'selection_invalid_assessment'; throw error;
    }
  }
}
function assertAllCandidateAssessments(content, candidates) {
  const { entries } = selectionPayload(String(content || ''));
  if (!Array.isArray(entries) || entries.length !== candidates.length) { const error = new Error(`Final AI selection returned ${Array.isArray(entries) ? entries.length : 0} assessments for ${candidates.length} submitted candidates.`); error.code = 'selection_incomplete_response'; throw error; }
  const expected = new Set(candidates.map((job) => String(job.externalId)));
  const seen = new Set();
  for (const entry of entries) {
    const externalId = String(entry?.externalId || '');
    if (!expected.has(externalId)) { const error = new Error('Final AI selection included an ID not submitted for selection.'); error.code = 'selection_invented_id'; throw error; }
    if (seen.has(externalId)) { const error = new Error('Final AI selection included duplicate IDs.'); error.code = 'selection_duplicate_ids'; throw error; }
    seen.add(externalId);
    const requirementsMatchScore = Number(entry?.requirementsMatchScore ?? entry?.fitScore);
    const candidateMatchScore = Number(entry?.candidateMatchScore ?? entry?.fitScore);
    if (!Number.isFinite(requirementsMatchScore) || !Number.isFinite(candidateMatchScore) || requirementsMatchScore < 0 || requirementsMatchScore > 100 || candidateMatchScore < 0 || candidateMatchScore > 100 || !['pass', 'fail'].includes(entry?.approval) || !text(entry.fitTier, 60) || !Array.isArray(entry.strengths) || !Array.isArray(entry.gaps) || !text(entry.reasoning, 700)) {
      const error = new Error('Final AI selection omitted a required scored assessment.'); error.code = 'selection_invalid_assessment'; throw error;
    }
  }
}
function repairMessages(content, candidates) {
  return assertPromptSize([{ role: 'system', content: `Repair the supplied final job-selection response. Return JSON only with {"assessments":[...]}. Return exactly one assessment for every supplied candidate, including failures. Keep each supplied externalId exactly once. Every assessment requires externalId, requirementsMatchScore (0-100), candidateMatchScore (0-100), approval (pass or fail), fitTier, strengths, gaps, and reasoning. approval must be pass if and only if both AI scores are at least ${MIN_AI_FIT_SCORE}. Use exactly one strength and one gap, each under 90 characters, and a reasoning under 160 characters. Finish the complete JSON object and do not add commentary.` }, { role: 'user', content: JSON.stringify({ invalidResponse: text(content, 12000), candidates: candidates.map(jobForRanking) }) }]);
}
function providerCounts(candidates, assessed = [], selected = []) { return Object.fromEntries(PROVIDERS.map((provider) => [provider, { submitted: candidates.filter((job) => job.providerKey === provider).length, assessed: assessed.filter((entry) => entry.job?.providerKey === provider).length, returned: selected.filter((entry) => entry.job?.providerKey === provider).length, aiReturned: assessed.filter((entry) => entry.job?.providerKey === provider).length, passed: selected.filter((entry) => entry.job?.providerKey === provider).length, failed: assessed.filter((entry) => entry.job?.providerKey === provider && entry.approvalStatus === 'fail').length }])); }
function settleWithin(promise, timeoutMs) { let timer; const timeout = new Promise((_, reject) => { timer = setTimeout(() => { const error = new Error('Final AI selection did not settle before the local timeout. Deterministic candidates will be shown instead.'); error.code = 'selection_timeout'; reject(error); }, timeoutMs); }); return Promise.race([Promise.resolve().then(() => promise), timeout]).finally(() => clearTimeout(timer)); }
function assessedSelections(content, candidates) {
  assertAllCandidateAssessments(content, candidates);
  const details = selectionDetails(content, candidates);
  const byId = new Map(candidates.map((job) => [String(job.externalId), job]));
  return candidates.map((candidate) => {
    const id = String(candidate.externalId);
    const job = byId.get(id);
    const assessment = details.get(id) || {};
    return { job, externalId: id, ...assessment, fitScore: Number.isFinite(Number(assessment.requirementsMatchScore)) && Number.isFinite(Number(assessment.candidateMatchScore)) ? Math.min(assessment.requirementsMatchScore, assessment.candidateMatchScore) : null, scoreType: 'ai-selection', fitTier: assessment.fitTier || 'AI-evaluated match', strengths: assessment.strengths || [], gaps: assessment.gaps || [], unknowns: assessment.unknowns || [], reasoning: assessment.reasoning || 'Evaluated by the final AI comparison from the supplied listing evidence.' };
  });
}
function compareAssessments(left, right) {
  // Rank balanced fit first: a strong score in one dimension must not hide a
  // weak score in the other. This makes card order match the AI contract.
  const leftMinimum = Math.min(left.requirementsMatchScore, left.candidateMatchScore);
  const rightMinimum = Math.min(right.requirementsMatchScore, right.candidateMatchScore);
  if (rightMinimum !== leftMinimum) return rightMinimum - leftMinimum;
  const leftAverage = (left.requirementsMatchScore + left.candidateMatchScore) / 2;
  const rightAverage = (right.requirementsMatchScore + right.candidateMatchScore) / 2;
  if (rightAverage !== leftAverage) return rightAverage - leftAverage;
  return String(left.externalId).localeCompare(String(right.externalId));
}
async function rankJobs({ jobs, profile, resume, openRouter, onBatch, rankingCallTimeoutMs = RANKING_CALL_TIMEOUT_MS }) {
  const candidates = (Array.isArray(jobs) ? jobs : []).slice(0, MAX_FINAL_CANDIDATES);
  if (!candidates.length) return [];
  if (typeof openRouter !== 'function') throw new Error('Final AI job selection is unavailable.');
  const messages = selectionMessages(profile, resume, candidates);
  const promptCharacters = messages.reduce((sum, message) => sum + String(message.content || '').length, 0);
  const started = Date.now(); const diagnostics = { submittedCount: candidates.length, candidateCount: candidates.length, batchCount: 1, totalCalls: 1, assessedCount: 0, returnedCount: 0, selectionCallCount: 1, repairAttempted: false, providerCounts: providerCounts(candidates), promptCharacters, maxTokens: FINAL_SELECTION_MAX_TOKENS, durationMs: 0 };
  try {
    await onBatch?.({ ...diagnostics, batchNumber: 1, callNumber: 1, status: 'started' });
    let response = await settleWithin(openRouter(messages, { max_tokens: FINAL_SELECTION_MAX_TOKENS, response_format: { type: 'json_object' } }), rankingCallTimeoutMs);
    if (!response?.ok) { const error = new Error(response?.error || 'Final AI selection request failed.'); error.code = response?.code || 'selection_request_failed'; throw error; }
    let content = response.message?.content;
    let assessments;
    try { assessments = assessedSelections(content, candidates); }
    catch (initialError) {
      // A single compact repair is safe for malformed or truncated JSON. A
      // transport failure is not retried because it is not repairable here.
      if (!['selection_invalid_json', 'selection_invalid_shape', 'selection_duplicate_ids', 'selection_invented_id', 'selection_over_limit', 'selection_invalid_assessment', 'selection_incomplete_response'].includes(initialError.code)) throw initialError;
      diagnostics.repairAttempted = true;
      diagnostics.selectionCallCount = 2;
      await onBatch?.({ ...diagnostics, batchNumber: 1, callNumber: 1, status: 'started', repairAttempted: true });
      response = await settleWithin(openRouter(repairMessages(content, candidates), { max_tokens: FINAL_SELECTION_MAX_TOKENS, response_format: { type: 'json_object' } }), rankingCallTimeoutMs);
      if (!response?.ok) { const error = new Error(response?.error || 'Final AI selection repair request failed.'); error.code = response?.code || 'selection_repair_failed'; throw error; }
      content = response.message?.content;
      assessments = assessedSelections(content, candidates);
    }
    const allAssessments = assessments.slice().sort(compareAssessments);
    const selected = allAssessments.filter((entry) => entry.approvalStatus === 'pass').slice(0, MAX_SELECTED);
    diagnostics.assessedCount = candidates.length;
    diagnostics.returnedCount = selected.length;
    diagnostics.aiReturnedCount = allAssessments.length;
    diagnostics.passedCount = selected.length;
    diagnostics.failedCount = allAssessments.length - selected.length;
    diagnostics.finalSelectedCount = selected.length;
    diagnostics.displayedCount = selected.length;
    diagnostics.underSelected = false;
    diagnostics.providerCounts = providerCounts(candidates, allAssessments, selected);
    diagnostics.durationMs = Date.now() - started;
    await onBatch?.({ ...diagnostics, batchNumber: 1, callNumber: 1, status: 'success', responseLength: String(content || '').length, finishedAt: new Date().toISOString() });
    Object.defineProperty(selected, 'rankingDiagnostics', { value: diagnostics, enumerable: false });
    Object.defineProperty(selected, 'allAssessments', { value: allAssessments, enumerable: false });
    return selected;
  } catch (cause) {
    // A failed final evaluation is not an AI selection. Reporting partial
    // counts would falsely imply every job was judged.
    diagnostics.assessedCount = 0;
    diagnostics.returnedCount = 0;
    diagnostics.finalSelectedCount = 0;
    diagnostics.displayedCount = 0;
    diagnostics.providerCounts = providerCounts(candidates);
    diagnostics.durationMs = Date.now() - started;
    cause.rankingDiagnostics = diagnostics;
    await onBatch?.({ ...diagnostics, batchNumber: 1, callNumber: 1, status: 'failed', errorCode: cause.code || 'selection_failed', errorMessage: cause.message, finishedAt: new Date().toISOString() });
    throw cause;
  }
}
module.exports = { rankJobs, RANKING_CALL_TIMEOUT_MS, MAX_FINAL_CANDIDATES, MAX_SELECTED, FINAL_SELECTION_MAX_TOKENS, MIN_AI_FIT_SCORE, jobForRanking, profileForRanking, resumeForRanking, selectionMessages, selectionIds, repairMessages, MAX_RANKING_PROMPT_CHARS };
