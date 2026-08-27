const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'jobs', 'application-browser.cjs'), 'utf8');
test('browser fill uses structured CDP arguments and has no submit activation path', () => { assert.match(source, /Runtime\.callFunctionOn/); assert.match(source, /arguments: \[\{ value: operations \}\]/); assert.doesNotMatch(source, /requestSubmit\(|\.submit\(|\.click\(/); });
