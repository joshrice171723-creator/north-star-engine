const assert = require('node:assert/strict');
const test = require('node:test');
const { matches, matchesRequestedLocation } = require('../electron/public-job-providers.cjs');

test('public-feed matching requires the searched role signal in the title', () => {
  assert.equal(matches('Forward Deployed Engineer', { title: 'Forward Deployed AI Engineer', description: 'Build agentic systems', category: '' }), true);
  assert.equal(matches('Forward Deployed Engineer', { title: 'Head of Marketing', description: 'Partner with the forward deployed engineering team', category: '' }), false);
});
