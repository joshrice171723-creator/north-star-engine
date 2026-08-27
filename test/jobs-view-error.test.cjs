const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

test('JobsView normalizes structured IPC errors instead of displaying [object Object]', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'JobsView.jsx'), 'utf8');
  assert.match(source, /errorMessage/);
  assert.match(source, /cause\?\.error\?\.message/);
  assert.match(source, /errorMessage\(result, 'Search failed\.'\)/);
  assert.doesNotMatch(source, /new Error\(result\?\.message \|\| result\?\.error/);
});

test('JobsView restores the expandable advanced search request report', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'JobsView.jsx'), 'utf8');
  assert.match(source, /Advanced search report/);
  assert.match(source, /API request/);
  assert.match(source, /Parameters and data/);
  assert.match(source, /First 2 jobs returned/);
  assert.match(source, /preview\.slice\(0, 2\)/);
  assert.match(source, /Complete API call log/);
  assert.match(source, /Response body/);
});
