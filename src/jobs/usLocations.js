import { City } from 'country-state-city';

const STATE_NAMES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia' };
const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const cityKey = (city) => `${normalize(city.name)}|${String(city.stateCode || '').toUpperCase()}`;
const US_CITIES = [...new Map(City.getCitiesOfCountry('US').map((city) => [cityKey(city), city])).values()];

// Keep the lookup local and deterministic. It avoids API keys, network latency, and
// leaking partially typed location data while still covering ordinary US city names.
export const searchUsLocations = (query, limit = 8) => {
  const needle = normalize(query);
  if (!needle) return [];
  const terms = needle.split(' ').filter(Boolean);
  return US_CITIES.map((city) => {
    const name = normalize(city.name);
    const state = normalize(city.stateCode);
    const stateName = normalize(STATE_NAMES[city.stateCode] || '');
    const haystack = `${name} ${state} ${stateName}`;
    if (!terms.every((term) => haystack.includes(term))) return null;
    const score = name === needle ? 0 : name.startsWith(needle) ? 1 : state === needle ? 2 : name.includes(needle) ? 3 : 4;
    return { city: city.name, state: city.stateCode, stateName: stateName ? STATE_NAMES[city.stateCode] : '', value: `${city.name}, ${city.stateCode}`, score };
  }).filter(Boolean).sort((left, right) => left.score - right.score || left.value.localeCompare(right.value)).slice(0, limit);
};
