const STATE_NAMES = Object.freeze({
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
});
const STATE_CODES = new Map(Object.entries(STATE_NAMES).flatMap(([code, name]) => [[code, code], [name.toLowerCase(), code]]));
const text = (value, max = 160) => String(value ?? '').trim().slice(0, max);

function parseUsLocation(value) {
  const objectValue = value && typeof value === 'object' ? value : {};
  const raw = text(objectValue.raw || value, 160);
  if (!raw && !objectValue.city) return null;
  const cityFromObject = text(objectValue.city, 120);
  const stateToken = text(objectValue.stateCode || objectValue.state || objectValue.stateName, 80);
  const match = raw.match(/^(.+?)[,\s]+([A-Za-z][A-Za-z .'-]+|[A-Za-z]{2})$/);
  const city = cityFromObject || (match ? match[1].trim() : (STATE_CODES.has(raw.toUpperCase()) || STATE_CODES.has(raw.toLowerCase()) ? '' : raw));
  const token = stateToken || (match ? match[2].trim() : raw);
  const stateCode = STATE_CODES.get(token.toUpperCase()) || STATE_CODES.get(token.toLowerCase()) || '';
  const stateName = stateCode ? STATE_NAMES[stateCode] : '';
  const compact = city && stateCode ? `${city}, ${stateCode}` : city || stateCode || raw;
  return { raw: raw || compact, city, stateCode, stateName, compact, usaJobs: city && stateName ? `${city}, ${stateName}` : stateName || city || raw };
}

function formatLocationForProvider(value, provider = '') {
  const parsed = parseUsLocation(value);
  if (!parsed) return '';
  if (provider === 'usajobs') return parsed.usaJobs;
  // Adzuna, Dice, and the local feed filters are most reliable with USPS state abbreviations.
  return parsed.compact;
}

function formatLocationScope(scope = {}, provider = '') {
  const parsed = parseUsLocation(scope.location || scope.locationName);
  return parsed ? { ...scope, location: parsed, canonicalLocation: parsed.compact, locationName: formatLocationForProvider(parsed, provider) } : scope;
}

module.exports = { STATE_NAMES, parseUsLocation, formatLocationForProvider, formatLocationScope };
