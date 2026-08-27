const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApplyPilotBridge } = require('../electron/jobs/applypilot-bridge.cjs');

function request(port, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'content-type': 'application/json', ...headers } }, (res) => {
      let raw = ''; res.on('data', (chunk) => { raw += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
    });
    req.on('error', reject); req.end(JSON.stringify(body));
  });
}

test('ApplyPilot bridge binds one-use sessions to application and host and redacts values', async () => {
  const bridge = createApplyPilotBridge({ port: 38749 });
  await bridge.start();
  try {
    const pairing = bridge.issueSession({ applicationId: 'app-1', employerHost: 'https://jobs.example.test' });
    const claimed = await request(38749, '/v1/session/claim', { token: pairing.token, employerHost: 'jobs.example.test' });
    assert.equal(claimed.status, 200);
    assert.equal((await request(38749, '/v1/session/claim', { token: pairing.token, employerHost: 'jobs.example.test' })).status, 400);
    const auth = { 'x-north-star-session': claimed.body.session.sessionToken };
    const observation = await request(38749, '/v1/application/observation', { applicationId: 'app-1', employerHost: 'jobs.example.test', requestId: 'observe-1', pageFingerprint: 'page-1', fields: [{ fingerprint: 'f-1', label: 'Email', value: 'secret@example.test', options: ['a'] }] }, auth);
    assert.equal(observation.status, 200);
    assert.equal(observation.body.observation.fields[0].optionCount, 1);
    assert.equal('value' in observation.body.observation.fields[0], false);
    const replay = await request(38749, '/v1/application/observation', { applicationId: 'app-1', employerHost: 'jobs.example.test', requestId: 'observe-1', pageFingerprint: 'changed', fields: [] }, auth);
    assert.deepEqual(replay.body, observation.body);
    assert.equal((await request(38749, '/v1/application/result', { applicationId: 'other', employerHost: 'jobs.example.test', requestId: 'result-1', status: 'filled' }, auth)).status, 400);
  } finally { await bridge.stop(); }
});
