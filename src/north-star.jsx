import React, { useCallback, useEffect, useState } from 'react';
import { Brain, BriefcaseBusiness, ChevronRight, Mail } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import JobsView from './JobsView.jsx';
import InterviewPrepView from './InterviewPrepView.jsx';
import GroupedEmailMonitorPanel from './jobs/EmailMonitorPanel.jsx';
import './styles.css';
import './theme.css';
import './north-star.css';

// The standalone renderer deliberately owns only career navigation. It shares
// the existing preload/database contracts so the migration and user-data path
// remain compatible with the legacy command-center shell.
function NorthStarApp() {
  const [view, setView] = useState('jobs');
  const [jobs, setJobs] = useState([]);
  const [jobDetailsOpen, setJobDetailsOpen] = useState(null);

  const refreshJobs = useCallback(async () => {
    const records = await window.desktopShell?.listJobs?.();
    setJobs(Array.isArray(records) ? records : []);
  }, []);

  useEffect(() => { refreshJobs().catch(() => setJobs([])); }, [refreshJobs]);
  useEffect(() => {
    const goToJobs = () => { setJobDetailsOpen(null); setView('jobs'); };
    window.addEventListener('job-search-navigation', goToJobs);
    const unsubscribeAppBack = window.desktopShell?.onAppBack?.(() => {
      window.dispatchEvent(new CustomEvent('job-search-navigation'));
    });
    return () => {
      window.removeEventListener('job-search-navigation', goToJobs);
      unsubscribeAppBack?.();
    };
  }, []);

  const navigateToJobs = () => window.dispatchEvent(new CustomEvent('job-search-navigation'));

  return <div className="app north-star-standalone" data-theme="classic-dark">
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon" aria-hidden="true"><img className="brand-star" src="/norht_Star_icon.png" alt="" /></div><div><b>North Star</b><small>Career workspace</small></div></div>
      <div className="nav-label">CAREER WORKSPACE</div>
      <nav>
        <button className={view === 'jobs' ? 'nav active' : 'nav'} onClick={() => { setJobDetailsOpen(null); setView('jobs'); }}><BriefcaseBusiness size={17}/> Job search <em>{jobs.filter((job) => !['accepted', 'rejected'].includes(job.stage)).length}</em></button>
        <button className={view === 'interview-prep' ? 'nav active' : 'nav'} onClick={() => setView('interview-prep')}><Brain size={17}/> Interview coach</button>
      </nav>
      <div className="path-card"><div className="path-symbol"><Mail size={16}/></div><div><b>Local-first</b><small>Career data stays on this device</small></div><ChevronRight size={15}/></div>
      <div className="sidebar-footer"><div className="local-badge"><span className="local-dot"/> Standalone North Star</div></div>
    </aside>
    <main className="main">
      <header><div className="crumb"><button type="button" className="breadcrumb-link" onClick={navigateToJobs}>NORTH STAR</button><ChevronRight size={14}/>{view === 'jobs' ? <button type="button" className="breadcrumb-link current" onClick={navigateToJobs}>{jobDetailsOpen ? 'Application workspace' : 'Job search & applications'}</button> : <b>Interview coach</b>}</div><div className="header-actions"><div className="streak"><BriefcaseBusiness size={15}/> Career product</div></div></header>
      <div className="main-scroll">
        {view === 'jobs' && <>{!jobDetailsOpen && <GroupedEmailMonitorPanel jobs={jobs} />}<JobsView jobs={jobs} onRefresh={refreshJobs} onDetailChange={setJobDetailsOpen} /></>}
        {view === 'interview-prep' && <InterviewPrepView jobs={jobs} onOpenJobs={() => { setJobDetailsOpen(null); setView('jobs'); }} />}
      </div>
    </main>
  </div>;
}

createRoot(document.getElementById('root')).render(<NorthStarApp />);
