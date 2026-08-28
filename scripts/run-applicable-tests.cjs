const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const excluded = new Set([
  'commitment-lifecycle.test.cjs',
  'follow-through-view.test.cjs',
  'outreach-discovery.test.cjs',
  'today-view.test.cjs',
  'workspace-hierarchy.test.cjs',
]);

const testFiles = fs.readdirSync(path.join(__dirname, '..', 'test'))
  .filter((name) => name.endsWith('.test.cjs') && !excluded.has(name))
  .sort()
  .map((name) => path.join(__dirname, '..', 'test', name));

const result = spawnSync(process.execPath, ['--test', ...testFiles], { stdio: 'inherit' });
process.exit(result.status ?? 1);
