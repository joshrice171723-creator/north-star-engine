const GREENHOUSE_HOSTS = new Set(['boards.greenhouse.io', 'job-boards.greenhouse.io']);
const MAX_BOARD_JOBS = 500;

const text = (value, max = 50000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const stripHtml = (value) => text(String(value ?? '').replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));

function parseGreenhouseBoardUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw new Error('Enter a valid Greenhouse board URL.'); }
  if (url.protocol !== 'https:' || !GREENHOUSE_HOSTS.has(url.hostname.toLowerCase())) throw new Error('Use a public Greenhouse board URL, such as https://job-boards.greenhouse.io/xai.');
  const parts = url.pathname.split('/').filter(Boolean);
  const token = parts[0];
  if (parts.slice(1).some((part) => /^jobs?$/i.test(part))) throw new Error('That URL is a job listing, not a Greenhouse board token.');
  if (!token || /^(jobs|embed|api)$/i.test(token) || !/^[a-z0-9][a-z0-9_-]*$/i.test(token)) throw new Error('That Greenhouse URL does not contain a recognizable board token.');
  return { boardToken: token, boardUrl: `https://${url.hostname}/${token}` };
}

function locationText(value) {
  if (Array.isArray(value)) return value.map(locationText).filter(Boolean).join('; ');
  if (value && typeof value === 'object') return text(value.name || value.location || value.city || value.title);
  return text(value);
}

function normalizeGreenhouseJob(item, boardToken) {
  const description = stripHtml(item.content);
  const location = locationText(item.location);
  const canonicalUrl = item.absolute_url || `https://job-boards.greenhouse.io/${boardToken}/jobs/${item.id}`;
  return {
    providerKey: 'greenhouse',
    externalId: String(item.id || item.internal_job_id || canonicalUrl),
    canonicalUrl,
    applicationUrl: canonicalUrl,
    title: text(item.title, 500),
    company: text(item.company || boardToken, 300),
    location,
    locations: location ? [location] : [],
    description,
    duties: description,
    qualifications: description,
    requirements: [],
    employmentType: text(item.employment_type || item.employmentType || 'Full-time', 120),
    remoteType: /\bremote\b|work from anywhere|anywhere/i.test(`${location} ${description}`) ? 'remote' : 'onsite',
    postedAt: item.updated_at || null,
    expiresAt: null,
    searchEvidence: { boardToken, query: 'Greenhouse public job board' },
  };
}

async function searchGreenhouseBoard(boardUrl) {
  const { boardToken, boardUrl: normalizedBoardUrl } = parseGreenhouseBoardUrl(boardUrl);
  const endpoint = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`;
  let response;
  try { response = await fetch(endpoint, { headers: { Accept: 'application/json' } }); }
  catch (cause) { return { jobs: [], boardToken, boardUrl: normalizedBoardUrl, error: { code: 'network', message: 'Could not reach the Greenhouse job board.', retryable: true } }; }
  if (!response.ok) return { jobs: [], boardToken, boardUrl: normalizedBoardUrl, error: { code: response.status === 404 ? 'board_not_found' : 'provider_error', message: response.status === 404 ? 'Greenhouse board not found or no longer public.' : `Greenhouse returned HTTP ${response.status}.`, retryable: response.status >= 500 } };
  let body;
  try { body = await response.json(); } catch { return { jobs: [], boardToken, boardUrl: normalizedBoardUrl, error: { code: 'invalid_response', message: 'Greenhouse returned an unreadable job-board response.', retryable: false } }; }
  const jobs = (Array.isArray(body?.jobs) ? body.jobs : []).slice(0, MAX_BOARD_JOBS).map((item) => normalizeGreenhouseJob(item, boardToken)).filter((job) => job.title && job.externalId);
  return { jobs, boardToken, boardUrl: normalizedBoardUrl, totalAvailable: Number(body?.meta?.total) || jobs.length, error: null };
}

module.exports = { GREENHOUSE_HOSTS, MAX_BOARD_JOBS, parseGreenhouseBoardUrl, normalizeGreenhouseJob, searchGreenhouseBoard };
