const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { providerAdapters, selectAdapter } = require('../electron/jobs/adapters/index.cjs');

const fixtureDir = path.join(__dirname, 'fixtures', 'provider-adapters');

for (const provider of providerAdapters) {
  test(`${provider.key} supported replay traverses every fixture page without prohibited actions`, () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, `${provider.key}.json`), 'utf8'));
    const adapter = selectAdapter({ url: fixture.url, enableProviderAdapters: true });
    const replay = fixture.pages.map((page, index) => ({
      index,
      step: adapter.detectFormStep({ snapshot: page }),
      requiredFields: adapter.requiredFields(page).length,
      navigationControls: adapter.navigationControls(page).length,
      confirmation: adapter.detectConfirmation({ snapshot: page, url: fixture.url }).state,
      submitRetryBudget: adapter.retryPolicy.submit,
    }));
    assert.equal(replay.length, fixture.pages.length);
    assert.ok(replay.some((entry) => entry.requiredFields > 0));
    assert.equal(replay.at(-1).confirmation, 'confirmed');
    assert.ok(replay.every((entry) => entry.submitRetryBudget === 0));
    assert.equal(adapter.productionEnabled, ['dice', 'workday'].includes(adapter.key), 'only validated Dice and Workday fixture replays are live-enabled');
  });
}
