const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDatabase } = require('../electron/database.cjs');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'JobsView.jsx'), 'utf8');
const database = fs.readFileSync(path.join(__dirname, '..', 'electron', 'database.cjs'), 'utf8');

test('job profile loads persisted lists into controlled display values', () => {
  assert.match(source, /setProfile\(\(current\) => \(\{ \.\.\.current, \.\.\.savedProfile, \.\.\.normalizeProfileLists\(savedProfile\) \}\)\)/);
  assert.match(source, /value=\{profileValue\(profile\[key\]\)\}/);
});

test('job profile persists all requested search preference fields', () => {
  assert.match(database, /must_have_skills_json/);
  assert.match(database, /nice_to_have_skills_json/);
  assert.match(database, /radius_miles/);
  assert.match(database, /mustHaveSkills: jsonField\(row\.must_have_skills_json\)/);
  assert.match(database, /niceToHaveSkills: jsonField\(row\.nice_to_have_skills_json\)/);
});

test('job profile survives database close and reopen', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aicc-profile-'));
  const seedPath = path.join(userDataPath, 'missing-roadmap.csv');
  const profile = {
    targetRoles: ['Product Designer'],
    targetLocations: ['Austin, TX'],
    targetIndustries: ['Technology'],
    interests: ['Accessible design'],
    mustHaveSkills: ['Figma'],
    niceToHaveSkills: ['React'],
    excludedKeywords: ['Senior'],
    radiusMiles: 25,
    remotePreference: 'hybrid',
    minimumSalary: 100000,
    firstName: 'Ada',
    lastName: 'Lovelace',
  };

  const first = createDatabase({ userDataPath, seedPath });
  try {
    const saved = first.profiles.upsert(profile);
    assert.deepEqual(saved.targetRoles, profile.targetRoles);
    assert.deepEqual(saved.targetLocations, profile.targetLocations);
    assert.deepEqual(saved.interests, profile.interests);
  } finally {
    first.close();
  }

  const second = createDatabase({ userDataPath, seedPath });
  try {
    const restored = second.profiles.getCurrent();
    assert.deepEqual(restored.targetRoles, profile.targetRoles);
    assert.deepEqual(restored.targetLocations, profile.targetLocations);
    assert.deepEqual(restored.targetIndustries, profile.targetIndustries);
    assert.deepEqual(restored.interests, profile.interests);
    assert.deepEqual(restored.mustHaveSkills, profile.mustHaveSkills);
    assert.deepEqual(restored.niceToHaveSkills, profile.niceToHaveSkills);
    assert.deepEqual(restored.excludedKeywords, profile.excludedKeywords);
    assert.equal(restored.radiusMiles, profile.radiusMiles);
    assert.equal(restored.remotePreference, profile.remotePreference);
    assert.equal(restored.minimumSalary, profile.minimumSalary);
    assert.equal(restored.firstName, profile.firstName);
    assert.equal(restored.lastName, profile.lastName);
  } finally {
    second.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});
