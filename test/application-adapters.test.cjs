const test = require('node:test'); const assert = require('node:assert/strict');
const { selectAdapter, boundedDiagnostic } = require('../electron/jobs/adapters/index.cjs');
test('unknown ATS pages use the non-mutating generic adapter and diagnostics are bounded', () => { const adapter = selectAdapter({ url: 'https://unknown.test/apply' }); assert.equal(adapter.key, 'generic'); assert.throws(() => adapter.fillSupportedControl()); assert.equal(boundedDiagnostic({ adapterKey: 'x'.repeat(100), durationMs: 999999 }).adapterKey.length, 80); });
