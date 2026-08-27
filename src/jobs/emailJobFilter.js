// Email follow-up is only meaningful once an application has crossed the
// Applied boundary; later stages remain eligible because they are still
// applications the user has already submitted.
const APPLIED_JOB_STAGES = new Set(['applied', 'screen', 'interviewing', 'final', 'offer', 'accepted', 'rejected']);

export const isAppliedJob = (job) => Boolean(job && (job.appliedAt || APPLIED_JOB_STAGES.has(job.stage)));

export const appliedJobs = (jobs = []) => (Array.isArray(jobs) ? jobs : []).filter(isAppliedJob);
