const test = require('node:test');
const assert = require('node:assert/strict');

test('outreach ranking weights contact quality and verification separately from job fit', async () => {
  const scoring = await import('../src/outreachScoring.mjs');
  const strongContact = scoring.scoreOutreach({ jobFitScore: 88, contactQualityScore: 100, emailConfidenceScore: 100, jobFreshnessScore: 80, companyPriorityScore: 50 });
  const weakContact = scoring.scoreOutreach({ jobFitScore: 95, contactQualityScore: 20, emailConfidenceScore: 20, jobFreshnessScore: 80, companyPriorityScore: 50 });
  assert.ok(strongContact > weakContact);
});

test('contact roles and verification statuses receive conservative confidence scores', async () => {
  const scoring = await import('../src/outreachScoring.mjs');
  assert.equal(scoring.contactQuality('Senior Technical Recruiter'), 100);
  assert.equal(scoring.contactQuality('Software Engineer'), 45);
  assert.equal(scoring.emailConfidence('verified'), 100);
  assert.equal(scoring.emailConfidence('probable'), 60);
  assert.equal(scoring.emailConfidence('unverified'), 20);
});

test('resume routing selects role-relevant labels without changing the source file', async () => {
  const scoring = await import('../src/outreachScoring.mjs');
  assert.equal(scoring.chooseResume({ roleTitle: 'Forward Deployed AI Engineer', description: '' }, { version: 11 }, 'C:\\resume.pdf').label, 'FDE');
  assert.equal(scoring.chooseResume({ roleTitle: 'Healthcare Software Engineer', description: '' }, { version: 11 }, 'C:\\resume.pdf').label, 'Healthcare');
  assert.equal(scoring.chooseResume({ roleTitle: 'Full-Stack Engineer', description: '' }, { version: 11 }, 'C:\\resume.pdf').path, 'C:\\resume.pdf');
});

test('generated outreach is short and does not invent an employer relationship', async () => {
  const scoring = await import('../src/outreachScoring.mjs');
  const body = scoring.buildEmail({ firstName: 'Sarah', company: 'Acme AI', jobTitle: 'AI Engineer', jobReason: 'the role’s practical automation focus', relevantExperience: 'I have built healthcare and insurance workflows and local AI systems.' });
  assert.match(body, /^Hi Sarah,/);
  assert.ok(body.split(/\s+/).length >= 80 && body.split(/\s+/).length <= 140);
  assert.doesNotMatch(body, /we spoke|as discussed|your team told me/i);
});
