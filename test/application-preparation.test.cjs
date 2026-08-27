const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('application preparation is exposed as a renderer bridge and validates both document types', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(preload, /prepareJobApplication/);
  assert.match(main, /jobs:applications:prepare/);
  assert.match(main, /prepareDocument\('resume'\)/);
  assert.match(main, /prepareDocument\('cover_letter'\)/);
  assert.match(main, /document = await generateApplicationDocument/);
  assert.doesNotMatch(main, /generateApplicationDocument\([^\n]+\)\)\.document/);
  assert.match(main, /documents\.approve\(current\.id\)/);
  assert.match(main, /documents\.select\(current\.id\)/);
});
