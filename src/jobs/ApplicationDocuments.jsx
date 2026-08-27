import React, { useEffect, useState } from 'react';

const label = (type) => type === 'resume' ? 'Resume' : 'Cover letter';
const claimText = (value) => value && typeof value === 'object' ? value.text || '' : value || '';
const clone = (value) => JSON.parse(JSON.stringify(value || {}));
const isInternalResumeHeading = (value) => /^(?:master\s+resume|resume(?:\s*[-–—:]?\s*(?:v(?:ersion)?\.?\s*)?\d+)?)$/i.test(String(value || '').trim());

function updatePath(content, path, value) {
  const next = clone(content); let target = next;
  for (let index = 0; index < path.length - 1; index += 1) target = target[path[index]];
  const key = path[path.length - 1]; const current = target[key];
  // Preserve evidence IDs while the candidate edits wording; validation in the
  // main process remains the authority that decides whether approval is safe.
  target[key] = current && typeof current === 'object' && !Array.isArray(current) ? { ...current, text: value } : value;
  return next;
}

function ClaimField({ content, path, label: fieldLabel, multiline = false, onChange, readOnly = false }) {
  const value = path.reduce((current, key) => current?.[key], content);
  const props = { value: claimText(value), readOnly, disabled: readOnly, onChange: (event) => onChange(updatePath(content, path, event.target.value)) };
  return <label className="job-field"><span>{fieldLabel}</span>{multiline ? <textarea rows="3" {...props} /> : <input {...props} />}</label>;
}

function ResumeEditor({ content, onChange, readOnly = false }) {
  return <div className="application-document-editor"><ClaimField content={content} path={['headline']} label="Headline" onChange={onChange} readOnly={readOnly} />
    <section><h4>Summary</h4>{(content.summary || []).map((_, index) => <ClaimField key={index} content={content} path={['summary', index]} label={`Summary point ${index + 1}`} multiline onChange={onChange} readOnly={readOnly} />)}</section>
    <section><h4>Skills</h4>{(content.skills || []).map((_, index) => <ClaimField key={index} content={content} path={['skills', index]} label={`Skill ${index + 1}`} onChange={onChange} readOnly={readOnly} />)}</section>
    <section><h4>Experience</h4>{(content.experience || []).map((experience, index) => <div className="job-profile-panel" key={index}><ClaimField content={content} path={['experience', index, 'title']} label="Title" onChange={onChange} readOnly={readOnly} /><ClaimField content={content} path={['experience', index, 'company']} label="Company" onChange={onChange} readOnly={readOnly} /><ClaimField content={content} path={['experience', index, 'dates']} label="Dates" onChange={onChange} readOnly={readOnly} />{(experience.bullets || []).map((_, bulletIndex) => <ClaimField key={bulletIndex} content={content} path={['experience', index, 'bullets', bulletIndex]} label={`Achievement ${bulletIndex + 1}`} multiline onChange={onChange} readOnly={readOnly} />)}</div>)}</section>
    <section><h4>Education</h4>{(content.education || []).map((_, index) => <ClaimField key={index} content={content} path={['education', index]} label={`Education ${index + 1}`} onChange={onChange} readOnly={readOnly} />)}</section>
  </div>;
}

function CoverLetterEditor({ content, onChange, readOnly = false }) {
  return <div className="application-document-editor"><ClaimField content={content} path={['recipient']} label="Recipient" onChange={onChange} readOnly={readOnly} /><ClaimField content={content} path={['subject']} label="Subject" onChange={onChange} readOnly={readOnly} /><section><h4>Letter</h4>{(content.paragraphs || []).map((_, index) => <ClaimField key={index} content={content} path={['paragraphs', index]} label={`Paragraph ${index + 1}`} multiline onChange={onChange} readOnly={readOnly} />)}</section><ClaimField content={content} path={['closing']} label="Closing" multiline onChange={onChange} readOnly={readOnly} /></div>;
}

function ResumePreview({ content }) {
  return <article className="resume-preview" aria-label="Resume preview"><div className="resume-preview-header"><h1>{claimText(content.headline) || 'Untitled resume'}</h1></div>{content.summary?.length > 0 && <section><h2>Summary</h2>{content.summary.map((item, index) => <p key={index}>{claimText(item)}</p>)}</section>}{content.skills?.length > 0 && <section><h2>Skills</h2><div className="resume-skill-list">{content.skills.map((item, index) => <span key={index}>{claimText(item)}</span>)}</div></section>}{content.experience?.length > 0 && <section><h2>Experience</h2>{content.experience.map((experience, index) => <article className="resume-experience" key={index}><div className="resume-experience-heading"><div><h3>{claimText(experience.title)}</h3><strong>{claimText(experience.company)}</strong></div><span>{claimText(experience.dates)}</span></div><ul>{(experience.bullets || []).map((bullet, bulletIndex) => <li key={bulletIndex}>{claimText(bullet)}</li>)}</ul></article>)}</section>}{content.education?.length > 0 && <section><h2>Education</h2>{content.education.map((item, index) => <p className="resume-education" key={index}>{claimText(item)}</p>)}</section>}</article>;
}

function CoverLetterPreview({ content }) {
  const subject = claimText(content.subject);
  return <article className="resume-preview cover-letter-preview" aria-label="Cover letter preview"><div className="resume-preview-header"><p>{claimText(content.recipient)}</p>{subject && <h1>{subject}</h1>}</div>{(content.paragraphs || []).map((paragraph, index) => <p key={index}>{claimText(paragraph)}</p>)}<p className="resume-closing">{claimText(content.closing)}</p></article>;
}

function MasterResumePreview({ resume, sourcePreview }) {
  const rawText = String(resume?.rawText || '').trim();
  const structuredText = [
    resume?.professionalSummary,
    (resume?.skills || []).length ? `Skills\n${resume.skills.join(', ')}` : '',
    (resume?.experience || []).map((entry) => `${entry.title || ''} · ${entry.company || ''}\n${(entry.bullets || []).join('\n')}`).join('\n\n'),
    (resume?.education || []).join('\n')
  ].filter(Boolean).join('\n\n');
  if (sourcePreview) return <div className="master-resume-source-preview" aria-label="Saved resume preview"><iframe title={resume?.sourceFilename || 'Saved resume source'} src={sourcePreview} /></div>;
  return <article className="resume-preview" aria-label="Saved resume preview"><div className="resume-preview-header"><h1>{resume?.sourceFilename || 'Saved resume'}</h1><p>This is the saved source resume. Create a custom resume to tailor it for this opportunity.</p></div><pre className="resume-preview-content">{rawText || structuredText || 'No saved resume is available yet. Use Profile & resume to add one.'}</pre></article>;
}

const validationMessage = (issue) => issue.path ? `${issue.message} Review the claim in ${issue.path.replace(/^\./, '').replaceAll('.', ' ⬺ ')}.` : issue.message;

export default function ApplicationDocuments({ applicationId, initialType = 'resume', readOnly = false, allowMasterRefresh = false, onChanged }) {
  const [type, setType] = useState(initialType); const [docs, setDocs] = useState([]); const [selected, setSelected] = useState(null); const [draft, setDraft] = useState({}); const [masterResume, setMasterResume] = useState(null); const [masterResumePreview, setMasterResumePreview] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [steeringOpen, setSteeringOpen] = useState(false); const [guidance, setGuidance] = useState(''); const [editing, setEditing] = useState(false);
  const locked = readOnly;
  const [resetBusy, setResetBusy] = useState(false);
  const choose = (entry) => { setSelected(entry); setDraft(clone(entry?.content)); setEditing(false); };
  const resetVersions = async () => {
    if (!window.confirm('Delete every resume and cover-letter version for this job? The uploaded master resume will be preserved.')) return;
    setResetBusy(true);
    try {
      const result = await window.desktopShell.resetApplicationDocuments(applicationId);
      await load();
      await onChanged?.();
      setMessage('Reset ' + (result?.documentsRemoved || 0) + ' saved version' + (result?.documentsRemoved === 1 ? '' : 's') + ' for this job. The master resume was preserved.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setResetBusy(false);
    }
  };
  const isErrorFree = (entry) => entry?.validation?.valid !== false && !entry?.validation?.errors?.length;
  const load = async () => { const next = await window.desktopShell.listApplicationDocuments({ applicationId, documentType: type }); setDocs(next || []); const latest = next?.[0]; const current = (next || []).find((entry) => entry.isSelected) || (next || []).find(isErrorFree) || latest || null; choose(current); if (latest && current?.id !== latest.id && !isErrorFree(latest)) setMessage('The newest version needs review. Showing the newest error-free version so it can be approved or selected.'); if (type === 'resume') { setMasterResume(await window.desktopShell.getMasterResume?.() || null); setMasterResumePreview(await window.desktopShell.getMasterResumePdf?.() || ''); } else { setMasterResume(null); setMasterResumePreview(''); } };
  useEffect(() => { setType(initialType); }, [initialType]);
  useEffect(() => { load().catch((error) => setMessage(error.message)); }, [applicationId, type]);
  const generate = async (steering = '') => { if (locked) return; setBusy(true); setSteeringOpen(false); setMessage('Generating grounded draft…'); try { await window.desktopShell.generateApplicationDocument({ applicationId, documentType: type, guidance: steering }); await load(); setMessage('Draft saved. Review its claims, then approve and select it for this job.'); } catch (error) { setMessage(error.message); } finally { setBusy(false); } };
  const save = async () => { if (locked) return; try { await window.desktopShell.saveApplicationDocumentEdit({ id: selected.id, content: draft }); await load(); setEditing(false); setMessage('Saved as a new version. Its factual review is shown below.'); } catch (error) { setMessage(error.message); } };
  const cancelEdit = () => { if (!selected) return; setDraft(clone(selected.content)); setEditing(false); };
  const approve = async () => {
    if (locked) return;
    try {
      await window.desktopShell.approveApplicationDocument(selected.id);
      await load();
      setMessage('Document approved. You can now select it for this application.');
    } catch (error) {
      // Approval revalidates against the current evidence catalog. Refresh the
      // document so a failed approval exposes the authoritative saved errors.
      const refreshedValidation = window.desktopShell.validateApplicationDocument
        ? await window.desktopShell.validateApplicationDocument(selected.id).catch(() => null)
        : null;
      await load().catch(() => {});
      const details = refreshedValidation?.errors?.map((issue) => validationMessage(issue)).filter(Boolean) || selected?.validation?.errors?.map((issue) => validationMessage(issue)).filter(Boolean) || [];
      setMessage(details.length ? `Cannot approve this document: ${details.join(' ')}` : error.message);
    }
  };
  const select = async () => { if (locked) return; try { await window.desktopShell.selectApplicationDocument(selected.id); await load(); await onChanged?.(); setMessage('Selected for this job only; this does not submit or upload it.'); } catch (error) { setMessage(error.message); } };
  const exportFile = async (kind) => { try { const result = await window.desktopShell[kind === 'pdf' ? 'exportApplicationDocumentPdf' : 'exportApplicationDocumentText'](selected.id); if (!result?.canceled) { await load(); setMessage(`${kind.toUpperCase()} exported to ${result.savedPath || 'the selected location'}.`); } } catch (error) { setMessage(error.message); } };
  const openFolder = async () => { try { const result = await window.desktopShell.openJobApplicationFolder(applicationId); if (result?.folderPath) setMessage(`Opened this job's document folder: ${result.folderPath}`); } catch (error) { setMessage(error.message); } };
  const masterIsCurrent = selected?.modelName === 'master_resume' && selected?.sourceResumeVersion === masterResume?.version;
  const hasInternalResumeHeading = selected?.modelName === 'master_resume' && isInternalResumeHeading(selected?.content?.headline);
  const useMasterResume = async () => { if (locked && !allowMasterRefresh) return; try { setBusy(true); await window.desktopShell.selectMasterApplicationResume(applicationId); await load(); await onChanged?.(); setMessage(masterIsCurrent ? 'Current master resume selected for this application.' : 'Current master resume refreshed and selected for this application.'); } catch (error) { setMessage(error.message); } finally { setBusy(false); } };
  const validation = selected?.validation || { errors: [], warnings: [] }; const canApprove = selected && selected.status !== 'approved';
  // Older saved master versions may not have the modelName marker, but their
  // provenance still identifies them as the uploaded source resume.
  const isMasterSource = selected && (selected.modelName === 'master_resume' || selected.provenance?.includes?.('master_resume'));
  const actionLabel = type === 'resume' && !selected ? 'Custom resume' : selected ? 'Regenerate draft' : `Generate ${label(type).toLowerCase()}`;
  return <section className="job-profile-panel application-documents"><div className="job-modal-head application-documents-head"><div><span className="eyebrow">EVIDENCE-GROUNDED DOCUMENTS</span><h3>{label(type)} versions</h3><small>{locked ? 'This document is locked after the opportunity reaches Ready to apply.' : 'Research-stage workflow: review, approve, and select this document for the job.'}</small></div><button className="secondary" disabled={resetBusy || busy} onClick={resetVersions}>{resetBusy ? 'Resetting…' : 'Reset versions for this job'}</button><div className="document-type-switcher"><button className={type === 'resume' ? 'primary' : 'secondary'} onClick={() => setType('resume')}>Resume</button><button className={type === 'cover_letter' ? 'primary' : 'secondary'} onClick={() => setType('cover_letter')}>Cover letter</button></div></div>{message && <div className="job-search-status">{message}</div>}{!selected && <div className="document-workflow-note">Generate a {label(type).toLowerCase()} first; its Approve and Select controls will appear with the saved version.</div>}<div className="document-toolbar"><div className="document-toolbar-group"><button className="primary" disabled={busy || locked} onClick={() => selected ? setSteeringOpen(true) : generate()}>{busy ? 'Generating…' : actionLabel}</button>{type === 'resume' && masterResume && (!masterIsCurrent || hasInternalResumeHeading) && <button className="secondary" disabled={busy || (locked && !allowMasterRefresh)} onClick={useMasterResume}>{hasInternalResumeHeading ? 'Replace internal resume label' : selected?.modelName === 'master_resume' ? 'Refresh from current master' : 'Use master resume'}</button>}{selected && <button className="secondary" disabled={locked} onClick={editing ? cancelEdit : () => setEditing(true)}>{editing ? 'Cancel edit' : `Edit ${label(type).toLowerCase()}`}</button>}{editing && <button className="primary" disabled={locked || busy} onClick={save}>Save as new version</button>}</div>{selected && <div className="document-toolbar-group document-workflow-actions"><button className="secondary" disabled={locked || !canApprove || selected.status === 'approved'} onClick={approve}>Approve</button><button className="secondary" disabled={locked || selected.status !== 'approved'} onClick={select}>Select for this application</button></div>}{selected && <div className="document-toolbar-group document-export-actions"><button className="secondary" disabled={busy} onClick={openFolder}>Open job folder</button><span>Export</span><button className="secondary" onClick={() => exportFile('pdf')}>PDF</button><button className="secondary" onClick={() => exportFile('text')}>Text</button></div>}</div>{selected ? <><div className="document-version-meta"><b>Version {selected.version}</b><span className={`document-status status-${selected.status}`}>{selected.status.replaceAll('_', ' ')}</span>{selected.isSelected && <span className="document-selected">Selected for this application</span>}{selected.modelName === 'master_resume' && <span className="document-selected">Master resume source</span>}<small>{editing ? 'Editing mode: changes are saved as a new version.' : 'Read-only preview. Click Edit to change the wording.'}</small></div>{selected.modelName === 'master_resume' && type === 'resume' ? <MasterResumePreview resume={masterResume} sourcePreview={masterResumePreview} /> : editing ? (type === 'resume' ? <ResumeEditor content={draft} onChange={setDraft} readOnly={locked} /> : <CoverLetterEditor content={draft} onChange={setDraft} readOnly={locked} />) : (type === 'resume' ? <ResumePreview content={draft} /> : <CoverLetterPreview content={draft} />)}<details className="document-collapsible"><summary>Version history</summary>{docs.map((entry) => <button className="secondary" key={entry.id} onClick={() => choose(entry)}>Version {entry.version} · {entry.status.replaceAll('_', ' ')}{entry.modelName === 'master_resume' ? ' · master' : ''}{entry.isSelected ? ' · selected' : ''}</button>)}</details></> : masterResume ? <><div className="document-version-meta"><b>Master resume</b><span className="document-status status-approved">source</span><small>Loaded from Profile & resume. Use master resume to select it for this application, or create a custom version.</small></div><MasterResumePreview resume={masterResume} sourcePreview={masterResumePreview} /></> : <p>No {label(type).toLowerCase()} version yet. Generate a grounded draft to begin.</p>}{steeringOpen && <div className="modal" onClick={() => setSteeringOpen(false)}><section className="job-modal" onClick={(event) => event.stopPropagation()}><div className="job-modal-head"><div><span className="eyebrow">STEER THE NEXT DRAFT</span><h2>What should it emphasize?</h2></div></div><p>Describe the experience, strengths, tone, or role fit to prioritize. This can guide emphasis but cannot add facts not supported by your master resume.</p><label className="job-field"><span>Guidance (optional)</span><textarea rows="7" maxLength="10000" value={guidance} onChange={(event) => setGuidance(event.target.value)} placeholder="Example: Lead with my full-stack Ruby on Rails experience, show concrete product impact, and keep the tone direct and senior." /></label><small>{guidance.length}/10000</small><div className="job-modal-actions"><button className="secondary" onClick={() => setSteeringOpen(false)}>Cancel</button><button className="primary" onClick={() => generate(guidance)}>Generate new version</button></div></section></div>}</section>;
}
