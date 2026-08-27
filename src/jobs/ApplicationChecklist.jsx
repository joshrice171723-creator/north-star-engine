import React from 'react';

export default function ApplicationChecklist({ readiness = {} }) {
  const sections = [['Completed', readiness.completed, 'complete'], ['Missing', readiness.missing, 'missing'], ['Needs review', readiness.warnings, 'warning'], ['Blocked', readiness.blocked, 'blocked']];
  return <section className="job-profile-panel application-checklist"><span className="eyebrow">READINESS</span><h3>{readiness.ready ? 'Ready for the next step' : 'Finish the application basics'}</h3><div className="application-checklist-group" aria-label="Application readiness checklist"><span className="application-checklist-group-label">Checklist</span>{sections.map(([label, items, kind]) => items?.length ? <div className={`application-checklist-${kind}`} key={label}><b>{label}</b><span>{items.map((item) => String(item).replaceAll('_', ' ')).join(' · ')}</span></div> : null)}</div></section>;
}
