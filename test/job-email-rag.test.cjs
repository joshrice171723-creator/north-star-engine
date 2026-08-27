const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyJobEmail, chunkText, searchChunks, normalizeGmailMessage, extractApplicationConfirmation } = require('../electron/job-email-rag.cjs');

test('classifies recruiter and interview messages as job-related', () => {
  const result = classifyJobEmail({ subject: 'Interview invitation', from: 'recruiting@example.com', body: 'We would like to schedule a phone screen.' });
  assert.equal(result.isJobRelated, true);
  assert.ok(result.score >= 18);
  assert.ok(result.matchedTerms.includes('interview'));
});

test('classifies messages using saved pipeline signals', () => {
  const result = classifyJobEmail({ subject: 'Next steps', from: 'talent@acme.example', body: 'Following up on our conversation.', pipelineSignals: ['Acme Corporation', 'Senior Platform Engineer', 'talent@acme.example'] });
  assert.equal(result.isJobRelated, true);
  assert.deepEqual(result.matchedPipelineSignals, ['talent@acme.example']);
});

test('chunks text with overlap and retrieves matching chunks', () => {
  const chunks = chunkText('alpha '.repeat(500), { size: 100, overlap: 20 });
  assert.ok(chunks.length > 1);
  assert.ok(searchChunks([{ id: 'one', content: 'The recruiter requested a resume.' }], 'resume recruiter')[0].score >= 2);
});

test('normalizes Gmail headers and plain-text body', () => {
  const message = normalizeGmailMessage({ id: 'abc', threadId: 'thread', payload: { headers: [{ name: 'Subject', value: 'Role update' }, { name: 'From', value: 'recruiter@example.com' }], body: { data: Buffer.from('Application interview update').toString('base64url') } } });
  assert.equal(message.externalId, 'abc');
  assert.equal(message.subject, 'Role update');
  assert.equal(message.isJobRelated, true);
  assert.match(message.body, /Application interview update/);
});

test('normalizes a nested HTML Gmail body when plain text is unavailable', () => {
  const message = normalizeGmailMessage({ id: 'nested', threadId: 'thread', payload: { headers: [{ name: 'Subject', value: 'Application update' }, { name: 'From', value: 'updates@example.com' }], parts: [{ mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/html', body: { data: Buffer.from('<p>Your application is moving forward.</p>').toString('base64url') } }] }] } });
  assert.match(message.body, /Your application is moving forward/);
});

test('extracts only explicit application confirmations with role and employer identity', () => {
  const result = extractApplicationConfirmation({ subject: 'Application sent', receivedAt: 'Fri, 14 Aug 2026 03:22:28 +0000', body: '<a href="https://www.adzuna.com?utm_source=email">Adzuna</a><p>We have sent your <strong><a href="https://www.adzuna.com/details/5819415720">Forward Deployed Engineer</a></strong> application to <strong>Career Launch</strong>.</p><p>Job in Dallas</p>' });
  assert.deepEqual({ roleTitle: result.roleTitle, company: result.company, location: result.location, url: result.url, appliedAt: result.appliedAt }, { roleTitle: 'Forward Deployed Engineer', company: 'Career Launch', location: 'Dallas', url: 'https://www.adzuna.com/details/5819415720', appliedAt: '2026-08-14' });
});

test('does not create an auto-application candidate from generic job email content', () => {
  assert.equal(extractApplicationConfirmation({ subject: 'Job alert: Forward Deployed Engineer', body: 'Here are similar jobs and interview preparation tools.' }), null);
  assert.equal(extractApplicationConfirmation({ subject: 'Application update', body: 'Your application is moving forward to a recruiter review.' }), null);
});

test('uses Dice confirmation subject identity instead of tracking HTML', () => {
  const result = extractApplicationConfirmation({ subject: 'Application for Forward Deployed AI Engineer at Everest Technologies sent', body: '<title>Application Confirmation - Dice</title><p>Your application was sent.</p>' });
  assert.equal(result.roleTitle, 'Forward Deployed AI Engineer');
  assert.equal(result.company, 'Everest Technologies');
});
