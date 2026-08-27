const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { applicationExportDirectory, applicationExportFilename, safeSegment } = require('../electron/jobs/application-export.cjs');

test('application exports use a stable, sanitized per-job folder', () => {
  const directory = applicationExportDirectory('C:\\Users\\Candidate\\Documents', { company: 'Acme: AI/Platform', roleTitle: 'Forward Deploy Engineer?' });
  assert.equal(directory, path.join('C:\\Users\\Candidate\\Documents', 'Job Applications', 'Acme AI Platform - Forward Deploy Engineer (unassigned)'));
  assert.equal(applicationExportFilename({ documentType: 'cover_letter', version: 4 }, 'pdf', { company: 'Acme', roleTitle: 'Engineer' }), 'Acme - Engineer - Cover Letter - v4.pdf');
  assert.equal(applicationExportFilename({ documentType: 'resume', version: 2 }, 'txt', { company: 'Acme', roleTitle: 'Engineer' }), 'Acme - Engineer - Resume - v2.txt');
  assert.equal(safeSegment('  ', 'Fallback'), 'Fallback');
});
