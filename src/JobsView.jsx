import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BriefcaseBusiness, Check, ExternalLink, FileText, LoaderCircle, Mail, MessageCircle, Mic, Pause, Pencil, Play, Plus, Search, Sparkles, Square, Trash2, X } from 'lucide-react';
import JobDetailsWorkspace from './jobs/JobDetailsWorkspace.jsx';
import ApplicationQueueDrawer from './jobs/ApplicationQueueDrawer.jsx';
import { scoreImportedJob } from './jobs/jobFitScoring.js';
import { appliedJobs } from './jobs/emailJobFilter.js';
import './voiceConversation.css';

export const JOB_STAGES = [['target', 'Target'], ['researching', 'Researching'], ['ready', 'Ready to apply'], ['applied', 'Applied'], ['screen', 'Recruiter screen'], ['interviewing', 'Interviewing'], ['final', 'Final round'], ['offer', 'Offer'], ['accepted', 'Accepted'], ['rejected', 'Rejected / withdrawn / archived']];
const JOB_CARD_STAGE_OPTIONS = [...JOB_STAGES, ['archived', 'Archive']];
const stageIndex = (stage) => JOB_STAGES.findIndex(([value]) => value === stage);
const PRIORITIES = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']];
const PROFILE_LIST_FIELDS = ['targetRoles', 'targetLocations', 'targetIndustries', 'interests', 'mustHaveSkills', 'niceToHaveSkills', 'excludedKeywords'];
const DEFAULT_SEARCH_PROFILE = {
  targetRoles: ['AI Automation Engineer', 'AI Implementation Engineer', 'Forward Deployed Engineer', 'Solutions Engineer (AI)', 'Technical Consultant (AI)'],
  targetLocations: [],
  targetIndustries: ['AI software', 'B2B SaaS', 'enterprise technology', 'professional services'],
  interests: ['AI agents', 'LLM applications', 'workflow automation', 'AI implementation', 'technical discovery', 'customer enablement'],
  mustHaveSkills: ['Python', 'REST APIs', 'LLM integrations', 'cloud deployment', 'workflow automation'],
  niceToHaveSkills: ['prompt engineering', 'RAG', 'Docker', 'JavaScript or TypeScript', 'technical consulting'],
  excludedKeywords: ['aviation', 'aircraft', 'airworthiness', 'avionics', 'pilot'],
  remotePreference: 'any', minimumSalary: null, radiusMiles: null,
};

const emptyJob = () => ({ id: '', company: '', roleTitle: '', url: '', location: '', employmentType: '', salaryRange: '', source: '', stage: 'target', priority: 'medium', nextAction: '', followUpDate: '', contactName: '', contactEmail: '', notes: '', appliedAt: null });
const newPipelineJobId = () => `job-manual-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
const emptySourceForm = () => ({ usajobsEmail: '', usajobsApiKey: '', adzunaAppId: '', adzunaApiKey: '' });
const emptyEmailForm = () => ({ email: '', accessToken: '', refreshToken: '' });
const savedCredentialPlaceholder = '••••••••••••';
const label = (type) => type === 'resume' ? 'Resume' : 'Cover letter';
const asList = (value) => (Array.isArray(value) ? value : []).flatMap((entry) => String(entry || '').split(',')).map((entry) => entry.trim()).filter(Boolean);
const normalizeLocationList = (value) => {
  const source = Array.isArray(value) ? value : (typeof value === 'string' && value.trim() ? [value] : []);
  const merged = [];
  for (let index = 0; index < source.length; index += 1) {
    const current = String(source[index] || '').trim();
    const next = String(source[index + 1] || '').trim();
    if (current && /^[A-Za-z]{2}$/.test(next) && !current.includes(',')) { merged.push(`${current}, ${next.toUpperCase()}`); index += 1; }
    else if (current) merged.push(current);
  }
  return [...new Set(merged)];
};
const normalizeProfileLists = (value = {}) => Object.fromEntries(PROFILE_LIST_FIELDS.map((key) => [key, key === 'targetLocations' ? normalizeLocationList(value[key]) : asList(value[key])]));
// Persisted list hydration keeps controlled inputs stable: setProfile((current) => ({ ...current, ...savedProfile, ...normalizeProfileLists(savedProfile) }));
const profileValue = (value) => asList(value).join(', ');
const matchRank = (entry) => Number(entry?.fitScore ?? -1);
const displayPhoneNumber = (value) => { const digits = String(value || '').replace(/\D/g, ''); return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : String(value || '').trim(); };
const jobBoardLabel = (job) => ({ usajobs: 'usajobs.gov', adzuna: 'adzuna.com', remotive: 'remote.com', dice: 'dice.com', greenhouse: 'greenhouse.io' }[String(job?.apiSource || job?.source || '').toLowerCase()] || String(job?.source || job?.apiSource || 'manual').toLowerCase());
const mergeRankedMatches = (existing, incoming) => {
  const merged = new Map(existing.map((entry) => [String(entry.job.externalId), entry]));
  incoming.forEach((entry) => {
    const id = String(entry.job.externalId);
    if (!merged.has(id) || matchRank(entry) > matchRank(merged.get(id))) merged.set(id, entry);
  });
  return [...merged.values()].sort((left, right) => matchRank(right) - matchRank(left));
};

export const errorMessage = (cause, fallback = 'Search failed.') => {
  if (typeof cause === 'string' && cause.trim()) return cause;
  if (typeof cause?.message === 'string' && cause.message.trim()) return cause.message;
  if (typeof cause?.error?.message === 'string' && cause.error.message.trim()) return cause.error.message;
  if (typeof cause?.error === 'string' && cause.error.trim()) return cause.error;
  if (typeof cause?.code === 'string' && cause.code.trim()) return `${cause.code}: ${fallback}`;
  if (typeof cause?.error?.code === 'string' && cause.error.code.trim()) return `${cause.error.code}: ${fallback}`;
  return fallback;
};

function JobModal({ job, saving, error, onChange, onCancel, onSave }) {
  const [importUrl, setImportUrl] = useState(job.url || '');
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const field = (name, label, type = 'text') => name === 'followUpDate' && stageIndex(job.stage) < stageIndex('applied') ? null : <>{name === 'company' && !job.id && <section className="job-import-panel"><b>Import from a link</b><p>Paste a public job-listing URL to prefill available details, or complete the form manually.</p><div><input type="url" value={importUrl} onChange={(event) => setImportUrl(event.target.value)} placeholder="https://company.com/careers/job" aria-label="Job-listing URL to import" /><button className="secondary" disabled={importing} onClick={importListing}>{importing ? 'Importing…' : 'Import details'}</button></div>{importMessage && <small className="job-source-message">{importMessage}</small>}</section>}<label className="job-field"><span>{label}</span><input type={type} value={job[name] || ''} onChange={(event) => onChange({ ...job, [name]: event.target.value })} /></label>{name === 'source' && <><label className="job-field job-import-detail"><span>Job description</span><textarea rows="4" value={job.description || ''} onChange={(event) => onChange({ ...job, description: event.target.value })} /></label><label className="job-field job-import-detail"><span>Notes</span><textarea rows="3" value={job.notes || ''} onChange={(event) => onChange({ ...job, notes: event.target.value })} /></label></>}</>;
  const importListing = async () => { if (!importUrl.trim()) { setImportMessage('Paste a job-listing or Greenhouse board URL first.'); return; } setImporting(true); setImportMessage('Reading listing details…'); try { const parsed = new URL(importUrl); const isGreenhouseBoard = ['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(parsed.hostname.toLowerCase()) && !parsed.pathname.split('/').filter(Boolean).slice(1).includes('jobs'); if (isGreenhouseBoard) { const result = await window.desktopShell?.searchGreenhouseBoard?.(importUrl); if (!result?.ok) throw new Error(errorMessage(result, 'Greenhouse board search failed.')); window.dispatchEvent(new CustomEvent('greenhouse-board-results', { detail: result })); setImportMessage(`Found ${result.matches?.length || 0} ranked matches. Closing this dialog…`); return; } const imported = await window.desktopShell?.importJobFromUrl?.(importUrl); onChange({ ...job, ...imported, url: imported.url || importUrl }); setImportMessage('Details imported. Review and edit anything before saving.'); } catch (cause) { setImportMessage(cause?.message || 'Could not import that listing.'); } finally { setImporting(false); } };
  return <div className="modal" onClick={onCancel}><section className="job-modal" onClick={(event) => event.stopPropagation()}><div className="job-modal-head"><div><span className="eyebrow">JOB SEARCH PIPELINE</span><h2>{job.id ? 'Edit opportunity' : 'Add opportunity'}</h2></div><button className="close" onClick={onCancel}><X size={18} /></button></div><div className="job-form-grid">{field('company', 'Company')}{field('roleTitle', 'Role title')}{field('url', 'Job URL', 'url')}{field('location', 'Location')}{field('employmentType', 'Employment type')}{field('salaryRange', 'Salary range')}{field('source', 'Source')}{field('followUpDate', 'Follow-up date', 'date')}</div><div className="job-form-grid"><label className="job-field"><span>Stage</span><select value={job.stage} onChange={(event) => onChange({ ...job, stage: event.target.value })}>{JOB_STAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="job-field"><span>Priority</span><select value={job.priority} onChange={(event) => onChange({ ...job, priority: event.target.value })}>{PRIORITIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><label className="job-field"><span>Next action</span><input value={job.nextAction || ''} onChange={(event) => onChange({ ...job, nextAction: event.target.value })} /></label>{error && <p className="form-error">{error}</p>}<div className="job-modal-actions"><button className="secondary" onClick={onCancel}>Cancel</button><button className="primary" disabled={saving} onClick={onSave}>{saving ? 'Saving…' : 'Save opportunity'} <Check size={14} /></button></div></section></div>;
}

function AutomationAnswerModal({ entry, question, answerText, saving, error, onChange, onCancel, onSave }) {
  const displayedQuestion = question?.questionText || question?.controlLabel || 'No employer question was captured. Retry this checkpoint to capture the employer\'s actual question.';
  const blocker = entry?.automationCheckpoint?.lastError || entry?.automationCheckpoint?.lastBlockedReason || '';
  return <div className="modal" role="dialog" aria-modal="true" aria-labelledby="automation-answer-title" onClick={onCancel}><section className="automation-answer-modal" onClick={(event) => event.stopPropagation()}><div className="job-modal-head"><div><span className="eyebrow">APPLICATION CHECKPOINT</span><h2 id="automation-answer-title">{question ? `Answer needed for ${entry.company}` : 'Application checkpoint needs inspection'}</h2><p>{entry.roleTitle}</p></div><button className="close" aria-label="Close answer dialog" onClick={onCancel}><X size={18} /></button></div><div className="automation-answer-question"><b>{question ? 'Question' : 'Checkpoint status'}</b><p>{displayedQuestion}</p>{blocker && <small>{blocker}</small>}{question?.options?.length ? <small>Choices: {question.options.join(' · ')}</small> : null}</div><label className="job-field"><span>Approved reusable answer</span><input autoFocus={Boolean(question)} disabled={!question} value={answerText} onChange={(event) => onChange(event.target.value)} placeholder={question ? 'Type the answer to reuse for this question' : 'Retry to capture the employer question'} /></label><p className="automation-answer-provenance">Saved answers are reused according to the approved scope and recorded with user-answer provenance. After saving, use Retry on this job to run the checkpoint with your answer.</p>{error && <p className="form-error">{error}</p>}<div className="job-modal-actions"><button className="secondary" onClick={onCancel}>Close</button><button className="primary" disabled={saving || !question || !answerText.trim()} onClick={onSave}>{saving ? 'Saving…' : 'Save answer'} <Check size={14} /></button></div></section></div>;
}

function profileField(profile, setProfile, key, label) {
  if (key === 'targetLocations') return <LocationProfileField profile={profile} setProfile={setProfile} />;
  return <label className="job-field"><span>{label}</span><input value={profileValue(profile[key])} onChange={(event) => setProfile((current) => ({ ...current, [key]: [event.target.value] }))} onBlur={() => setProfile((current) => ({ ...current, ...normalizeProfileLists(current) }))} placeholder="Comma-separated values" /></label>;
}

function LocationProfileField({ profile, setProfile }) {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [locationSearcher, setLocationSearcher] = useState(() => () => []);
  const locations = normalizeLocationList(profile.targetLocations);
  useEffect(() => { let active = true; import('./jobs/usLocations.js').then((module) => { if (active) setLocationSearcher(() => module.searchUsLocations); }).catch(() => {}); return () => { active = false; }; }, []);
  const suggestions = useMemo(() => locationSearcher(draft), [draft, locationSearcher]);
  const addLocation = (value) => {
    const next = String(value || '').trim();
    if (!next) return;
    setProfile((current) => ({ ...current, targetLocations: [...new Set([...normalizeLocationList(current.targetLocations), next])] }));
    setDraft('');
    setOpen(false);
  };
  const removeLocation = (value) => setProfile((current) => ({ ...current, targetLocations: normalizeLocationList(current.targetLocations).filter((entry) => entry !== value) }));
  return <label className="job-field location-autocomplete-field"><span>US locations</span><div className="location-autocomplete" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}><div className="location-chips">{locations.map((location) => <span className="location-chip" key={location}>{location}<button type="button" aria-label={`Remove ${location}`} onClick={() => removeLocation(location)}>×</button></span>)}<input value={draft} onChange={(event) => { setDraft(event.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addLocation(suggestions[0]?.value || draft); } else if (event.key === 'Escape') setOpen(false); }} placeholder="Type a city, e.g. Oklahoma City" /></div>{open && draft.trim() && <div className="location-suggestions" role="listbox">{suggestions.length ? suggestions.map((suggestion) => <button type="button" role="option" key={suggestion.value} onMouseDown={(event) => event.preventDefault()} onClick={() => addLocation(suggestion.value)}><b>{suggestion.city}</b><small>{suggestion.stateName || suggestion.state}</small></button>) : <small className="location-no-results">No matching US city. Press Enter to keep the text as entered.</small>}</div>}</div><small>Choose a city so each job source receives the correct city/state format.</small></label>;
}

function MatchCard({ entry, onSave, isSaved = Boolean(entry?.savedToPipeline) }) {
  const { job, ...match } = entry;
  const sourceLabels = { usajobs: 'USAJOBS / federal jobs', adzuna: 'Adzuna', remotive: 'Remotive', dice: 'Dice', greenhouse: 'Greenhouse' };
  const evidence = job.searchEvidence || {};
  const isAiScore = match.scoreType === 'ai-selection';
  const scoreValue = (value) => value === null || value === undefined ? 'Not available' : `${value}/100`;
  const scoreRows = <ul className="job-match-scores"><li><b>Programmatic search relevance</b><span>{scoreValue(job.retrievalScore)}</span></li><li><b>AI: job matches my requirements</b><span>{scoreValue(match.requirementsMatchScore)}</span></li><li><b>AI: I match the job</b><span>{scoreValue(match.candidateMatchScore)}</span></li></ul>;
  const scoreLabel = scoreRows;
  const fitScore = match.fitScore === null || match.fitScore === undefined ? '—' : match.fitScore;
  const sourceLabel = sourceLabels[job.providerKey] || job.providerKey || 'Unknown source';
  const salary = (job.salaryMin || job.salaryMax) ? `$${Number(job.salaryMin || 0).toLocaleString()}${job.salaryMax ? `–$${Number(job.salaryMax).toLocaleString()}` : '+'}${job.salaryInterval && job.salaryInterval !== 'unknown' ? `/${job.salaryInterval}` : ''}` : 'Not listed';
  const sourceSignal = evidence.positionTitleQuery || evidence.keywordQuery || evidence.query || evidence.laneId || 'Provider query not recorded';
  return <article className={`job-match-card ${isAiScore ? 'ai-scored' : 'retrieval-scored'}`}><div className="job-match-head"><div><b>{job.title}</b><small><span className="job-source-badge">{sourceLabel}</span> · {job.agency || job.company} · {job.location || 'Location not listed'} · {job.remoteType || 'unknown'}</small></div><strong>{fitScore}<small>{fitScore === '—' ? '' : '/100 · '}{match.fitTier || 'not scored'}</small><em>{scoreLabel}</em></strong></div><div className="job-match-facts"><span><b>Salary</b>{salary}</span><span><b>Closes</b>{job.expiresAt ? String(job.expiresAt).slice(0, 10) : 'Not listed'}</span><span><b>Source signal</b>{sourceSignal}</span></div><p>{isAiScore ? (match.reasoning || 'AI evaluated the supplied listing evidence.') : 'Retrieved and qualified by search evidence; review the listing manually.'}</p><div className="job-match-columns"><span><b>{isAiScore ? 'Why it matches' : 'Search evidence'}</b>{(match.strengths || []).join(', ') || (isAiScore ? 'No specific match evidence verified yet.' : 'No AI match evidence was produced.')}</span><span><b>Gaps and unknowns</b>{[...(match.gaps || []), ...(match.unknowns || [])].join(', ') || 'Review the qualifications and eligibility.'}</span></div><details className="job-why"><summary>Why this result?</summary><p>Title query: {evidence.positionTitleQuery || evidence.query || 'not recorded'}. Keyword query: {evidence.keywordQuery || 'none'}. Location scope: {evidence.locationScope || 'not recorded'}.</p></details><div className="job-match-actions"><a className="secondary" href={job.applicationUrl || job.canonicalUrl} target="_blank" rel="noreferrer">Open listing <ExternalLink size={13} /></a><button className="primary" onClick={() => onSave(entry)}>{isSaved ? 'Saved to pipeline' : 'Save to pipeline'} {isSaved ? <Check size={13} /> : <Plus size={13} />}</button></div></article>;
}

function RequestPreview({ attempt, index }) {
  const request = attempt.request || {};
  const requestEntries = Object.entries(request);
  const displayValue = (value) => typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
  const error = attempt.error_message || attempt.errorMessage;
  const resultCount = attempt.result_count ?? attempt.resultCount ?? 0;
  const httpStatus = attempt.http_status ?? attempt.httpStatus;
  const preview = Array.isArray(attempt.preview) ? attempt.preview.slice(0, 2) : [];
  const requestUrl = attempt.url || request.url || request.endpoint;
  return <details className="job-search-attempt"><summary><b>Request {index + 1}</b><span>{error ? 'Failed' : 'Success'} · {resultCount} retrieved{httpStatus ? ` · HTTP ${httpStatus}` : ''}</span></summary><div className="job-search-attempt-body"><div className="job-search-query"><b>API request</b>{requestUrl && <span><em>URL</em> {requestUrl}</span>}{requestEntries.length ? <><b>Parameters and data</b>{requestEntries.filter(([key]) => !['url', 'endpoint'].includes(key)).map(([key, value]) => <span key={key}><em>{key}</em> {displayValue(value)}</span>)}</> : <span>{attempt.query || 'Default provider query'}{attempt.location ? ` · ${attempt.location}` : ''}</span>}</div>{error && <p className="job-search-attempt-error">{error}</p>}<div className="job-search-preview"><b>First 2 jobs returned (sample)</b>{preview.length ? preview.map((job) => <div className="job-search-preview-job" key={`${job.externalId || job.id}-${job.title}`}><div><strong>{job.title || 'Untitled listing'}</strong><small>{[job.company, job.location].filter(Boolean).join(' · ') || 'Details unavailable'}{job.externalId ? ` · ID ${job.externalId}` : ''}</small></div>{(job.applicationUrl || job.canonicalUrl) && <a href={job.applicationUrl || job.canonicalUrl} target="_blank" rel="noreferrer">Open <ExternalLink size={11} /></a>}</div>) : <span className="job-search-empty-preview">No jobs returned for this request.</span>}</div></div></details>;
}

function ScoredJobReport({ entry, onSave }) {
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const job = entry.job || {};
  const scoreValue = (value) => value === null || value === undefined ? '—' : `${value}/100`;
  const decision = entry.approvalStatus === 'pass' ? 'PASS' : entry.approvalStatus === 'fail' ? 'FAIL' : 'AI unavailable';
  const decisionClass = entry.approvalStatus === 'pass' ? 'pass' : entry.approvalStatus === 'fail' ? 'fail' : 'unknown';
  const addToPipeline = async () => { setSaving(true); try { const safeId = `job-${job.providerKey || 'search'}-${String(job.externalId || job.title).replace(/[^A-Za-z0-9._:-]/g, '-')}`; await window.desktopShell?.createJob?.({ id: safeId, company: job.company || job.agency || '', roleTitle: job.title || 'Untitled listing', url: job.applicationUrl || job.canonicalUrl, canonicalUrl: job.canonicalUrl, location: job.location, employmentType: job.employmentType, source: job.providerKey, externalId: job.externalId, apiSource: job.providerKey, rawData: job, description: job.description, requirements: job.requirements, postedAt: job.postedAt, expiresAt: job.expiresAt, salaryMin: job.salaryMin, salaryMax: job.salaryMax, salaryCurrency: job.salaryCurrency, remoteType: job.remoteType, matchScore: Math.min(Number(entry.requirementsMatchScore) || 0, Number(entry.candidateMatchScore) || 0), requirementsMatchScore: entry.requirementsMatchScore, candidateMatchScore: entry.candidateMatchScore, fitTier: 'manual review', matchSummary: entry.reasoning || 'Added from failed-job review.', notes: entry.reasoning || '' }); setSaved(true); } finally { setSaving(false); } };
  return <div className="job-search-scored-job"><div className="job-search-scored-job-head"><div><strong>{job.title || 'Untitled listing'}</strong><small>{[job.company || job.agency, job.location].filter(Boolean).join(' · ') || 'Details unavailable'}{entry.externalId ? ` · ID ${entry.externalId}` : ''}</small></div><span className={`job-search-decision ${decisionClass}`}>{decision}</span></div><div className="job-search-scored-scores"><span><b>Search relevance</b>{scoreValue(job.retrievalScore)}</span><span><b>Requirements fit</b>{scoreValue(entry.requirementsMatchScore)}</span><span><b>Candidate fit</b>{scoreValue(entry.candidateMatchScore)}</span></div>{entry.reasoning && <small className="job-search-scored-reasoning">{entry.reasoning}</small>}<div className="job-search-scored-actions">{(job.applicationUrl || job.canonicalUrl) && <a href={job.applicationUrl || job.canonicalUrl} target="_blank" rel="noreferrer">Open listing <ExternalLink size={11} /></a>}<button className="secondary" type="button" disabled={saving || saved} onClick={addToPipeline}>{saved ? <><Check size={11} /> Added to pipeline</> : <><Plus size={11} /> Add to pipeline</>}</button></div></div>;
}

function SearchSourceReport({ item, attempts, assessments = [], onSave }) {
  const providerAttempts = (attempts || []).filter((attempt) => attempt.provider === item.key);
  const providerAssessments = (item.aiAssessments || assessments).filter((entry) => entry.job?.providerKey === item.key);
  const rejectionSummary = Object.entries(item.rejectionReasons || {}).map(([reason, count]) => `${count} ${reason.replaceAll('_', ' ')}`).join(' · ');
  const failedAssessments = providerAssessments.filter((entry) => entry.approvalStatus === 'fail');
  return <details className="job-search-source"><summary><b>{item.provider}</b><span>{item.status || 'unknown'} · {item.requestsAttempted ?? item.requests ?? 0} requests · {item.retrievedRaw ?? item.fetched ?? 0} raw provider records · {item.uniqueCount ?? item.unique ?? 0} unique candidates · {item.hardFilteredCount ?? item.filtered ?? 0} filtered · {item.deterministicTopCount ?? item.aiSubmitted ?? 0} AI-submitted · {item.aiReturned ?? 0} AI-scored · {item.finalSelectedCount ?? 0} passed · {item.displayedCount ?? item.shown ?? 0} displayed · {item.errors || 0} request failures</span></summary><div className="job-search-source-body">{item.shortfallReason && <p>{item.shortfallReason}</p>}{rejectionSummary && <p><b>Filtered because:</b> {rejectionSummary}</p>}{failedAssessments.length ? <div className="job-search-scored-list"><b>Failed jobs available for a second look ({failedAssessments.length})</b>{failedAssessments.map((entry) => <ScoredJobReport key={entry.externalId} entry={entry} onSave={onSave} />)}</div> : null}{providerAttempts.map((attempt, index) => <RequestPreview key={attempt.id || `${item.key}-${index}`} attempt={attempt} index={index} />)}{item.failures?.length ? <p className="job-search-attempt-error">{item.failures.join('; ')}</p> : null}</div></details>;
}

function ApiCallReport({ calls = [] }) {
  const display = (value) => typeof value === 'string' ? value : JSON.stringify(value || {}, null, 2);
  return <details className="job-search-source"><summary><b>Complete API call log</b><span>{calls.length} calls recorded · request and response payloads</span></summary><div className="job-search-source-body">{calls.length ? calls.map((call, index) => <details className="job-search-attempt" key={call.id || index}><summary><b>{index + 1}. {call.purpose || 'API request'}</b><span>{call.response_status ? `HTTP ${call.response_status}` : call.error_name || 'No response'} · {call.duration_ms || 0}ms</span></summary><div className="job-search-attempt-body"><div className="job-search-query"><span><em>Method</em> {call.method || 'GET'}</span><span><em>URL</em> {call.url || '(not recorded)'}</span><span><em>Started</em> {call.created_at || '(not recorded)'}</span></div>{call.error_message && <p className="job-search-attempt-error">{call.error_message}</p>}<pre className="job-search-raw"><b>Request headers</b>{display(call.requestHeaders || call.request_headers_json)}<b>Request parameters and data</b>{call.request_body || '(empty)'}<b>Response headers</b>{display(call.responseHeaders || call.response_headers_json)}<b>Response body</b>{call.response_body || '(empty)'}</pre></div></details>) : <span className="job-search-empty-preview">No low-level API calls were recorded for this search.</span>}</div></details>;
}

function RankingReport({ ranking, batches = [] }) {
  if (!ranking) return null;
  const diagnostics = ranking.diagnostics || {};
  const error = ranking.error;
  const totalCalls = diagnostics.totalCalls || batches[0]?.total_calls || batches.length || 0;
  const latestByCall = new Map();
  batches.forEach((batch) => latestByCall.set(batch.call_number || batch.batch_number, batch));
  const latestCalls = [...latestByCall.values()];
  const completedCalls = latestCalls.filter((batch) => batch.status === 'success').length;
  const inFlightCalls = latestCalls.filter((batch) => batch.status === 'started').length;
  const providerCounts = diagnostics.providerCounts || {};
  return <details className="job-search-source" open><summary><b>AI ranking diagnostics</b><span>{['available', 'under_selected'].includes(ranking.status) ? `${totalCalls} OpenRouter calls · ${diagnostics.submittedCount || 0} jobs` : error?.message || 'unavailable'}</span></summary><div className="job-search-source-body"><small>{completedCalls}/{totalCalls} calls complete · {inFlightCalls} in flight · {diagnostics.submittedCount || 0} submitted · {diagnostics.assessedCount || 0} assessed · {diagnostics.aiReturnedCount || 0} scored · {diagnostics.returnedCount || 0} passed</small>{Object.entries(providerCounts).some(([, counts]) => counts.submitted) ? <div className="job-search-ranking-providers"><b>OpenRouter jobs by provider</b>{Object.entries(providerCounts).filter(([, counts]) => counts.submitted).map(([provider, counts]) => <span key={provider}>{provider}: {counts.submitted} submitted · {counts.assessed || 0} assessed · {counts.aiReturned || 0} scored · {counts.returned || 0} passed</span>)}</div> : null}{error && <p className="job-search-attempt-error">{error.code}: {error.message}</p>}{batches.map((batch) => <div className="job-search-ranking-batch" key={batch.id || `${batch.batch_number}-${batch.status}-${batch.created_at}`}><b>OpenRouter call {batch.call_number || batch.batch_number}/{batch.total_calls || totalCalls} {batch.status === 'success' ? 'completed' : batch.status}</b><span>{batch.submitted_count} jobs submitted · {batch.assessed_count} assessed · {batch.prompt_characters || 0} prompt chars · {batch.max_tokens || 0} max tokens · {batch.duration_ms || 0}ms{batch.error_message ? ` · ${batch.error_message}` : ''}</span></div>)}</div></details>;
}

const getSearchAttempts = (report) => report?.attemptsDiagnostics || report?.diagnostics?.attempts || [];

const audioFormatFromMimeType = (mimeType = '') => {
  const mime = mimeType.toLowerCase();
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
  return 'webm';
};
const VOICE_SPEECH_THRESHOLD = 0.035;
const VOICE_SILENCE_MS = 900;

function VoiceTestPanel() {
  const [phase, setPhase] = useState('IDLE');
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState('');
  const recorder = useRef(null);
  const chunks = useRef([]);
  const audioUrl = useRef('');
  const stream = useRef(null);
  const audioContext = useRef(null);
  const analyser = useRef(null);
  const monitorFrame = useRef(null);
  const speechDetected = useRef(false);
  const silenceStartedAt = useRef(null);
  const sessionActive = useRef(false);
  const processing = useRef(false);
  const player = useRef(null);
  const conversation = useRef([]);
  const transition = (next, detail = '') => {
    console.info(`[voice] ${next}${detail ? ` — ${detail}` : ''}`);
    setPhase(next);
  };

  useEffect(() => () => {
    sessionActive.current = false;
    if (monitorFrame.current) cancelAnimationFrame(monitorFrame.current);
    player.current?.pause?.();
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    stream.current?.getTracks?.().forEach((track) => track.stop());
    audioContext.current?.close?.();
  }, []);

  const startCapture = () => {
    if (!sessionActive.current || !stream.current || processing.current) return;
    chunks.current = [];
    speechDetected.current = false;
    silenceStartedAt.current = null;
    const mediaRecorder = new MediaRecorder(stream.current);
    recorder.current = mediaRecorder;
    mediaRecorder.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks.current, { type: mediaRecorder.mimeType || 'audio/webm' });
      processRecording(blob);
    };
    mediaRecorder.start();
    transition('LISTENING', 'microphone active');
    monitorSilence();
  };

  // A short quiet gap marks the end of a spoken turn. This keeps the session
  // hands-free while avoiding microphone capture during Luna's reply.
  const monitorSilence = () => {
    if (!sessionActive.current || !analyser.current || recorder.current?.state !== 'recording') return;
    const samples = new Uint8Array(analyser.current.fftSize);
    analyser.current.getByteTimeDomainData(samples);
    let sum = 0;
    samples.forEach((sample) => { const centered = (sample - 128) / 128; sum += centered * centered; });
    const volume = Math.sqrt(sum / samples.length);
    if (volume > VOICE_SPEECH_THRESHOLD) {
      if (!speechDetected.current) console.info('[voice] speech detected');
      speechDetected.current = true;
      silenceStartedAt.current = null;
    } else if (speechDetected.current) {
      silenceStartedAt.current ||= performance.now();
      if (performance.now() - silenceStartedAt.current > VOICE_SILENCE_MS) {
        transition('END_OF_SPEECH_DETECTED', `${VOICE_SILENCE_MS}ms silence`);
        recorder.current.stop();
        return;
      }
    }
    monitorFrame.current = requestAnimationFrame(monitorSilence);
  };

  const playResponse = async (audio) => {
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    const bytes = Uint8Array.from(atob(audio.audioBase64), (character) => character.charCodeAt(0));
    audioUrl.current = URL.createObjectURL(new Blob([bytes], { type: audio.mimeType || 'audio/mpeg' }));
    const audioPlayer = new Audio(audioUrl.current);
    player.current = audioPlayer;
    transition('AI_SPEAKING');
    await new Promise((resolve, reject) => {
      audioPlayer.onended = () => { console.info('[voice] playback finished'); processing.current = false; if (sessionActive.current) { console.info('[voice] resuming microphone'); startCapture(); } resolve(); };
      audioPlayer.onerror = () => reject(new Error('The response was generated, but your device could not play Luna’s voice.'));
      audioPlayer.play().catch(() => reject(new Error('Audio playback was blocked. Click Start talking once more to allow voice playback.')));
    });
  };

  const processRecording = async (blob) => {
    if (!blob.size || !sessionActive.current) { if (sessionActive.current) startCapture(); return; }
    processing.current = true;
    try {
      console.info(`[voice] audio captured: ${blob.size} bytes`);
      transition('TRANSCRIBING');
      const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('The recorded audio could not be read.')); reader.onloadend = () => resolve(String(reader.result || '').split(',')[1] || ''); reader.readAsDataURL(blob); });
      const transcription = await window.desktopShell?.transcribeVoiceTest?.({ data, format: audioFormatFromMimeType(blob.type) });
      if (!transcription?.text) throw new Error('The recording could not be transcribed.');
      console.info(`[voice] transcription: "${transcription.text}"`);
      conversation.current = [...conversation.current, { speaker: 'you', text: transcription.text }];
      setMessages((current) => [...current, { speaker: 'you', text: transcription.text }]);
      console.info('[voice] sending to Luna');
      transition('LUNA_THINKING');
      const assistant = await window.desktopShell?.generateVoiceTestResponse?.({ transcript: transcription.text, history: conversation.current.slice(0, -1) });
      if (!assistant?.text) throw new Error('Luna returned no response.');
      console.info(`[voice] Luna response: "${assistant.text}"`);
      conversation.current = [...conversation.current, { speaker: 'luna', text: assistant.text }];
      setMessages((current) => [...current, { speaker: 'luna', text: assistant.text }]);
      console.info('[voice] requesting TTS');
      transition('GENERATING_SPEECH');
      const speech = await window.desktopShell?.synthesizeVoiceTest?.(assistant.text);
      if (!speech?.audioBase64) throw new Error('Speech generation returned no audio.');
      console.info(`[voice] TTS audio received: ${speech.audioBase64.length} base64 characters`);
      console.info('[voice] playing TTS audio');
      if (!sessionActive.current) return;
      await playResponse(speech);
    } catch (cause) {
      setError(cause?.message || 'The voice conversation failed. Please try again.');
      processing.current = false;
      if (sessionActive.current) startCapture();
    } finally { processing.current = false; }
  };

  const start = async () => {
    setError(''); setMessages([]); conversation.current = []; sessionActive.current = true;
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) { sessionActive.current = false; setError('This browser does not support microphone recording.'); return; }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextClass) throw new Error('This browser cannot monitor microphone silence automatically.');
      audioContext.current = new AudioContextClass();
      const source = audioContext.current.createMediaStreamSource(stream.current);
      analyser.current = audioContext.current.createAnalyser();
      analyser.current.fftSize = 512;
      source.connect(analyser.current);
      await audioContext.current.resume();
      startCapture();
    } catch (cause) { sessionActive.current = false; setError(cause?.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow microphone access and try again.' : (cause?.message || 'Could not start microphone recording.')); transition('IDLE'); }
  };

  const stop = () => {
    sessionActive.current = false;
    if (monitorFrame.current) cancelAnimationFrame(monitorFrame.current);
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks?.().forEach((track) => track.stop());
    audioContext.current?.close?.();
    player.current?.pause?.();
    transition('IDLE');
  };
  const active = sessionActive.current;
  const phaseLabel = { LISTENING: 'Listening…', USER_SPEAKING: 'Listening to you…', END_OF_SPEECH_DETECTED: 'Finishing your turn…', TRANSCRIBING: 'Transcribing…', LUNA_THINKING: 'Luna is thinking…', GENERATING_SPEECH: 'Preparing Luna’s voice…', AI_SPEAKING: 'Luna is speaking…', IDLE: 'Ready' }[phase] || phase;
  return <section className="voice-test-panel" aria-live="polite"><div><span className="eyebrow">LUNA VOICE · HANDS-FREE</span><h3>Have a conversation with Luna</h3><p>Tap once to start. Speak naturally and pause when you’re done; Luna will detect the pause, answer out loud, and listen again automatically.</p></div><div className="voice-test-controls"><button className={active ? 'secondary' : 'primary'} onClick={active ? stop : start}>{active ? <><Square size={15} /> End Conversation</> : <><Mic size={15} /> Start Conversation</>}</button><small className={`voice-test-status ${phase === 'IDLE' ? 'ready' : ''}`}>{active ? phaseLabel : 'Ready'}</small></div>{messages.length > 0 && <div className="voice-test-message-list">{messages.map((message, index) => <div className={`voice-test-message ${message.speaker}`} key={`${message.speaker}-${index}`}><b>{message.speaker === 'you' ? 'You' : 'Luna'}</b><p>“{message.text}”</p></div>)}</div>}{error && <p className="voice-test-error">{error}</p>}</section>;
}

function EmailMonitorPanel({ jobs: allJobs = [] }) {
  const [source, setSource] = useState({ configured: false, email: '' });
  const [form, setForm] = useState(emptyEmailForm);
  const [emails, setEmails] = useState([]);
  const [includeExcluded, setIncludeExcluded] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => { const [savedSource, savedEmails] = await Promise.all([window.desktopShell?.getEmailSource?.(), window.desktopShell?.listJobEmails?.({ jobOnly: true, includeExcluded, limit: 30 })]); if (savedSource) { setSource(savedSource); setForm((current) => ({ ...current, email: savedSource.email || '' })); } setEmails(savedEmails || []); };
  useEffect(() => { load().catch((cause) => setMessage(cause?.message || 'Could not load email monitor.')); }, [includeExcluded]);
  const save = async () => { setBusy(true); try { const saved = await window.desktopShell?.saveEmailSource?.(form); setSource(saved); setForm((current) => ({ ...current, accessToken: '', refreshToken: '' })); setMessage('Gmail connected. Read-only sync runs every 10 minutes while the app is open; the refresh token keeps access durable.'); } catch (cause) { setMessage(cause?.message || 'Could not connect Gmail.'); } finally { setBusy(false); } };
  const sync = async () => { setBusy(true); try { const result = await window.desktopShell?.syncJobEmails?.(); setMessage(result?.message || `Synced ${result?.imported || 0} messages; ${result?.jobRelated || 0} appear job-related.`); await load(); } catch (cause) { setMessage(cause?.message || 'Could not sync Gmail.'); } finally { setBusy(false); } };
  const search = async () => { setResults(query.trim() ? await window.desktopShell?.searchJobEmails?.(query, 10) : []); };
  const clear = async () => { await window.desktopShell?.clearEmailSource?.(); setSource({ configured: false, email: '' }); setForm(emptyEmailForm()); setMessage('Gmail connection cleared. Indexed content remains local.'); };
  const jobs = useMemo(() => appliedJobs(allJobs), [allJobs]);
  const setEmailJob = async (emailId, jobId) => { if (!jobId) return; setBusy(true); try { await window.desktopShell?.linkJobEmail?.({ emailId, jobId }); await load(); setMessage('Email linked to the selected pipeline job.'); } catch (cause) { setMessage(cause?.message || 'Could not link email.'); } finally { setBusy(false); } };
  const unlink = async (emailId, jobId) => { setBusy(true); try { await window.desktopShell?.unlinkJobEmail?.({ emailId, jobId }); await load(); setMessage('Email unlinked from the pipeline job.'); } catch (cause) { setMessage(cause?.message || 'Could not unlink email.'); } finally { setBusy(false); } };
  const setExcluded = async (email, excluded) => { setBusy(true); try { const updated = await window.desktopShell?.setJobEmailExcluded?.({ emailId: email.id, excluded }); setSelectedEmail(updated?.isExcluded ? null : updated); await load(); setMessage(excluded ? 'Email excluded as not relevant.' : 'Email restored to the monitor.'); } catch (cause) { setMessage(cause?.message || 'Could not update email relevance.'); } finally { setBusy(false); } };
  return <><section className="job-source-settings email-monitor"><div><span className="eyebrow">EMAIL INTELLIGENCE · LOCAL RAG</span><h3>Monitor job-related email</h3><p>Gmail is read only. Messages are classified locally, chunked into SQLite, searchable, and can be linked to one pipeline job.</p></div><div className="job-source-actions"><span>{source.configured ? `Connected: ${source.email || 'Gmail'}` : 'Not connected'}</span><button className="secondary" onClick={async () => { setBusy(true); try { const saved = await window.desktopShell?.connectGmail?.(); setSource(saved); setMessage('Gmail connected. Read-only sync runs every 10 minutes while the app is open.'); } catch (cause) { setMessage(cause?.message || 'Could not connect Gmail.'); } finally { setBusy(false); } }} disabled={busy}>{busy ? 'Working…' : 'Sign in with Google'}</button><button className="secondary" onClick={sync} disabled={busy || !source.configured}>Sync now</button><button className="secondary" onClick={clear} disabled={!source.configured}>Clear</button><button className="secondary" onClick={() => setIncludeExcluded((value) => !value)}>{includeExcluded ? 'Hide excluded' : 'Show excluded'}</button></div><div className="email-rag-search"><label className="board-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && search()} placeholder="Search indexed job email…" /></label><button className="secondary" onClick={search}>Search context</button></div>{message && <small className="job-source-message">{message}</small>}<div className="email-rag-results">{results.map((result) => <article key={result.id}><b>{result.subject || '(No subject)'}</b><small>{result.sender} · {result.receivedAt || 'Date unknown'}</small><p>{result.content}</p></article>)}{emails.map((email) => <article className={`email-link-card${email.isExcluded ? ' email-excluded' : ''}`} key={email.id}><button className="email-open-button" onClick={() => setSelectedEmail(email)}><b>{email.subject || '(No subject)'}</b><small>{email.sender} · {email.received_at || 'Date unknown'}</small></button><div className="email-link-actions"><select aria-label={`Link ${email.subject || 'email'} to pipeline job`} defaultValue="" disabled={busy || !jobs.length || email.isExcluded} onChange={(event) => { setEmailJob(email.id, event.target.value); event.target.value = ''; }}><option value="">{jobs.length ? 'Link or move to pipeline job…' : 'Add a pipeline job first'}</option>{jobs.map((job) => <option key={job.id} value={job.id}>{job.company} — {job.roleTitle}</option>)}</select>{(email.linkedJobIds || []).map((jobId) => { const job = jobs.find((entry) => entry.id === jobId); return <span className="email-job-link" key={jobId}>{job ? `${job.company} — ${job.roleTitle}` : 'Archived job'} <button className="secondary" disabled={busy} onClick={() => unlink(email.id, jobId)}>Unlink</button></span>; })}<button className="secondary" disabled={busy} onClick={() => setExcluded(email, !email.isExcluded)}>{email.isExcluded ? 'Restore' : 'Not relevant'}</button></div></article>)}{!results.length && !emails.length && <small>Sync Gmail to index job-related messages.</small>}</div></section>{selectedEmail && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedEmail(null); }}><article className="email-detail-modal" role="dialog" aria-modal="true" aria-labelledby="email-detail-title"><div className="job-modal-head"><div><span className="eyebrow">EMAIL DETAIL</span><h2 id="email-detail-title">{selectedEmail.subject || '(No subject)'}</h2></div><button className="close" aria-label="Close email" onClick={() => setSelectedEmail(null)}><X size={18} /></button></div><div className="email-detail-meta"><span><b>From</b>{selectedEmail.sender || 'Unknown sender'}</span><span><b>To</b>{selectedEmail.recipients || 'Unknown recipient'}</span><span><b>Received</b>{selectedEmail.received_at || 'Date unknown'}</span></div><div className="email-detail-body">{selectedEmail.body || '(This email has no text content.)'}</div><div className="job-modal-foot"><button className="secondary" disabled={busy} onClick={() => setExcluded(selectedEmail, !selectedEmail.isExcluded)}>{selectedEmail.isExcluded ? 'Restore to monitor' : 'Exclude as not relevant'}</button><button className="primary" onClick={() => setSelectedEmail(null)}>Close</button></div></article></div>}</>;
}

export default function JobsView({ jobs = [], onRefresh, onDetailChange }) {
  const [query, setQuery] = useState('');
  const [stageFilter, setStageFilter] = useState('all');
  const [modalJob, setModalJob] = useState(null);
  const [stageBusyId, setStageBusyId] = useState(null);
  const [preparingJobIds, setPreparingJobIds] = useState(() => new Set());
  const [preparationBlockers, setPreparationBlockers] = useState({});
  const [preparationActivity, setPreparationActivity] = useState([]);
  const [preparationCounts, setPreparationCounts] = useState({ total: 0, completed: 0, failed: 0, remaining: 0, queued: 0, active: 0 });
  const [preparationPaused, setPreparationPaused] = useState(true);
  const [preparationRunning, setPreparationRunning] = useState(false);
  const [preparationStep, setPreparationStep] = useState('');
  const [preparationQueueOpen, setPreparationQueueOpen] = useState(false);
  const [automationQueueStatus, setAutomationQueueStatus] = useState({ queue: [], counts: { total: 0, queued: 0, active: 0, blocked: 0, awaitingEmail: 0, applied: 0, terminal: 0 }, paused: true, message: '' });
  const [automationAnswers, setAutomationAnswers] = useState({});
  const [automationAnswerModal, setAutomationAnswerModal] = useState(null);
  const [automationAnswerSaving, setAutomationAnswerSaving] = useState(false);
  const [automationAnswerError, setAutomationAnswerError] = useState('');
  const [automationQueueOpen, setAutomationQueueOpen] = useState(false);
  const [automationQueueStarting, setAutomationQueueStarting] = useState(false);
  const [automationRetryingIds, setAutomationRetryingIds] = useState(() => new Set());
  const automationReviewQueue = automationQueueStatus.queue.filter((entry) => entry.automationState === 'failed' || entry.automationState === 'needs_user_answer' || (entry.automationState === 'queued' && entry.automationCheckpoint?.answerReadyForRetry === true));
  const preparationJobId = [...preparingJobIds][0] || null;
  const preparationJob = jobs.find((job) => job.id === preparationJobId) || null;
  const preparationQueue = [...jobs.filter((job) => job.stage === 'researching'), ...jobs.filter((job) => job.stage === 'target')];
  const preparationTerminalByJob = new Map(preparationActivity.filter((entry) => ['preparation_completed', 'preparation_failed'].includes(entry.eventType)).map((entry) => [entry.jobId, entry.eventType]));
  const preparationUpNext = preparationQueue.filter((job) => job.id !== preparationJobId && !preparationTerminalByJob.has(job.id));
  const preparationBlocked = Object.entries(preparationBlockers).map(([jobId, message]) => ({ job: jobs.find((job) => job.id === jobId), message })).filter((entry) => entry.job);
  const preparationCompleted = new Set(preparationActivity.filter((entry) => entry.eventType === 'preparation_completed').map((entry) => entry.jobId)).size;
  const formatPreparationStep = (step) => String(step || '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Starting';
  const preparationRetryPanel = null;
  useEffect(() => {
    let disposed = false;
    const sync = async () => {
      try {
        const status = await window.desktopShell?.getApplicationPreparationStatus?.();
        if (disposed || !status) return;
        setPreparingJobIds(status.activeJobId ? new Set([status.activeJobId]) : new Set());
        setPreparationStep(status.activeStep || '');
        setPreparationBlockers(status.blockers || {});
        setPreparationActivity(status.activity || []);
        setPreparationCounts(status.counts || { total: 0, completed: 0, failed: 0, remaining: 0, queued: 0, active: 0 });
        setPreparationPaused(status.paused !== false);
        setPreparationRunning(Boolean(status.running));
      } catch { /* status polling is best-effort while Electron is starting */ }
    };
    sync();
    const statusTimer = window.setInterval(sync, 2000);
    const refreshTimer = window.setInterval(() => { onRefresh?.().catch?.(() => {}); }, 5000);
    return () => { disposed = true; window.clearInterval(statusTimer); window.clearInterval(refreshTimer); };
  }, [onRefresh]);
  const startPreparationQueue = async () => {
    await window.desktopShell?.startApplicationPreparationQueue?.();
    const status = await window.desktopShell?.getApplicationPreparationStatus?.();
    if (status) { setPreparationPaused(status.paused !== false); setPreparationRunning(Boolean(status.running)); setPreparationCounts(status.counts || preparationCounts); }
  };
  const pausePreparationQueue = async () => {
    const status = await window.desktopShell?.pauseApplicationPreparationQueue?.();
    if (status) { setPreparationPaused(status.paused !== false); setPreparationRunning(Boolean(status.running)); setPreparationCounts(status.counts || preparationCounts); }
  };
  const refreshAutomationQueue = async () => {
    const status = await window.desktopShell?.getApplicationWorkflowQueueStatus?.();
    if (!status) return null;
    const queue = await Promise.all((status.queue || []).map(async (entry) => ({ ...entry, unknownQuestions: entry.unknownQuestionCount ? await window.desktopShell?.listJobApplicationUnknownQuestions?.({ applicationId: entry.applicationId }) || [] : [] })));
    const nextStatus = { ...status, queue };
    setAutomationQueueStatus(nextStatus);
    return nextStatus;
  };
  useEffect(() => { let disposed = false; const sync = async () => { try { const status = await window.desktopShell?.getApplicationWorkflowQueueStatus?.(); if (disposed || !status) return; const queue = await Promise.all((status.queue || []).map(async (entry) => ({ ...entry, unknownQuestions: entry.unknownQuestionCount ? await window.desktopShell?.listJobApplicationUnknownQuestions?.({ applicationId: entry.applicationId }) || [] : [] }))); if (!disposed) setAutomationQueueStatus({ ...status, queue }); } catch { /* queue polling is best-effort while Electron is starting */ } }; sync(); const timer = window.setInterval(sync, 2500); return () => { disposed = true; window.clearInterval(timer); }; }, []);
   const startAutomationQueue = async () => {
     if (automationQueueStarting) return;
     setAutomationQueueStarting(true);
     // The main process owns the complete run. Opening a separate assistant
     // here raced the native browser and could release the job it just claimed.
     try {
       const status = await window.desktopShell?.startApplicationWorkflowQueue?.({ mode: 'entire_pipeline' });
       if (status) { setAutomationQueueStatus(status); await refreshAutomationQueue(); }
     } catch (cause) {
       setError(cause?.message || 'Could not start the application checkpoint.');
     } finally {
       setAutomationQueueStarting(false);
     }
   };
   const pauseAutomationQueue = async () => { const status = await window.desktopShell?.pauseApplicationWorkflowQueue?.(); if (status) setAutomationQueueStatus(status); };
   const startWorkflowQueue = async (applicationId) => {
     if (automationQueueStarting) return;
     setAutomationQueueStarting(true);
     try {
       const status = await window.desktopShell?.startApplicationWorkflowQueue?.({ ...(applicationId ? { applicationId } : {}), mode: 'entire_pipeline' });
       if (status) setAutomationQueueStatus(status);
       await refreshAutomationQueue();
     } catch (cause) {
       setAutomationQueueStatus((current) => ({ ...current, message: cause?.message || 'Could not continue the application workflow.' }));
     } finally {
       setAutomationQueueStarting(false);
     }
   };
   const pauseWorkflowQueue = pauseAutomationQueue;
   const openWorkflowJob = (entry) => { const job = jobs.find((candidate) => candidate.id === entry.jobId); if (!job) return; if (['waiting_for_login', 'waiting_for_activation', 'ready_for_review', 'verifying_browser'].includes(entry.state)) void openApplication(job, 'resume', true); else setDetailJob(job); };
  const resumeAfterAnswer = async (applicationId) => {
    const status = await refreshAutomationQueue();
    const entry = status?.queue?.find((candidate) => candidate.applicationId === applicationId);
    // Once the final unanswered field is approved, resume the same job
    // immediately; remaining questions stay visible instead of auto-skipping.
    if (!entry || !['queued', 'retry_wait'].includes(entry.state) || automationRetryingIds.has(applicationId)) return;
    setAutomationRetryingIds((current) => new Set(current).add(applicationId));
    try {
      const result = await window.desktopShell?.resolveApplicationWorkflowBlocker?.({ applicationId });
      if (result) setAutomationQueueStatus(result);
      await refreshAutomationQueue();
    } catch (cause) {
      setAutomationQueueStatus((current) => ({ ...current, message: cause?.message || 'The approved answer was saved, but the application could not resume automatically.' }));
    } finally {
      setAutomationRetryingIds((current) => { const next = new Set(current); next.delete(applicationId); return next; });
    }
  };
  const approveRemainingSuggestions = async (entry, approvedQuestionId) => {
    const remaining = (entry?.unknownQuestions || []).filter((question) => question.id !== approvedQuestionId && !String(question.questionKey || '').startsWith('checkpoint:')).map((question) => ({ question, field: entry.automationCheckpoint?.unresolvedFields?.find((candidate) => candidate.fieldFingerprint === String(question.questionKey || '').replace(/^safe-pass:/, '')) })).filter(({ field }) => field?.suggestedValue && Number(field.confidence) >= 0.85 && Array.isArray(field.evidence) && field.evidence.length > 0);
    for (const { question, field } of remaining) await window.desktopShell?.resolveJobApplicationUnknownQuestion?.({ id: question.id, answerText: field.suggestedValue });
    if (remaining.length) setAutomationAnswers((current) => { const next = { ...current }; remaining.forEach(({ question }) => { next[question.id] = ''; }); return next; });
  };
  const resolveAutomationQuestion = async (question, suggestedAnswer = '') => { const answerText = String(automationAnswers[question.id] ?? suggestedAnswer).trim(); if (!answerText) return; const entry = automationQueueStatus.queue.find((candidate) => candidate.applicationId === question.applicationId); await window.desktopShell?.resolveJobApplicationUnknownQuestion?.({ id: question.id, answerText }); await approveRemainingSuggestions(entry, question.id); setAutomationAnswers((current) => ({ ...current, [question.id]: '' })); await resumeAfterAnswer(question.applicationId); };
  // AI drafts remain review-only, but carrying them through the checkpoint
  // removes unnecessary typing while preserving the explicit approval gate.
  const answerSuggestionFor = (entry, question) => { const fingerprint = String(question?.questionKey || '').replace(/^safe-pass:/, ''); return entry?.automationCheckpoint?.unresolvedFields?.find((field) => field.fieldFingerprint === fingerprint)?.suggestedValue || ''; };
  const openAutomationAnswerModal = async (entry) => { setAutomationAnswerError(''); const question = entry.unknownQuestions?.find((candidate) => !String(candidate.questionKey || '').startsWith('checkpoint:')) || null; const suggestion = answerSuggestionFor(entry, question); if (question && suggestion) setAutomationAnswers((current) => ({ ...current, [question.id]: current[question.id] || suggestion })); setAutomationAnswerModal({ entry, question }); };
  const openFirstAutomationAnswer = () => { setAutomationQueueOpen(true); const entry = automationQueueStatus.queue.find((candidate) => candidate.state === 'waiting_for_answer'); if (entry) openAutomationAnswerModal(entry); };
  const saveAutomationModalAnswer = async () => { const question = automationAnswerModal?.question; const entry = automationAnswerModal?.entry; const answerText = String(automationAnswers[question?.id] ?? answerSuggestionFor(entry, question)).trim(); if (!question || !answerText) return; setAutomationAnswerSaving(true); setAutomationAnswerError(''); try { await window.desktopShell?.resolveJobApplicationUnknownQuestion?.({ id: question.id, answerText }); await approveRemainingSuggestions(entry, question.id); setAutomationAnswers((current) => ({ ...current, [question.id]: '' })); setAutomationAnswerModal(null); await resumeAfterAnswer(question.applicationId); } catch (cause) { setAutomationAnswerError(cause?.message || 'Could not save this answer.'); } finally { setAutomationAnswerSaving(false); } };
  const releaseAutomationApplication = async (entry) => {
    if (!['blocked', 'retry_wait', 'waiting_for_answer', 'waiting_for_login', 'waiting_for_activation'].includes(entry.state) || entry.blocker?.code === 'submission_outcome_uncertain' || automationRetryingIds.has(entry.applicationId)) return;
    setAutomationRetryingIds((current) => new Set(current).add(entry.applicationId));
    try {
      // A row retry must requeue the durable item itself. The compatibility
      // blocker-resume channel only starts a run and leaves a blocked item
      // unchanged, which made Retry appear to do nothing.
      const result = await window.desktopShell?.retryApplicationWorkflowQueueItem?.({ applicationId: entry.applicationId });
      if (result) setAutomationQueueStatus(result);
      await refreshAutomationQueue();
    } catch (cause) {
      setAutomationQueueStatus((current) => ({ ...current, message: cause?.message || 'Retry could not be started.' }));
    } finally {
      setAutomationRetryingIds((current) => { const next = new Set(current); next.delete(entry.applicationId); return next; });
    }
  };
  const changeBoardStage = async (job, stage) => {
    if (stage === job.stage || stageBusyId === job.id) return;
    if (stage === 'archived') {
      if (!window.confirm(`Archive ${job.roleTitle} at ${job.company}?`)) return;
      setStageBusyId(job.id);
      setSearchMessage('');
      try {
        // Keep archived opportunities visible in the combined rejected/withdrawn/archived column.
        await window.desktopShell?.updateJobStage?.({ jobId: String(job.id), stage: 'rejected' });
        await onRefresh?.();
      } catch (cause) {
        setSearchMessage(cause?.message || 'Could not archive this opportunity.');
      } finally {
        setStageBusyId(null);
      }
      return;
    }
    setStageBusyId(job.id);
    setSearchMessage('');
    try {
      // Use the same validated IPC path as the edit modal and wait for the
      // refresh so a rejected save cannot silently snap the select back.
      // Board stage changes should not be blocked by nullable optional fields
      // from older/search-imported records when the main process validates jobs.
      const updatePayload = {
        ...job,
        id: String(job.id),
        company: String(job.company || ''),
        roleTitle: String(job.roleTitle || ''),
        stage,
        priority: job.priority || 'medium',
        url: job.url || '',
        location: job.location || '',
        employmentType: job.employmentType || '',
        salaryRange: job.salaryRange || '',
        source: job.source || job.apiSource || '',
        nextAction: job.nextAction || '',
        contactName: job.contactName || '',
        contactEmail: job.contactEmail || '',
        notes: job.notes || '',
        followUpDate: job.followUpDate || null,
        appliedAt: job.appliedAt || null,
      };
      await window.desktopShell?.updateJobStage?.({ jobId: String(job.id), stage });
      await onRefresh?.();
    } catch (cause) {
      setSearchMessage(cause?.message || 'Could not update the pipeline stage.');
    } finally {
      setStageBusyId(null);
    }
  };
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [profile, setProfile] = useState(DEFAULT_SEARCH_PROFILE);
  const [resume, setResume] = useState({ rawText: '' });
  const [masterResumePdf, setMasterResumePdf] = useState('');
  const [masterResumePath, setMasterResumePath] = useState(null);
  const [resetResumeBusy, setResetResumeBusy] = useState(false);
  const [resumeMessage, setResumeMessage] = useState('');
  const [resumeBusy, setResumeBusy] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [matches, setMatches] = useState([]);
  const [searchReport, setSearchReport] = useState(null);
  const [searchState, setSearchState] = useState('idle');
  const [searchMessage, setSearchMessage] = useState('');
  const [source, setSource] = useState({ configured: false, email: '' });
  const [sourceForm, setSourceForm] = useState(emptySourceForm);
  const [sourceMessage, setSourceMessage] = useState('');
  const [aiKey, setAiKey] = useState(''); const [aiStatus, setAiStatus] = useState({ configured: false }); const [aiMessage, setAiMessage] = useState('');
  const [sourceTesting, setSourceTesting] = useState(false);
  const [applicationWorkspace, setApplicationWorkspace] = useState(null);
  const [applications, setApplications] = useState([]);
  const [applicationDocuments, setApplicationDocuments] = useState({});
  const [detailJob, setDetailJob] = useState(null);
  const workflowQueueStatus = { ...automationQueueStatus, queue: [...(automationQueueStatus.queue || [])].sort((left, right) => Number(right.applicationId === automationQueueStatus.activeApplicationId) - Number(left.applicationId === automationQueueStatus.activeApplicationId) || left.position - right.position) };
  const resetResumeVersions = async () => {
    if (!window.confirm('Reset every generated resume and cover-letter version across all applications? The uploaded master resume will be preserved.')) return;
    setResetResumeBusy(true);
    try {
      const result = await window.desktopShell?.resetApplicationDocuments?.();
      setApplicationDocuments({});
      await onRefresh?.();
      const count = result?.documentsRemoved || 0;
      setResumeMessage('Reset ' + count + ' generated document version' + (count === 1 ? '' : 's') + ' and cleared their application files. The master resume was preserved.');
    } catch (cause) {
      setResumeMessage(cause?.message || 'Could not reset generated resume versions.');
    } finally {
      setResetResumeBusy(false);
    }
  };
  useEffect(() => {
    window.desktopShell?.getMasterResumePath?.().then(setMasterResumePath).catch(() => {});
  }, []);
  // Breadcrumb navigation unmounts the workspace first, so scrolling waits until the board is rendered again.
  const pendingSearchNavigation = useRef(null);
  const rankingProgress = useRef(new Map());
  const missingFitBackfillStarted = useRef(false);
  useEffect(() => { const handler = (event) => { if (event.detail?.application) { setApplicationWorkspace(event.detail); setDetailJob(event.detail.job || jobs.find((job) => job.id === event.detail.application.jobId) || null); } }; const greenhouseHandler = (event) => { const result = event.detail; setModalJob(null); setMatches(result?.matches || []); setSearchReport(result || null); setSearchState('success'); setSearchMessage(`Greenhouse board search complete. Retrieved ${result?.counts?.retrieved || 0} jobs and ranked ${result?.matches?.length || 0} matches.`); }; window.addEventListener('application-started', handler); window.addEventListener('greenhouse-board-results', greenhouseHandler); return () => { window.removeEventListener('application-started', handler); window.removeEventListener('greenhouse-board-results', greenhouseHandler); }; }, [jobs]);
  useEffect(() => { const handler = (event) => { if (event.detail?.applicationId === applicationWorkspace?.application?.id) setApplicationWorkspace(null); }; window.addEventListener('application-submission-complete', handler); return () => window.removeEventListener('application-submission-complete', handler); }, [applicationWorkspace?.application?.id]);
  useEffect(() => {
    const closeNativeApplicationBrowser = () => {
      // The employer page is an Electron WebContentsView, so unmounting this React
      // workspace does not remove it. Close it explicitly before leaving the job flow.
      window.desktopShell?.closeApplicationBrowser?.().catch?.(() => {});
    };
    const returnToPipeline = (event) => { closeNativeApplicationBrowser(); pendingSearchNavigation.current = event.detail?.roleTitle ? { roleTitle: event.detail.roleTitle, company: event.detail.company } : { top: true }; setApplicationWorkspace(null); setDetailJob(null); };
    const returnToDetail = () => { closeNativeApplicationBrowser(); setApplicationWorkspace(null); };
    window.addEventListener('job-search-navigation', returnToPipeline); window.addEventListener('job-detail-navigation', returnToDetail);
    return () => { window.removeEventListener('job-search-navigation', returnToPipeline); window.removeEventListener('job-detail-navigation', returnToDetail); };
  }, []);
  useEffect(() => { onDetailChange?.(detailJob ? { level: 'detail', company: detailJob.company, roleTitle: detailJob.roleTitle } : null); }, [detailJob, onDetailChange]);
  useEffect(() => {
    if (missingFitBackfillStarted.current || !jobs.length || !resume?.rawText) return;
    const missing = jobs.filter((job) => !Number.isFinite(Number(job.requirementsMatchScore)) || !Number.isFinite(Number(job.candidateMatchScore)));
    missingFitBackfillStarted.current = true;
    if (!missing.length) return;
    let active = true;
    const backfill = async () => {
      setSearchMessage(`Scoring ${missing.length} pipeline job${missing.length === 1 ? '' : 's'} with the four-factor AI fit…`);
      let scored = 0;
      let failed = 0;
      for (const job of missing) {
        try {
          const evaluated = await scoreImportedJob(job, profile, resume);
          await window.desktopShell?.updateJob?.(evaluated);
          scored += 1;
        } catch {
          failed += 1;
        }
      }
      if (!active) return;
      await onRefresh?.();
      setSearchMessage(failed
        ? `Scored ${scored} pipeline job${scored === 1 ? '' : 's'}; ${failed} could not be scored.`
        : `Scored ${scored} pipeline job${scored === 1 ? '' : 's'} with the four-factor AI fit.`);
    };
    backfill().catch((cause) => { if (active) setSearchMessage(cause?.message || 'Could not backfill pipeline fit scores.'); });
    return () => { active = false; };
  }, [jobs, onRefresh, profile, resume]);
  useEffect(() => {
    if (!detailJob || applications.some((entry) => entry.jobId === detailJob.id)) return undefined;
    let active = true;
    window.desktopShell?.getJobApplicationForJob?.(detailJob.id).then((application) => {
      if (active && application) setApplications((current) => [...current.filter((entry) => entry.id !== application.id), application]);
    }).catch(() => {});
    return () => { active = false; };
  }, [detailJob?.id, applications]);

  useEffect(() => { const unsubscribe = window.desktopShell?.onJobSearchProgress?.((progress) => { if (!progress?.runId) return; const call = progress.callNumber || progress.batchNumber || 0; const total = progress.totalCalls || 0; const calls = rankingProgress.current.get(progress.runId) || new Map(); const previous = calls.get(call); if (previous?.status === 'success' && progress.status === 'started') return; calls.set(call, progress); rankingProgress.current.set(progress.runId, calls); const latestCalls = [...calls.values()]; const completed = latestCalls.filter((entry) => entry.status === 'success').length; const failed = latestCalls.filter((entry) => entry.status === 'failed').length; const active = latestCalls.filter((entry) => entry.status === 'started').length; const aggregate = completed || failed ? `${completed}/${total} complete${failed ? ` · ${failed} failed` : ''}` : `${active}/${total} in flight`; const action = progress.status === 'started' ? 'started' : progress.status === 'success' ? 'completed' : 'failed'; setSearchMessage(`OpenRouter call ${call}/${total} ${action} · ${aggregate} · ${progress.submittedCount || 0} jobs submitted · ${progress.assessedCount || 0} assessed${progress.durationMs ? ` · ${progress.durationMs} ms` : ''}`); }); Promise.all([window.desktopShell?.getJobProfile?.(), window.desktopShell?.getMasterResume?.(), window.desktopShell?.getMasterResumePdf?.(), window.desktopShell?.getJobSource?.(), window.desktopShell?.listJobApplications?.(), window.desktopShell?.getOpenRouterStatus?.()]).then(([savedProfile, savedResume, savedPdf, savedSource, savedApplications, savedAiStatus]) => { if (savedProfile) setProfile((current) => { const restored = { ...current, ...savedProfile, ...normalizeProfileLists(savedProfile) }; return { ...DEFAULT_SEARCH_PROFILE, ...restored, targetRoles: restored.targetRoles.length ? restored.targetRoles : DEFAULT_SEARCH_PROFILE.targetRoles, targetIndustries: restored.targetIndustries.length ? restored.targetIndustries : DEFAULT_SEARCH_PROFILE.targetIndustries, interests: restored.interests.length ? restored.interests : DEFAULT_SEARCH_PROFILE.interests, mustHaveSkills: restored.mustHaveSkills.length ? restored.mustHaveSkills : DEFAULT_SEARCH_PROFILE.mustHaveSkills, niceToHaveSkills: restored.niceToHaveSkills.length ? restored.niceToHaveSkills : DEFAULT_SEARCH_PROFILE.niceToHaveSkills }; }); if (savedResume) setResume(savedResume); if (savedPdf) setMasterResumePdf(savedPdf); if (savedSource) { setSource(savedSource); setSourceForm((current) => ({ ...current, usajobsEmail: savedSource.email || '' })); if (savedSource.warning) setSourceMessage(savedSource.warning); } setApplications(savedApplications || []); if (savedAiStatus) setAiStatus(savedAiStatus); }).catch((cause) => setSourceMessage(cause?.message || 'Could not load saved job-search settings.')); return () => unsubscribe?.(); }, []);

  // Keep the pipeline and document summaries synchronized with changes made by
  // the application workspace, browser assistant, or another app window.
  useEffect(() => {
    let active = true;
    const syncLiveState = async () => {
      try {
        await onRefresh?.();
        const savedApplications = await window.desktopShell?.listJobApplications?.();
        if (active && Array.isArray(savedApplications)) setApplications(savedApplications);
      } catch {}
    };
    const timer = window.setInterval(syncLiveState, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [onRefresh]);

  useEffect(() => window.desktopShell?.onJobSearchProgress?.((progress) => { if (progress?.report) setSearchReport(progress.report); }), []);

  const loadDocumentSummaries = async () => {
    const entries = await Promise.all(applications.map(async (application) => [application.id, await window.desktopShell?.listApplicationDocuments?.({ applicationId: application.id }) || []]));
    setApplicationDocuments(Object.fromEntries(entries));
  };
  useEffect(() => { loadDocumentSummaries().catch((cause) => setError(cause?.message || 'Could not load document summaries.')); }, [applications]);

  const refineSearch = async (action) => {
    if (typeof window.desktopShell?.searchJobs !== 'function') return;
    const report = { providers: (searchReport?.sourceStats || []).map((source) => ({ provider: source.key, status: source.status, retrieved: source.retrievedRaw ?? source.fetched, filtered: source.hardFilteredCount ?? source.filtered, submitted: source.aiSubmitted, selected: source.finalSelectedCount ?? source.aiReturned, displayed: source.displayedCount ?? source.shown })) };
    // Pass refinement data as an IPC argument. Mutating the contextBridge API is not
    // reliable because exposed properties may be read-only in the renderer.
    await runSearch({ appendMatches: true, refinement: { action, report } });
  };
  useEffect(() => {
    if (!searchReport) return undefined;
    const body = document.querySelector('.job-search-report-body');
    if (!body || body.querySelector('.job-search-refinements')) return undefined;
    const actions = [['more_remote', 'Show more remote roles'], ['higher_salary', 'Prioritize higher salary'], ['less_senior', 'Find less senior alternatives'], ['exclude_company', 'Exclude companies like this'], ['adjacent_roles', 'Search for adjacent roles'], ['must_haves_only', 'Only show jobs where I meet the must-haves']];
    const group = document.createElement('div'); group.className = 'job-search-refinements';
    const label = document.createElement('small'); label.textContent = 'Refine this search'; group.appendChild(label);
    actions.forEach(([nextAction, title]) => { const button = document.createElement('button'); button.className = 'secondary'; button.type = 'button'; button.textContent = title; button.addEventListener('click', () => refineSearch(nextAction)); group.appendChild(button); });
    body.prepend(group);
    return () => group.remove();
  }, [searchReport]);
  const today = new Date().toISOString().slice(0, 10);
  const visibleJobs = useMemo(() => jobs.filter((job) => (stageFilter === 'all' || job.stage === stageFilter) && `${job.company} ${job.roleTitle} ${job.location} ${job.nextAction}`.toLowerCase().includes(query.toLowerCase())).sort((left, right) => Number(preparingJobIds.has(right.id)) - Number(preparingJobIds.has(left.id))), [jobs, query, stageFilter, preparingJobIds]);
  const jobNumbers = useMemo(() => new Map([...jobs].sort((left, right) => String(left.createdAt || '').localeCompare(String(right.createdAt || '')) || String(left.id).localeCompare(String(right.id))).map((job, index) => [job.id, `#${index + 1}`])), [jobs]);
  useEffect(() => { setMatches((current) => current.map((entry) => ({ ...entry, savedToPipeline: jobs.some((saved) => String(saved.externalId || '') === String(entry.job.externalId || '') && String(saved.apiSource || saved.source || '') === String(entry.job.providerKey || '')) }))); }, [jobs]);
  const save = async () => { if (!modalJob?.company.trim() || !modalJob?.roleTitle.trim()) { setError('Company and role title are required.'); return; } setSaving(true); setError(''); try { const payload = { ...modalJob, id: modalJob.id || newPipelineJobId(), appliedAt: modalJob.appliedAt || null, followUpDate: modalJob.followUpDate || null }; const saveJob = modalJob.id ? window.desktopShell?.updateJob : window.desktopShell?.createJob; let saved = await saveJob(payload); if (!modalJob.id) { try { saved = await window.desktopShell?.updateJob(await scoreImportedJob(saved, profile, resume)); } catch (cause) { setSearchMessage(`${saved.roleTitle} was saved, but AI fit scoring was unavailable: ${cause?.message || 'unknown error'}`); } } await onRefresh(); setModalJob(null); } catch (cause) { setError(cause?.message || 'Could not save opportunity.'); } finally { setSaving(false); } };
  const saveProfile = async () => { const normalized = { ...profile, ...normalizeProfileLists(profile) }; setProfile(normalized); try { const saved = await window.desktopShell?.saveJobProfile?.(normalized); if (!saved) throw new Error('The profile could not be saved.'); setProfileOpen(false); setSearchMessage('Profile saved locally.'); return true; } catch (cause) { setProfileOpen(true); setSearchMessage(cause?.message || 'Could not save your profile locally.'); throw cause; } };
  const uploadMasterResume = async () => { setResumeBusy(true); setResumeMessage('Reading resume…'); try { const result = await window.desktopShell?.uploadMasterResume?.(); if (result?.canceled) { setResumeMessage(''); return; } setResume(result.resume); setMasterResumePdf(await window.desktopShell?.getMasterResumePdf?.() || ''); setResumeMessage(`${result.resume.sourceFilename || 'Resume document'} uploaded. Its text is available to search and tailor documents.`); } catch (cause) { setResumeMessage(cause?.message || 'Could not read that resume document.'); } finally { setResumeBusy(false); } };
  const runSearch = async (searchInput = {}) => { const appendMatches = Boolean(searchInput.appendMatches); setSearchState('loading'); setError(''); if (!appendMatches) { setMatches([]); setSearchReport(null); } setSearchMessage(searchInput.refinement ? `Finding more jobs with refinement: ${searchInput.refinement.action}…` : 'Understanding your target, searching federal job titles, and evaluating fit…'); try { await saveProfile(); const result = await window.desktopShell?.searchJobs?.(searchInput); setSearchReport(result || { ok: false, error: 'The search returned no diagnostic result.' }); if (!result?.ok) { if (result?.needsProfile) setProfileOpen(true); throw new Error(errorMessage(result, 'Search failed.')); } const matchById = new Map((result.matches || []).map((match) => [String(match.externalId), match])); setSearchReport(result); const aiAvailable = ['available', 'under_selected'].includes(result.ranking?.status); const fetchedMatches = aiAvailable ? (result.matches || []).map((match) => ({ ...match, job: match.job || (result.jobs || []).find((job) => String(job.externalId) === String(match.externalId)) })).filter((entry) => entry.job) : (result.jobs || []).map((job) => ({ job, ...(matchById.get(String(job.externalId)) || { externalId: job.externalId, fitScore: job.retrievalScore ?? null, scoreType: 'retrieval', fitTier: job.retrievalScore ? 'retrieval match' : 'not scored', strengths: job.searchEvidence?.positionTitleQuery ? [`Title: ${job.searchEvidence.positionTitleQuery}`] : [], gaps: ['AI scoring was unavailable; review the announcement.'], unknowns: [], reasoning: 'Job retrieved successfully; review it manually.' }) })); setMatches((current) => mergeRankedMatches(appendMatches ? current : [], fetchedMatches)); setSearchState('success'); const ranking = result.ranking?.status === 'under_selected' ? 'Final AI returned fewer than 20 selections.' : aiAvailable ? 'AI selections available.' : result.jobs?.length ? 'AI scoring unavailable; showing retrieved jobs using deterministic scores.' : ''; const interpretation = result.searchPlan?.interpretation ? ` ${result.searchPlan.interpretation}.` : ''; const counts = result.counts ? ` Retrieved ${result.counts.retrieved || 0} raw, ${result.counts.unique || 0} unique, ${result.counts.aiSubmitted || 0} sent to final AI, and ${result.counts.displayed ?? result.matches?.length ?? 0} displayed.` : ` Found ${result.jobs?.length || 0} relevant matches.`; setSearchMessage(result.error?.message || result.warning || `USAJOBS federal search complete.${interpretation}${counts} ${ranking}${appendMatches ? ' Existing approved matches were kept and new results were added.' : ''}`); } catch (cause) { if (!appendMatches) setMatches([]); setSearchState('error'); setSearchMessage(cause?.message || 'Search failed.'); } };
  const saveMatch = async ({ job, ...match }) => {
    const safeId = `job-${job.providerKey}-${String(job.externalId).replace(/[^A-Za-z0-9._:-]/g, '-')}`;
    const fullDescription = job.description || '';
    const roleSource = { summary: job.summary || job.jobSummary || '', duties: job.duties || '', qualifications: job.qualifications || '', requirements: job.requirements || [], education: job.education || '', benefits: job.benefits || '', travel: job.travel || '', skills: job.skills || job.jobSkills || job.requiredSkills || [], employmentType: job.employmentType || '', salary: job.salary || '', salaryMin: job.salaryMin ?? null, salaryMax: job.salaryMax ?? null, salaryCurrency: job.salaryCurrency || 'USD', remoteType: job.remoteType || '', postedAt: job.postedAt || null, expiresAt: job.expiresAt || null };
    // A final search response can contain a job without AI scores when the model
    // under-selects. Score it before persistence so the pipeline never creates a
    // blank fit panel merely because that search response was incomplete.
    let evaluatedMatch = match;
    if (!Number.isFinite(Number(match.requirementsMatchScore)) || !Number.isFinite(Number(match.candidateMatchScore))) {
      try {
        const evaluated = await scoreImportedJob({ ...job, roleTitle: job.title, description: fullDescription, rawData: roleSource, requirements: job.requirements }, profile, resume);
        evaluatedMatch = { ...match, ...evaluated, reasoning: evaluated.matchSummary || match.reasoning };
      } catch (cause) {
        setSearchMessage(`${job.title} could not be AI-scored before saving: ${cause?.message || 'unknown error'}`);
      }
    }
    const fitSummary = evaluatedMatch.reasoning || evaluatedMatch.matchSummary || 'Review the listing details and compare the requirements with your evidence.';
    try {
      // Some providers expose the employer as `agency`; the pipeline requires a company string.
      const saved = await window.desktopShell?.createJob?.({ id: safeId, company: job.company || job.agency || '', roleTitle: job.title, url: job.applicationUrl, canonicalUrl: job.canonicalUrl, location: job.location, employmentType: job.employmentType, source: job.providerKey, externalId: job.externalId, apiSource: job.providerKey, rawData: roleSource, description: fullDescription || job.description, requirements: job.requirements, postedAt: job.postedAt, expiresAt: job.expiresAt, salaryMin: job.salaryMin, salaryMax: job.salaryMax, salaryCurrency: job.salaryCurrency, remoteType: job.remoteType, matchScore: Number.isFinite(Number(evaluatedMatch.requirementsMatchScore)) && Number.isFinite(Number(evaluatedMatch.candidateMatchScore)) ? Math.min(Number(evaluatedMatch.requirementsMatchScore), Number(evaluatedMatch.candidateMatchScore)) : evaluatedMatch.fitScore, requirementsMatchScore: evaluatedMatch.requirementsMatchScore, candidateMatchScore: evaluatedMatch.candidateMatchScore, fitTier: evaluatedMatch.fitTier, matchSummary: fitSummary, notes: `Role fit summary\n${fitSummary}\n\nStrengths\n${(evaluatedMatch.strengths || []).join(', ') || 'No specific strengths were returned.'}\n\nGaps and unknowns\n${[...(evaluatedMatch.gaps || []), ...(evaluatedMatch.unknowns || [])].join(', ') || 'No specific gaps were returned.'}` });
      await onRefresh();
      setSearchMessage(`${job.title} saved to your pipeline.`);
      return saved;
    } catch (cause) {
      setSearchState('error');
      setSearchMessage(cause?.message || 'Could not save this job to your pipeline.');
      return null;
    }
  };
  const openApplication = async (job, focusDocumentType = 'resume', openAssistant = false) => { try { const application = await window.desktopShell?.startJobApplication?.({ jobId: job.id }); if (!application) throw new Error('Could not start application.');  const workspaceJob = job.stage === 'target' ? { ...job, stage: 'researching' } : job; setApplications((current) => [...current.filter((entry) => entry.id !== application.id), application]); setDetailJob(workspaceJob); setApplicationWorkspace({ application, job: workspaceJob, focusDocumentType, openAssistant }); return true; } catch (cause) { setError(cause?.message || 'Could not start application.'); return false; } };
  const refreshApplication = async () => { if (!applicationWorkspace) return; await onRefresh(); const application = await window.desktopShell?.getJobApplication?.(applicationWorkspace.application.id); if (application) { setApplications((current) => [...current.filter((entry) => entry.id !== application.id), application]); setApplicationWorkspace((current) => ({ ...current, application })); } };
  const changeDetailStage = async (stage) => { if (!detailJob) return; try { const saved = await window.desktopShell?.updateJob?.({ ...detailJob, stage }); setDetailJob(saved); await onRefresh(); if (stage === 'applied' && !applications.some((entry) => entry.jobId === saved.id)) { const application = await window.desktopShell?.startJobApplication?.({ jobId: saved.id }); if (application) setApplications((current) => [...current.filter((entry) => entry.id !== application.id), application]); } } catch (cause) { setError(cause?.message || 'Could not update the application stage.'); } };
  const saveSource = async () => { try { const result = await window.desktopShell?.saveJobSource?.(sourceForm); setSource(result); setSourceForm(emptySourceForm()); setSourceMessage(result?.warning || 'Job-source credentials saved securely on this computer.'); } catch (cause) { setSourceMessage(cause?.message || 'Could not save job-source credentials.'); } };
  const testSource = async () => { setSourceTesting(true); try { const result = await window.desktopShell?.testJobSource?.(); const results = result?.results || [result]; setSourceMessage(results.map((entry) => `${entry.provider || 'Source'}: ${entry.ok ? `connected (${entry.count || 0} results)` : entry.message || 'failed'}`).join(' · ')); } catch (cause) { setSourceMessage(cause?.message || 'Could not test job sources.'); } finally { setSourceTesting(false); } };
  const clearSource = async () => { const result = await window.desktopShell?.clearJobSource?.(); setSource(result); setSourceForm(emptySourceForm()); setSourceMessage('Job-source credentials cleared from this computer.'); };
  const saveAiKey = async () => { try { const result = await window.desktopShell?.saveOpenRouterApiKey?.(aiKey); setAiStatus(result); setAiKey(''); setAiMessage('OpenRouter key saved securely on this computer.'); } catch (cause) { setAiMessage(cause?.message || 'Could not save the OpenRouter key.'); } };
  const clearAiKey = async () => { const result = await window.desktopShell?.clearOpenRouterApiKey?.(); setAiStatus(result); setAiMessage('Saved OpenRouter key cleared.'); };
  const dueCount = jobs.filter((job) => stageIndex(job.stage) >= stageIndex('applied') && job.followUpDate && job.followUpDate <= today && !['accepted', 'rejected'].includes(job.stage)).length;

  useEffect(() => {
    // Keep the notification badge in the existing card layout without making
    // the board markup depend on optional fields from older job records.
    document.querySelectorAll('.job-card-notifications').forEach((node) => node.remove());
    document.querySelectorAll('.job-card-contact').forEach((node) => node.remove());
    // Keep the stable reference number and board name in the header so the
    // card remains readable even when older records do not have source data.
    [...document.querySelectorAll('.job-card-top > b')].forEach((title) => {
      const card = title.closest('.job-card');
      const company = card?.querySelector('strong')?.textContent || '';
      const job = jobs.find((entry) => entry.roleTitle === title.textContent && entry.company === company);
      if (job) { title.dataset.jobNumber = jobNumbers.get(job.id) || '#—'; title.dataset.jobBoard = jobBoardLabel(job); }
    });
    jobs.forEach((job) => {
      const voiceAssignment = [job.googleVoiceContactName, displayPhoneNumber(job.googleVoicePhoneNumber)].filter(Boolean).join(' · ');
      if (!(job.unreadVoiceActivityCount > 0 || job.unreadEmailCount > 0 || voiceAssignment)) return;
      const card = [...document.querySelectorAll('.job-card')].find((entry) => entry.querySelector('.job-card-top > b')?.textContent === job.roleTitle && entry.querySelector('strong')?.textContent === job.company);
      const top = card?.querySelector('.job-card-top');
      if (!top) return;
      const badge = document.createElement('div');
      badge.className = 'job-card-notifications';
      badge.setAttribute('aria-label', `${job.unreadVoiceActivityCount || 0} new Voice message or call${job.unreadVoiceActivityCount === 1 ? '' : 's'}, ${job.unreadEmailCount || 0} new email${job.unreadEmailCount === 1 ? '' : 's'}`);
      badge.innerHTML = `${job.unreadVoiceActivityCount > 0 ? `<span class="job-card-notification voice">${job.unreadVoiceActivityCount} new Voice</span>` : ''}${job.unreadEmailCount > 0 ? `<span class="job-card-notification email">${job.unreadEmailCount} new email${job.unreadEmailCount === 1 ? '' : 's'}</span>` : ''}`;
      if (voiceAssignment) { const assignment = document.createElement('span'); assignment.className = 'job-card-voice-assignment'; assignment.textContent = voiceAssignment; badge.append(assignment); }
      top.insertAdjacentElement('afterend', badge);
    });
    jobs.forEach((job) => {
      const card = [...document.querySelectorAll('.job-card')].find((entry) => entry.querySelector('.job-card-top > b')?.textContent === job.roleTitle && entry.querySelector('strong')?.textContent === job.company);
      if (!card) return;
      const contact = document.createElement('div'); contact.className = 'job-card-contact';
      const phone = document.createElement('span'); phone.textContent = displayPhoneNumber(job.googleVoicePhoneNumber) || '###';
      contact.append(phone);
      if (job.linkedEmailCount > 0) {
        const mail = document.createElement('span'); mail.className = `job-card-mail-icon${job.unreadEmailCount > 0 ? ' unread' : ''}`; mail.setAttribute('aria-label', job.unreadEmailCount > 0 ? 'Unread email' : 'Email assigned'); mail.textContent = '✉'; contact.append(mail);
      }
      card.querySelector('select')?.insertAdjacentElement('beforebegin', contact);
    });
    return () => { document.querySelectorAll('.job-card-notifications, .job-card-contact').forEach((node) => node.remove()); document.querySelectorAll('.job-card-top > b').forEach((title) => { delete title.dataset.jobNumber; delete title.dataset.jobBoard; }); };
  }, [jobs, detailJob]);

  useEffect(() => {
    // Rebind after the detail view replaces the board nodes so returning to the pipeline keeps job titles clickable.
    const titles = [...document.querySelectorAll('.jobs-board .job-card-top > b')];
    const listeners = titles.map((title) => {
      const openDetails = () => {
        const card = title.closest('.job-card');
        const company = card?.querySelector('strong')?.textContent || '';
        const job = jobs.find((entry) => entry.roleTitle === title.textContent && entry.company === company);
        if (job) setDetailJob(job);
      };
      title.classList.add('job-card-title');
      title.addEventListener('click', openDetails);
      return [title, openDetails];
    });
    return () => listeners.forEach(([title, listener]) => { title.classList.remove('job-card-title'); title.removeEventListener('click', listener); });
  }, [jobs, detailJob]);

  useEffect(() => {
    const navigation = pendingSearchNavigation.current;
    if (!navigation || detailJob) return;
    pendingSearchNavigation.current = null;
    requestAnimationFrame(() => {
      if (navigation.top) {
        document.querySelector('.main-scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      [...document.querySelectorAll('.job-card')].find((card) => card.textContent.includes(navigation.roleTitle) && card.textContent.includes(navigation.company))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [detailJob, jobs]);

  if (detailJob) {
    const currentJob = jobs.find((job) => job.id === detailJob.id) || detailJob;
    const application = applications.find((entry) => entry.jobId === currentJob.id);
    // Keep the detail workspace mounted behind the modal so closing edit returns to the job the user was viewing.
    return <><JobDetailsWorkspace job={currentJob} profile={profile} resume={resume} application={application} documents={applicationDocuments[application?.id] || []} applicationAssistantOpen={Boolean(applicationWorkspace?.openAssistant)} onBack={() => window.dispatchEvent(new CustomEvent('job-search-navigation'))} onEdit={() => setModalJob(currentJob)} onStartApplication={() => openApplication(currentJob, 'resume', true)} workflowQueue={workflowQueueStatus} workflowQueueStarting={automationQueueStarting} onStartWorkflow={startWorkflowQueue} onPauseWorkflow={pauseWorkflowQueue} onOpenWorkflowJob={openWorkflowJob} onAnswerWorkflowQuestion={openAutomationAnswerModal} onRetryWorkflow={releaseAutomationApplication} onOpenApplicationAssistant={() => openApplication(currentJob, 'resume', true)} onCloseApplicationAssistant={() => setApplicationWorkspace(null)} onRefresh={refreshApplication} onJobUpdated={async (saved) => { setDetailJob(saved); await onRefresh(); }} onActivitySeen={onRefresh} onStageChange={changeDetailStage} onOpenAiSettings={() => { setDetailJob(null); setProfileOpen(true); setAiMessage('Add an OpenRouter API key to enable Ask AI.'); }} />{modalJob && <JobModal job={currentJob} saving={saving} error={error} onChange={setModalJob} onCancel={() => setModalJob(null)} onSave={save} />}</>;
  }

  const documentSummary = (job) => { const application = applications.find((entry) => entry.jobId === job.id); if (!application) return <button className="secondary" onClick={() => openApplication(job, 'resume', true)}>Open application assistant</button>; const documents = applicationDocuments[application.id] || []; return <><small>Application: {application.status.replaceAll('_', ' ')}</small>{['resume', 'cover_letter'].map((documentType) => { const document = documents.find((entry) => entry.documentType === documentType); return <small key={documentType}>{label(documentType)}: {document ? `v${document.version} · ${document.status.replaceAll('_', ' ')}${document.isSelected ? ' · selected' : ''}${document.exportedPdfPath || document.exportedTextPath ? ' · exported' : ''} · updated ${new Date(document.updatedAt).toLocaleDateString()}` : 'not generated'}</small>; })}<button className="secondary" onClick={() => openApplication(job, 'resume', true)}>{job.linkedEmailCount > 0 && <Mail size={13} aria-label="Email assigned" />}Open application assistant</button></>; };
  /* Legacy Stage 1 checkpoint panel retained for reference during the autopilot rollout.
  const autonomousPanel = <section className="jobs-preparation-panel autonomous-application-panel" aria-live="polite"><div className="jobs-preparation-main"><div className={`jobs-preparation-indicator${automationQueueStatus.counts.active && !automationQueueStatus.paused ? ' active' : ''}`}>{automationQueueStatus.counts.active && !automationQueueStatus.paused ? <LoaderCircle size={18} /> : <Check size={18} />}</div><div className="jobs-preparation-copy"><span className="eyebrow">AUTONOMOUS APPLICATION QUEUE · {automationQueueStatus.paused ? 'PAUSED' : 'READY'}</span><h3>{automationQueueStatus.counts.needsUserAnswer ? 'Needs your answer' : automationQueueStatus.counts.failed ? 'Needs retry review' : automationQueueStatus.counts.blocked ? 'Blocked listings need review' : automationQueueStatus.counts.eligible ? 'Ready to checkpoint' : automationQueueStatus.counts.active ? 'Stage 1 checkpoint active' : 'No eligible applications'}</h3><p>{automationQueueStatus.message || 'Stage 1 selects one eligible Ready to apply application at a time. Browser execution begins in Stage 2.'}</p></div></div><div className="jobs-preparation-controls"><button className="primary" onClick={startAutomationQueue} disabled={automationQueueStarting || !automationQueueStatus.counts.eligible}><Play size={13} /> {automationQueueStarting ? 'Starting checkpoint…' : 'Checkpoint next'}</button><button className="secondary" onClick={pauseAutomationQueue} disabled={automationQueueStarting || automationQueueStatus.paused}><Pause size={13} /> Pause</button></div><div className="jobs-preparation-counts"><span><b>{automationQueueStatus.counts.eligible}</b> eligible</span><span><b>{automationQueueStatus.counts.active}</b> active</span><button className="secondary" onClick={openFirstAutomationAnswer}><b>{automationQueueStatus.counts.needsUserAnswer}</b> need answers</button><span><b>{automationQueueStatus.counts.failed}</b> failed</span><span><b>{automationQueueStatus.counts.blocked}</b> blocked</span><span><b>{automationQueueStatus.counts.total}</b> ready jobs</span></div><button className="secondary jobs-preparation-queue-toggle" onClick={() => setAutomationQueueOpen((open) => !open)}>{automationQueueOpen ? 'Hide review queue' : 'View review queue'}</button>{automationQueueOpen && <div className="jobs-preparation-queue">{automationReviewQueue.length ? automationReviewQueue.map((entry) => <div key={entry.applicationId}><div className="autonomous-queue-row"><button onClick={() => { const job = jobs.find((candidate) => candidate.id === entry.jobId); if (entry.automationState === 'needs_user_answer') openAutomationAnswerModal(entry); else setDetailJob(job || null); }}><span>{entry.company} — {entry.roleTitle}</span><small>{entry.automationState.replaceAll('_', ' ')} · {entry.adapterKey || 'generic'} · {entry.adapterMode || 'generic-safe'}{entry.confidence ? ` · confidence ${Math.round(entry.confidence * 100)}%` : ''}{entry.answerPolicyMode ? ` · answers ${entry.answerPolicyMode}` : ''}{entry.calculatedSalary ? ` · salary $${entry.calculatedSalary}` : ''}{entry.pauseReason ? ` · paused: ${entry.pauseReason}` : ''}{entry.automationCheckpoint?.answerReadyForRetry ? ' · answer saved, ready to retry' : ''}{entry.automationCheckpoint?.reasonCode === 'job_listing_unavailable' ? ' · listing no longer available' : ''}{!entry.eligible ? ` · ${entry.ineligibleReason}` : ''}</small></button>{(entry.automationState === 'failed' || (entry.automationState === 'queued' && entry.automationCheckpoint?.answerReadyForRetry === true)) && <button className="secondary autonomous-retry-button" disabled={automationRetryingIds.has(entry.applicationId)} onClick={(event) => { event.stopPropagation(); releaseAutomationApplication(entry); }}>{automationRetryingIds.has(entry.applicationId) ? 'Retrying…' : 'Retry'}</button>}{(entry.automationState === 'needs_user_answer' || entry.unknownQuestions?.some((question) => !String(question.questionKey || '').startsWith('checkpoint:'))) && <button className="secondary autonomous-answer-button" onClick={(event) => { event.stopPropagation(); openAutomationAnswerModal(entry); }}>Answer</button>}</div>{entry.unknownQuestions?.map((question) => <div className="autonomous-unknown-question" key={question.id}><b>{question.questionText || question.controlLabel}</b><small>{question.providerHost || 'Provider unknown'} · {question.controlType || 'field'}</small><input value={automationAnswers[question.id] ?? answerSuggestionFor(entry, question)} onChange={(event) => setAutomationAnswers((current) => ({ ...current, [question.id]: event.target.value }))} placeholder="Approved reusable answer" /><button className="secondary" disabled={!String(automationAnswers[question.id] ?? answerSuggestionFor(entry, question)).trim()} onClick={() => resolveAutomationQuestion(question, answerSuggestionFor(entry, question))}>Save answer and return to queue</button></div>)}</div>) : <small>No failed or user-assistance applications need review.</small>}</div>}{automationAnswerModal && <AutomationAnswerModal entry={automationAnswerModal.entry} question={automationAnswerModal.question} answerText={automationAnswers[automationAnswerModal.question?.id] ?? answerSuggestionFor(automationAnswerModal.entry, automationAnswerModal.question)} saving={automationAnswerSaving} error={automationAnswerError} onChange={(value) => setAutomationAnswers((current) => ({ ...current, [automationAnswerModal.question?.id]: value }))} onCancel={() => { if (!automationAnswerSaving) setAutomationAnswerModal(null); }} onSave={saveAutomationModalAnswer} />}</section>;
  */
  const autonomousPanel = <section className="jobs-preparation-panel autonomous-application-panel" aria-live="polite"><div className="jobs-preparation-main"><div className={`jobs-preparation-indicator${automationQueueStatus.counts.active && !automationQueueStatus.paused ? ' active' : ''}`}>{automationQueueStatus.counts.active && !automationQueueStatus.paused ? <LoaderCircle size={18} /> : <Check size={18} />}</div><div className="jobs-preparation-copy"><span className="eyebrow">AUTONOMOUS APPLICATION QUEUE · {automationQueueStatus.paused ? 'PAUSED' : automationQueueStatus.autopilot ? 'AUTOPILOT' : 'READY'}</span><h3>{automationQueueStatus.counts.needsUserAnswer ? 'Needs your answer' : automationQueueStatus.counts.failed ? 'Needs retry review' : automationQueueStatus.counts.active ? 'Autopilot is working' : automationQueueStatus.counts.eligible ? 'Ready to run' : 'No eligible applications'}</h3><p>{automationQueueStatus.message || 'Run Autopilot completes eligible applications one at a time and verifies email separately.'}</p></div></div><div className="jobs-preparation-controls"><button className="primary" onClick={startAutomationQueue} disabled={automationQueueStarting || !automationQueueStatus.counts.eligible}><Play size={13} /> {automationQueueStarting ? 'Starting autopilot…' : 'Run Autopilot'}</button><button className="secondary" onClick={pauseAutomationQueue} disabled={automationQueueStatus.paused}><Pause size={13} /> Pause</button></div><div className="jobs-preparation-counts"><span><b>{automationQueueStatus.counts.eligible}</b> eligible</span><span><b>{automationQueueStatus.counts.active}</b> active</span><button className="secondary" onClick={openFirstAutomationAnswer}><b>{automationQueueStatus.counts.needsUserAnswer}</b> need answers</button><span><b>{automationQueueStatus.counts.awaitingEmail || 0}</b> awaiting email</span><span><b>{automationQueueStatus.counts.failed}</b> failed</span><span><b>{automationQueueStatus.counts.blocked}</b> blocked</span></div><button className="secondary jobs-preparation-queue-toggle" onClick={() => setAutomationQueueOpen((open) => !open)}>{automationQueueOpen ? 'Hide review queue' : 'View review queue'}</button>{automationQueueOpen && <div className="jobs-preparation-queue">{automationReviewQueue.length ? automationReviewQueue.map((entry) => <div className="autonomous-queue-row" key={entry.applicationId}><button onClick={() => { const job = jobs.find((candidate) => candidate.id === entry.jobId); if (entry.automationState === 'needs_user_answer') openAutomationAnswerModal(entry); else setDetailJob(job || null); }}><span>{entry.company} — {entry.roleTitle}</span><small>{entry.automationState.replaceAll('_', ' ')}{entry.pauseReason ? ` · ${entry.pauseReason}` : ''}</small></button>{(entry.automationState === 'failed' || (entry.automationState === 'queued' && entry.automationCheckpoint?.answerReadyForRetry === true)) && <button className="secondary autonomous-retry-button" disabled={automationRetryingIds.has(entry.applicationId)} onClick={(event) => { event.stopPropagation(); releaseAutomationApplication(entry); }}>{automationRetryingIds.has(entry.applicationId) ? 'Retrying…' : 'Retry'}</button>}{entry.automationState === 'needs_user_answer' && <button className="secondary autonomous-answer-button" onClick={(event) => { event.stopPropagation(); openAutomationAnswerModal(entry); }}>Answer</button>}</div>) : <small>No failed or user-assistance applications need review.</small>}</div>}{automationAnswerModal && <AutomationAnswerModal entry={automationAnswerModal.entry} question={automationAnswerModal.question} answerText={automationAnswers[automationAnswerModal.question?.id] ?? answerSuggestionFor(automationAnswerModal.entry, automationAnswerModal.question)} saving={automationAnswerSaving} error={automationAnswerError} onChange={(value) => setAutomationAnswers((current) => ({ ...current, [automationAnswerModal.question?.id]: value }))} onCancel={() => { if (!automationAnswerSaving) setAutomationAnswerModal(null); }} onSave={saveAutomationModalAnswer} />}</section>;
   // Keep the notification mounted only at the page level; pipeline cards scroll and transform on hover.
  const preparationPanel = <>{autonomousPanel}<section className="jobs-preparation-panel" aria-live="polite"><div className="jobs-preparation-main"><div className={`jobs-preparation-indicator${preparationJob ? ' active' : ''}`}>{preparationJob ? <LoaderCircle size={18} /> : <Check size={18} />}</div><div className="jobs-preparation-copy"><span className="eyebrow">APPLICATION QUEUE · {preparationPaused ? 'PAUSED' : 'RUNNING'}</span>{preparationJob ? <><h3>{preparationJob.company} — {preparationJob.roleTitle}</h3><p>{preparationPaused ? 'Pause requested; finishing the current safe step.' : formatPreparationStep(preparationStep)} · one job at a time</p></> : <><h3>{preparationBlocked.length ? 'Paused: needs attention' : preparationCounts.remaining ? 'Ready to start' : 'Queue complete'}</h3><p>{preparationBlocked.length ? 'Failed jobs are stopped until you review and retry them deliberately.' : preparationCounts.remaining ? 'Start runs one job at a time and stops after the queue is drained.' : 'Every queued job has completed or needs attention.'}</p></>}</div>{preparationJob && <button className="secondary" onClick={() => setDetailJob(preparationJob)}>Open job</button>}</div><div className="jobs-preparation-controls"><button className="primary" onClick={startPreparationQueue} disabled={preparationRunning && !preparationPaused || !preparationCounts.remaining}><Play size={13} /> Start</button><button className="secondary" onClick={pausePreparationQueue} disabled={preparationPaused && !preparationJob}><Pause size={13} /> Pause</button></div><div className="jobs-preparation-counts"><span><b>{preparationCounts.completed}</b> completed</span><span><b>{preparationCounts.failed}</b> failed</span><span><b>{preparationCounts.remaining}</b> remaining</span><span><b>{preparationCounts.queued}</b> queued</span></div><p className="jobs-preparation-progress">Progress: {preparationCounts.completed + preparationCounts.failed} of {preparationCounts.total} finished · {preparationCounts.remaining} left</p><button className="secondary jobs-preparation-queue-toggle" onClick={() => setPreparationQueueOpen((open) => !open)}>{preparationQueueOpen ? 'Hide queue' : 'View queue'}</button>{preparationQueueOpen && <div className="jobs-preparation-queue"><div><b>Up next</b>{preparationUpNext.length ? preparationUpNext.slice(0, 8).map((job) => <button key={job.id} onClick={() => setDetailJob(job)}><span>{job.company} — {job.roleTitle}</span><small>{job.stage === 'researching' ? 'Researching' : 'Target'}</small></button>) : <small>Queue is empty.</small>}</div>{preparationBlocked.length > 0 && <div><b>Failed · needs attention</b>{preparationBlocked.map(({ job, message }) => <button key={job.id} onClick={() => setDetailJob(job)}><span>{job.company} — {job.roleTitle}</span><small>{message}</small></button>)}</div>}</div>}</section></>;
  return <section className="jobs-view"><VoiceTestPanel /><div className="jobs-intro"><div><span className="eyebrow">COMMAND CENTER · CAREER</span><h2>Find work that fits the evidence.</h2><p>Four-source search with deterministic filtering and final AI selection. Fit is not a hiring probability.</p></div><div className="jobs-actions"><button className="primary" onClick={runSearch} disabled={searchState === 'loading'}><Sparkles size={15} /> {searchState === 'loading' ? 'Searching…' : 'Find up to 20 jobs'}</button><button className="secondary" onClick={() => setProfileOpen(true)}>Profile & resume</button><button className="secondary" onClick={() => { setError(''); setModalJob(emptyJob()); }}><Plus size={15} /> Add opportunity</button></div></div>{searchMessage && <div className={`job-search-status ${searchState}`}>{searchMessage}</div>}{searchReport && <details className="job-search-report" open><summary><b>Advanced search report</b><span>{searchReport.provider?.label || 'Multiple job sources'} · {searchReport.counts?.requests || searchReport.requestCount || 0} requests · {searchReport.counts?.unique || searchReport.fetchedCount || 0} unique · {searchReport.counts?.displayed ?? searchReport.matches?.length ?? 0} shown</span></summary><div className="job-search-report-body"><small>Open a provider or API call below to inspect every request, its parameters and data, and the first two jobs returned.</small>{searchReport.sourceStats?.map((item) => <small key={item.key}>{item.provider}: {item.status || 'unknown'} · {item.requestsAttempted ?? item.requests ?? 0} requests · {item.retrievedRaw ?? item.fetched ?? 0} raw · {item.uniqueCount ?? item.unique ?? 0} unique · {item.deterministicTopCount ?? item.aiSubmitted ?? 0} sent · {item.finalSelectedCount ?? item.aiReturned ?? 0} selected · {item.displayedCount ?? item.shown ?? 0} displayed · {item.errors || 0} failed{item.failures?.length ? ` · ${item.failures.join('; ')}` : ''}</small>)}{searchReport.sourceStats?.map((item) => <SearchSourceReport key={item.key} item={item} attempts={searchReport.attemptsDiagnostics || searchReport.diagnostics?.attempts || []} />)}<RankingReport ranking={searchReport.ranking || { status: 'unavailable', error: { code: 'missing_ranking_data', message: 'No ranking diagnostic object was returned.' } }} batches={searchReport.rankingBatches || []} /><ApiCallReport calls={searchReport.apiCalls || []} /><small>AI-generated provider searches: {(searchReport.attemptsDiagnostics || searchReport.diagnostics?.attempts || []).map((item) => `${item.provider}: ${item.query || 'default'}${item.location ? ` (${item.location})` : ''}`).join(' · ') || 'none'}</small></div></details>}{profileOpen && <div className="job-profile-panel"><div className="job-modal-head"><div><span className="eyebrow">LOCAL JOB SEARCH PROFILE</span><h2>Search preferences</h2></div><button className="close" onClick={() => setProfileOpen(false)}><X size={18} /></button></div><div className="job-form-grid">{profileField(profile, setProfile, 'targetRoles', 'Target roles or rough intent')}{profileField(profile, setProfile, 'targetLocations', 'US locations')}{profileField(profile, setProfile, 'targetIndustries', 'Industries')}{profileField(profile, setProfile, 'interests', 'Interests')}{profileField(profile, setProfile, 'mustHaveSkills', 'Must-have skills')}{profileField(profile, setProfile, 'niceToHaveSkills', 'Nice-to-have skills')}{profileField(profile, setProfile, 'excludedKeywords', 'Exclude terms')}<label className="job-field"><span>Remote preference</span><select value={profile.remotePreference || 'any'} onChange={(event) => setProfile({ ...profile, remotePreference: event.target.value })}>{['any', 'remote', 'hybrid', 'onsite'].map((value) => <option key={value}>{value}</option>)}</select></label><label className="job-field"><span>Search radius (miles)</span><input type="number" min="0" max="100" value={profile.radiusMiles || ''} onChange={(event) => setProfile({ ...profile, radiusMiles: event.target.value ? Number(event.target.value) : null })} /></label><label className="job-field"><span>Minimum salary</span><input type="number" value={profile.minimumSalary || ''} onChange={(event) => setProfile({ ...profile, minimumSalary: event.target.value ? Number(event.target.value) : null })} /></label></div><section className="job-source-settings master-resume-upload"><div><span className="eyebrow">MASTER RESUME</span><h3>{resume.sourceFilename || 'No resume PDF or DOCX uploaded'}</h3><p>Upload a PDF or DOCX. The app extracts its text for search and document generation, while the original stays read-only here.</p><small className="job-source-message">Source file: {masterResumePath?.sourcePath || 'No master resume file uploaded'}</small></div><div className="job-source-actions"><button className="secondary" disabled={resumeBusy} onClick={uploadMasterResume}><FileText size={14} /> {resumeBusy ? 'Reading PDF…' : resume.sourceFilename ? 'Replace PDF or DOCX' : 'Upload PDF or DOCX'}</button></div>{resumeMessage && <small className="job-source-message">{resumeMessage}</small>}{masterResumePdf && <iframe className="master-resume-viewer" title="Master resume PDF preview" src={masterResumePdf} />}</section><section className="job-source-settings"><div><span className="eyebrow">AI PROVIDER</span><h3>OpenRouter</h3><p>{aiStatus.configured ? 'Configured for email interpretation, job search, and document generation.' : 'Add an OpenRouter API key to enable Ask AI and other AI-assisted job features. The key is encrypted locally.'}</p></div><div className="job-source-actions"><input type="password" value={aiKey} onChange={(event) => setAiKey(event.target.value)} placeholder={aiStatus.configured ? savedCredentialPlaceholder : 'Enter OpenRouter API key'} aria-label="OpenRouter API key" /><button className="secondary" onClick={saveAiKey} disabled={!aiKey.trim()}>Save key</button><button className="secondary" onClick={clearAiKey} disabled={!aiStatus.configured || aiStatus.environmentConfigured}>Clear</button></div>{aiMessage && <small className="job-source-message">{aiMessage}</small>}</section><section className="job-source-settings"><div>{source.warning && <small className="job-source-warning">{source.warning}</small>}<span className="eyebrow">JOB SOURCES</span><h3>USAJOBS and Adzuna</h3><p>Credentials stay in the Electron main process and are encrypted when supported.</p></div><div className="job-form-grid"><label className="job-field"><span>USAJOBS email</span><input type="email" value={sourceForm.usajobsEmail} onChange={(event) => setSourceForm({ ...sourceForm, usajobsEmail: event.target.value })} /></label><label className="job-field"><span>USAJOBS API key</span><input type="password" value={sourceForm.usajobsApiKey} onChange={(event) => setSourceForm({ ...sourceForm, usajobsApiKey: event.target.value })} /></label><label className="job-field"><span>Adzuna app ID</span><input placeholder={source.adzunaConfigured ? savedCredentialPlaceholder : 'Enter Adzuna app ID'} value={sourceForm.adzunaAppId} onChange={(event) => setSourceForm({ ...sourceForm, adzunaAppId: event.target.value })} /></label><label className="job-field"><span>Adzuna API key</span><input type="password" placeholder={source.adzunaConfigured ? savedCredentialPlaceholder : 'Enter Adzuna API key'} value={sourceForm.adzunaApiKey} onChange={(event) => setSourceForm({ ...sourceForm, adzunaApiKey: event.target.value })} /></label></div><div className="job-source-actions"><span>USAJOBS or Adzuna credentials may be configured.</span><button className="secondary" onClick={saveSource} disabled={!(sourceForm.usajobsEmail && sourceForm.usajobsApiKey) && !(sourceForm.adzunaAppId && sourceForm.adzunaApiKey)}>Save credentials</button><button className="secondary" onClick={testSource} disabled={sourceTesting}>{sourceTesting ? "Testing..." : "Test connection"}</button><button className="secondary" onClick={clearSource}>Clear</button></div>{sourceMessage && <small className="job-source-message">{sourceMessage}</small>}</section><button className="primary" onClick={saveProfile}><Check size={14} /> Save locally</button></div>}{matches.length > 0 && <section className="job-matches"><div className="section-head compact"><div><h2>Top job matches</h2><p>Review the evidence, gaps, and closing date before saving.</p></div></div><div className="job-match-list">{matches.map((entry) => <MatchCard key={entry.job.externalId} entry={entry} onSave={saveMatch} />)}</div></section>}<div className="jobs-stats"><div><label>ACTIVE SEARCH</label><b>{jobs.filter((job) => !['accepted', 'rejected'].includes(job.stage)).length}</b><small>opportunities in motion</small></div><div><label>INTERVIEWS</label><b>{jobs.filter((job) => ['screen', 'interviewing', 'final'].includes(job.stage)).length}</b><small>screening or interviewing</small></div><div><label>FOLLOW-UPS DUE</label><b>{dueCount}</b><small>today or overdue</small></div><div><label>OFFERS</label><b>{jobs.filter((job) => job.stage === 'offer').length}</b><small>offers to evaluate</small></div></div><div className="jobs-toolbar"><label className="board-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company, role, location…" /></label><select value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}><option value="all">All stages</option>{JOB_STAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="jobs-pipeline-shell"><ApplicationQueueDrawer status={workflowQueueStatus} currentApplicationId={workflowQueueStatus.activeApplicationId} starting={automationQueueStarting} onStart={startWorkflowQueue} onPause={pauseWorkflowQueue} onOpenJob={openWorkflowJob} onAnswer={openAutomationAnswerModal} onRetry={releaseAutomationApplication} />{!jobs.length ? <div className="jobs-empty"><BriefcaseBusiness size={24} /><h3>Your pipeline is empty</h3><p>Run a search or add a target role to start.</p></div> : <div className="jobs-board">{JOB_STAGES.map(([stage, label]) => <section className="job-column" key={stage}><div className="job-column-head"><span>{label}</span><b>{visibleJobs.filter((job) => job.stage === stage).length}</b></div><div className="job-column-list">{visibleJobs.filter((job) => job.stage === stage).map((job) => <article className={`job-card priority-${job.priority}`} key={job.id}><div className="job-card-top"><b>{job.roleTitle}</b>{preparingJobIds.has(job.id) && <span className="job-card-preparing" title="Preparing application" aria-label="Preparing application"><LoaderCircle size={13} /></span>}<button onClick={() => setModalJob(job)}><Pencil size={13} /></button></div><strong>{job.company}</strong><small><span className="job-source-badge">{job.source || job.apiSource || 'Unknown source'}</span> · {job.location || 'Location not set'}</small><select value={job.stage} disabled={stageBusyId === job.id} onChange={(event) => changeBoardStage(job, event.target.value)}>{JOB_CARD_STAGE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>{documentSummary(job)}{preparationBlockers[job.id] && <small className="job-card-preparation-blocker">{preparationBlockers[job.id]}</small>}<button className="delete-job" onClick={async () => { if (window.confirm(`Archive ${job.roleTitle} at ${job.company}?`)) { await window.desktopShell?.updateJobStage?.({ jobId: String(job.id), stage: 'rejected' }); await onRefresh(); } }}><Trash2 size={12} /> Archive</button></article>)}</div></section>)}</div>}</div>{modalJob && <JobModal job={modalJob} saving={saving} error={error} onChange={setModalJob} onCancel={() => setModalJob(null)} onSave={save} />}</section>;
}

export { normalizeProfileLists, EmailMonitorPanel };
