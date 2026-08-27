const text = (value, length = 50000) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, length);
const decode = (value) => text(String(value || '').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>'));
const stripHtml = (value) => decode(String(value || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
const matchMeta = (html, key) => {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  const tag = tags.find((entry) => new RegExp(`\\b(?:name|property|itemprop)\\s*=\\s*["']${escaped}["']`, 'i').test(entry));
  return tag ? decode((tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i) || [])[1]) : '';
};
const asArray = (value) => Array.isArray(value) ? value : value ? [value] : [];
const jobPosting = (value) => {
  if (!value || typeof value !== 'object') return null;
  if (asArray(value['@type']).some((type) => String(type).toLowerCase() === 'jobposting')) return value;
  for (const entry of asArray(value['@graph']).concat(asArray(value.itemListElement))) { const found = jobPosting(entry?.item || entry); if (found) return found; }
  return null;
};
const location = (value) => asArray(value).map((entry) => entry?.address || entry).map((entry) => [entry?.addressLocality, entry?.addressRegion, entry?.addressCountry].filter(Boolean).join(', ')).filter(Boolean).join(' / ');
const salary = (value) => {
  const detail = value?.value || value;
  const min = detail?.minValue; const max = detail?.maxValue; const unit = detail?.unitText || detail?.unitCode;
  if (min || max) return `${min ? `$${Number(min).toLocaleString()}` : ''}${min && max ? '–' : ''}${max ? `$${Number(max).toLocaleString()}` : ''}${unit ? ` ${unit}` : ''}`;
  if (Number.isFinite(Number(detail))) return `$${Number(detail).toLocaleString()}`;
  return '';
};
const salaryFromText = (value) => {
  const match = String(value || '').match(/(?:USD|US\$|\$)\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(?:-|–|to)\s*\$?\s*([\d,]+(?:\.\d+)?)(?:\s*(?:per|\/)\s*(year|yr|hour|hr))?/i);
  if (!match) return '';
  const unit = match[3] ? ` per ${match[3].replace(/^yr$/i, 'year').replace(/^hr$/i, 'hour')}` : '';
  return `USD $${Number(match[1].replace(/,/g, '')).toLocaleString()}–$${Number(match[2].replace(/,/g, '')).toLocaleString()}${unit}`;
};

function parseJobListing(html, url) {
  const scripts = html.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  let posting = null;
  for (const script of scripts) {
    const raw = script.replace(/^.*?>/s, '').replace(/<\/script>$/i, '');
    try { posting = jobPosting(JSON.parse(raw)); } catch {}
    if (posting) break;
  }
  const title = text(posting?.title || matchMeta(html, 'og:title') || matchMeta(html, 'twitter:title') || (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1], 500);
  const company = text(posting?.hiringOrganization?.name || matchMeta(html, 'og:site_name'), 300);
  const description = stripHtml(posting?.description || matchMeta(html, 'description') || matchMeta(html, 'og:description'));
  const employmentType = text(asArray(posting?.employmentType).join(', '), 120);
  const remote = String(posting?.jobLocationType || '').toUpperCase() === 'TELECOMMUTE' || /\bremote\b|work from home|telecommute/i.test(`${description} ${location(posting?.jobLocation)}`);
  const parsedLocation = location(posting?.jobLocation) || location(posting?.applicantLocationRequirements) || (remote ? 'Remote' : '');
  return {
    url, canonicalUrl: url, source: new URL(url).hostname.replace(/^www\./, ''), roleTitle: title.replace(/\s*[|·–—-]\s*[^|·–—-]+$/, ''), company,
    location: text(parsedLocation, 300), remoteType: remote ? 'remote' : 'onsite', employmentType,
    salaryRange: salaryFromText(description) || salary(posting?.baseSalary), description, requirements: [], postedAt: posting?.datePosted || null, expiresAt: posting?.validThrough ? String(posting.validThrough).slice(0, 10) : null,
  };
}

module.exports = { parseJobListing };
