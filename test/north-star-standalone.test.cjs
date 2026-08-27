const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('standalone North Star entrypoint contains only career surfaces', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'north-star.jsx'), 'utf8');
  assert.match(source, /JobsView/);
  assert.match(source, /InterviewPrepView/);
  assert.doesNotMatch(source, /RecruiterOutreachView|VideoFactoryView|FollowThroughView|Academy/);
});

test('Electron selects the standalone document and an isolated data path', () => {
  const source = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  assert.match(source, /standaloneNorthStar = true/);
  assert.match(source, /standaloneNorthStar \? 'north-star\.html' : 'index\.html'/);
  assert.match(source, /standaloneNorthStar \? 'north-star-preload\.cjs' : 'preload\.cjs'/);
  assert.match(source, /if \(!standaloneNorthStar\) protocol\.handle\('video-factory'/);
  assert.match(source, /app\.setPath\('userData', path\.join\(app\.getPath\('appData'\), 'NorthStar'\)\)/);
  assert.match(source, /application-documents/);
});

test('standalone preload filters legacy-only renderer capabilities', () => {
  const preload = fs.readFileSync(path.join(root, 'electron', 'north-star-preload.cjs'), 'utf8');
  assert.match(preload, /createDesktopShellApi/);
  assert.match(preload, /createVideoFactoryDraft/);
  assert.match(preload, /openGoogleVoice/);
  assert.match(preload, /Object\.entries\(api\)\.filter/);
});
