const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { providerAdapters, selectAdapter } = require('../electron/jobs/adapters/index.cjs');

const fixtureDir = path.join(__dirname, 'fixtures', 'provider-adapters');

for (const adapter of providerAdapters) {
  test(`${adapter.key} fixture completes the provider adapter contract`, () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, `${adapter.key}.json`), 'utf8'));
    const selected = selectAdapter({ url: fixture.url, enableProviderAdapters: true });
    assert.equal(selected.key, adapter.key);
    assert.equal(adapter.productionEnabled, ['dice', 'workday'].includes(adapter.key), 'only validated Dice and Workday adapters are live-enabled');
    assert.match(adapter.normalizeApplicationUrl(fixture.url), /^https:\/\//);
    assert.doesNotMatch(adapter.normalizeApplicationUrl(fixture.url), /utm_|tracking|source=/i);

    const first = fixture.pages[0];
    const required = adapter.requiredFields(first);
    assert.ok(required.length >= 1);
    assert.equal(adapter.detectFormStep({ snapshot: first }), 'candidate');
    assert.equal(adapter.navigationControls(first).length, 1);
    assert.equal(adapter.supportedControl(first.fields[0]), true);
    assert.ok(adapter.locateField(first, { name: first.fields[0].name }));

    const questionPage = fixture.pages.find((page) => /question|experience|attachment|resume/i.test(page.pageTitle)) || first;
    assert.equal(typeof adapter.accountFlow({ snapshot: questionPage }).requiresAccount, 'boolean');
    const confirmation = fixture.pages.at(-1);
    assert.equal(adapter.detectConfirmation({ snapshot: confirmation, url: fixture.url }).state, 'confirmed');
    assert.deepEqual(adapter.duplicateMarkers({ text: 'This application was already applied.' }), ['duplicate_application_language']);
    assert.deepEqual(adapter.duplicateMarkers({ text: 'Please complete your application.' }), []);
    assert.equal(adapter.retryPolicy.submit, 0);
    assert.equal(adapter.diagnostics('inspect', 'success').adapterKey, adapter.key);
  });
}

test('provider adapter gate keeps generic detection as the safe default', () => {
  assert.equal(selectAdapter({ url: 'https://jobs.lever.co/acme/abc' }).key, 'generic');
  assert.equal(selectAdapter({ url: 'https://jobs.lever.co/acme/abc', enableProviderAdapters: true }).key, 'lever');
  assert.equal(selectAdapter({ url: 'http://jobs.lever.co/acme/abc', enableProviderAdapters: true }).key, 'generic');
});
