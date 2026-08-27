const test = require('node:test');
const assert = require('node:assert/strict');
const { parseJobListing } = require('../electron/job-import.cjs');

test('Dice JSON-LD and description fields preserve remote work and salary ranges', () => {
  const html = `<title>AI Forward Deployed Engineer - OneStream Software LLC - Remote | Dice.com</title><script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'AI Forward Deployed Engineer', hiringOrganization: { name: 'OneStream Software LLC' }, jobLocationType: 'TELECOMMUTE', applicantLocationRequirements: { '@type': 'Country', name: 'USA' }, employmentType: 'FULL_TIME', baseSalary: { '@type': 'MonetaryAmount', currency: 'USD', value: 120000 }, description: '<strong>Location:</strong> Remote, USA<br><strong>Gross Annual Base Salary:</strong> USD 120,000 - 149,000' })}</script>`;
  const job = parseJobListing(html, 'https://www.dice.com/job-detail/example');
  assert.equal(job.location, 'Remote');
  assert.equal(job.remoteType, 'remote');
  assert.equal(job.salaryRange, 'USD $120,000–$149,000');
});
