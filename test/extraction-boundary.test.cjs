const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('extraction boundary audit passes and reports unresolved physical ownership', () => {
  const script = path.join(__dirname, '..', 'scripts', 'audit-extraction-boundary.cjs');
  const output = execFileSync(process.execPath, [script], { encoding: 'utf8' });
  const report = JSON.parse(output);
  assert.equal(report.rendererEntrypoints.northStar, 'north-star.html -> src/north-star.jsx');
  assert.equal(report.physicalDatabaseSplit, false);
  assert.equal(report.legacyMainProcessStillContainsCareerHandlers, true);
  assert.ok(report.careerTables.includes('job_applications'));
  assert.ok(report.legacyTables.includes('projects'));
});
