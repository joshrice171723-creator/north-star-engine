const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
const hostOf = (value) => { try { return new URL(String(value || '')).host.toLowerCase(); } catch { return ''; } };
const tokens = (value) => normalize(value).split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
const explicitConfirmation = /\b(?:application\s+(?:has\s+been\s+)?(?:submitted|received|sent)|thank\s+you\s+for\s+applying|we\s+have\s+sent\s+your\s+.{0,160}\bapplication)\b/i;
const rejection = /job alert|job newsletter|unsubscribe|password reset|verify your email address|recruiter newsletter/i;

function matchSubmissionConfirmation({ email = {}, application = {}, job = {}, candidateEmail = '', requestedAt = null, now = new Date().toISOString() } = {}) {
  const subject = String(email.subject || ''); const body = String(email.body || ''); const text = `${subject}\n${body}`.slice(0, 20000);
  if (!explicitConfirmation.test(text) || rejection.test(text)) return null;
  const received = email.receivedAt || email.received_at || null;
  if (requestedAt && received) { const receivedMs = Date.parse(received); const requestedMs = Date.parse(requestedAt); const nowMs = Date.parse(now); if (!Number.isFinite(receivedMs) || !Number.isFinite(requestedMs) || receivedMs < requestedMs - 5 * 60 * 1000 || (Number.isFinite(nowMs) && receivedMs > nowMs + 5 * 60 * 1000)) return null; }
  const recipients = normalize(email.recipients || email.to || '');
  if (candidateEmail && recipients && !recipients.includes(normalize(candidateEmail))) return null;
  const sample = normalize(text); const company = tokens(job.company); const role = tokens(job.roleTitle);
  const companyMatches = company.filter((token) => sample.includes(token)); const roleMatches = role.filter((token) => sample.includes(token));
  const jobUrl = String(application.externalApplicationUrl || application.applicationUrl || job.url || ''); const urlHost = hostOf(jobUrl);
  const emailUrls = (text.match(/https?:\/\/[^\s"'<>]+/gi) || []).map((url) => url.replace(/[),.;]+$/, ''));
  const urlMatch = urlHost && emailUrls.some((url) => hostOf(url) === urlHost);
  if (!urlMatch && companyMatches.length === 0 && roleMatches.length === 0) return null;
  const confirmationNumber = (text.match(/(?:confirmation|application|reference)\s*(?:number|no\.?|id)\s*[:#-]?\s*([A-Z0-9-]{4,40})/i) || [])[1] || '';
  return { emailId: String(email.id || '').slice(0, 160), receivedAt: received, confirmationNumber: confirmationNumber.slice(0, 160), signals: ['explicit_submission_language', ...(urlMatch ? ['application_host_match'] : []), ...(companyMatches.length ? ['employer_match'] : []), ...(roleMatches.length ? ['role_match'] : [])].slice(0, 8) };
}

module.exports = { matchSubmissionConfirmation, explicitConfirmation, rejection };
