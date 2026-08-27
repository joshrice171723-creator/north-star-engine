const test = require('node:test');
const assert = require('node:assert/strict');

test('application panes remain aligned and usable as the desktop window changes size', async () => {
  const { getApplicationLayout } = await import('../src/jobs/applicationLayout.mjs');

  const wide = getApplicationLayout(1920);
  assert.deepEqual(wide, { assistantWidth: 420, browserWidth: 691, browserLeft: 809 });

  const minimum = getApplicationLayout(1100);
  assert.deepEqual(minimum, { assistantWidth: 280, browserWidth: 340, browserLeft: 480 });

  const resized = getApplicationLayout(1440, 2000);
  assert.equal(resized.browserWidth, 643);
  assert.equal(resized.browserLeft + resized.browserWidth + resized.assistantWidth, 1440);
});
