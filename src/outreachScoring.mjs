const TARGET_ROLES = ['forward deployed engineer', 'forward deployed ai engineer', 'ai engineer', 'ai automation engineer', 'implementation engineer', 'solutions engineer', 'full-stack engineer', 'healthcare software engineer'];
const clamp = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
export function scoreOutreach({ jobFitScore = 0, contactQualityScore = 0, emailConfidenceScore = 0, jobFreshnessScore = 0, companyPriorityScore = 0 }) {
  return clamp(jobFitScore * .4 + contactQualityScore * .25 + emailConfidenceScore * .2 + jobFreshnessScore * .1 + companyPriorityScore * .05);
}
export function contactQuality(title = '') {
  const normalized = String(title).toLowerCase();
  if (normalized.includes('recruit')) return 100;
  if (normalized.includes('hiring manager')) return 95;
  if (normalized.includes('engineering manager')) return 88;
  if (normalized.includes('director') || normalized.includes('head of engineering')) return 78;
  if (normalized.includes('talent acquisition')) return 72;
  return 45;
}
export function emailConfidence(status = '') { return { verified: 100, probable: 60, unverified: 20, unavailable: 0 }[status] ?? 0; }
export function jobFreshness(postedAt) {
  if (!postedAt) return 35;
  const age = Math.max(0, (Date.now() - new Date(postedAt).getTime()) / 86400000);
  return clamp(100 - age * 4);
}
export function chooseResume(job = {}, resume = {}, resumePath = '') {
  const text = `${job.roleTitle || ''} ${job.company || ''} ${job.description || ''}`.toLowerCase();
  const label = text.includes('forward deployed') || text.includes('solutions engineer') || text.includes('implementation') ? 'FDE' : text.includes('healthcare') ? 'Healthcare' : text.includes('ai') || text.includes('automation') ? 'AI-forward' : 'Full-stack';
  return { label, version: resume?.version ? `v${resume.version}` : 'master', path: resumePath || resume?.sourceFilename || '' };
}
export function buildEmail({ firstName = '', company = '', jobTitle = '', jobReason = '', relevantExperience = '' }) {
  const greeting = firstName ? `Hi ${firstName},` : 'Hi there,';
  return `${greeting}\n\nI’m Joshua Rice, a full-stack engineer with healthcare and insurance delivery experience who has been building practical AI and automation systems end to end. I’m reaching out because the ${jobTitle} role at ${company} looks closely aligned with ${jobReason || 'the kind of customer-facing engineering work I’m targeting'}.\n\n${relevantExperience || 'My background combines hands-on product delivery, stakeholder communication, and building reliable workflows around real operational problems.'} I’m especially interested in work where technical decisions have a clear effect on users and business outcomes.\n\nWould you be open to a brief conversation about the team’s needs and whether my experience could be useful?\n\nBest,\nJoshua Rice`;
}
export { TARGET_ROLES };
