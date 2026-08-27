const test = require('node:test');
const assert = require('node:assert/strict');
const { discoverOutreachContacts, extractWebCandidates } = require('../electron/outreach-discovery.cjs');

test('company pages preserve explicit public emails as probable, never verified', () => {
  const candidates = extractWebCandidates('https://acme.example/team', '<h1>Sarah Smith</h1><p>Senior Technical Recruiter</p><a href="mailto:sarah.smith@acme.example">Email Sarah</a>', 'Recruiting contact');
  assert.equal(candidates[0].email, 'sarah.smith@acme.example');
  assert.equal(candidates[0].verificationStatus, 'probable');
  assert.match(candidates[0].sourceEvidence, /explicitly present/);
});

test('discovery combines company, GitHub, and LinkedIn leads without inventing email', async () => {
  const fetchImpl = async (url) => {
    if (url === 'https://acme.example') return { ok: true, status: 200, text: async () => '<a href="/team">Team</a>' };
    if (url === 'https://acme.example/team') return { ok: true, status: 200, text: async () => '<p>Jordan Lee, Engineering Manager</p>' };
    if (url.includes('/orgs/acme/members')) return { ok: true, status: 200, text: async () => JSON.stringify([{ login: 'jordan' }]) };
    if (url.includes('/users/jordan')) return { ok: true, status: 200, text: async () => JSON.stringify({ name: 'Jordan Lee', bio: 'Engineering Manager at Acme', email: null, html_url: 'https://github.com/jordan' }) };
    return { ok: false, status: 404, text: async () => '' };
  };
  const result = await discoverOutreachContacts({ company: 'Acme', jobTitle: 'AI Engineer', companyWebsite: 'https://acme.example', githubUrl: 'https://github.com/acme' }, { fetchImpl });
  assert.ok(result.candidates.some((candidate) => candidate.sourceType === 'GitHub'));
  assert.ok(result.candidates.some((candidate) => candidate.sourceType === 'LinkedIn'));
  assert.ok(result.candidates.filter((candidate) => candidate.sourceType === 'GitHub').every((candidate) => candidate.verificationStatus !== 'verified'));
});
