const assert = require('node:assert/strict');
const test = require('node:test');
const { DICE_MCP_URL, diceParams, searchDice } = require('../electron/dice-provider.cjs');

test('Dice MCP initializes then searches with documented filters and normalizes results', async () => {
  const originalFetch = global.fetch; const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body), headers: options.headers });
    if (requests.length === 1) return { ok: true, status: 200, headers: { get: (name) => name === 'mcp-session-id' ? 'dice-session' : name === 'content-type' ? 'text/event-stream' : null }, text: async () => `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26' } })}\n\n` };
    return { ok: true, status: 200, headers: { get: () => 'text/event-stream' }, text: async () => `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: JSON.stringify({ data: [{ id: 'dice-1', title: 'Machine Learning Engineer', summary: 'Build Python machine learning systems.', companyName: 'Dice Example', jobLocation: { displayName: 'Remote' }, detailsPageUrl: 'https://www.dice.com/job-detail/dice-1', employmentType: 'FULLTIME', workplaceTypes: ['Remote'], postedDate: '2026-08-13T00:00:00Z' }], meta: { totalResults: 1 } }) }] } })}\n\n` };
  };
  try {
    const result = await searchDice({ lane: { laneId: 'dice-test', keyword: 'machine learning engineer', postedDate: 'SEVEN' }, scope: { locationName: 'Dallas, TX' }, brief: { remotePreference: 'remote', radiusMiles: 25 } });
    assert.equal(requests.length, 3); assert.equal(requests[0].url, DICE_MCP_URL); assert.equal(requests[0].body.method, 'initialize'); assert.equal(requests[1].body.method, 'notifications/initialized'); assert.equal(requests[2].body.method, 'tools/call'); assert.equal(requests[2].body.params.name, 'search_jobs');
    assert.deepEqual(requests[2].body.params.arguments.workplace_types, ['Remote']); assert.equal(requests[2].headers['mcp-session-id'], 'dice-session');
    assert.equal(result.jobs[0].providerKey, 'dice'); assert.equal(result.jobs[0].applicationUrl, 'https://www.dice.com/job-detail/dice-1'); assert.equal(result.totalAvailable, 1);
  } finally { global.fetch = originalFetch; }
});

test('Dice parameters keep values inside the documented search_jobs contract', () => {
  assert.deepEqual(diceParams({ keyword: 'data engineer', employmentTypes: ['Full-time'], willingToSponsor: true }, { locationName: 'Austin, TX' }, 2, { radiusMiles: 20 }), { keyword: 'data engineer', jobs_per_page: 50, page_number: 2, location: 'Austin, TX', radius: 20, radius_unit: 'mi', employment_types: ['FULLTIME'], willing_to_sponsor: true });
});
