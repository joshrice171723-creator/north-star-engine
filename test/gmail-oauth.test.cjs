const test = require('node:test');
const assert = require('node:assert/strict');
const { tokenIsUsable, refreshGmailAccessToken, createPkcePair, buildGmailAuthorizationUrl } = require('../electron/gmail-oauth.cjs');

test('builds a PKCE authorization URL for the Google sign-in window', () => {
  const pkce = createPkcePair(() => Buffer.from('test-verifier-seed-012345678901234567890123456789'));
  const url = new URL(buildGmailAuthorizationUrl({ clientId: 'client-id', redirectUri: 'http://127.0.0.1:1234/oauth2callback', state: 'state', codeChallenge: pkce.challenge }));
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:1234/oauth2callback');
});

test('refreshes an expired Gmail access token with the stored refresh token', async () => {
  let request;
  const result = await refreshGmailAccessToken({
    refreshToken: 'refresh-secret', clientId: 'client-id', clientSecret: 'client-secret',
    fetchImpl: async (_url, options) => {
      request = options;
      return { ok: true, status: 200, json: async () => ({ access_token: 'new-access', expires_in: 3600 }) };
    },
  });
  assert.equal(result.accessToken, 'new-access');
  assert.match(request.body, /grant_type=refresh_token/);
  assert.match(request.body, /refresh_token=refresh-secret/);
  assert.equal(tokenIsUsable(result), true);
});

test('reports OAuth refresh failures without hiding the provider error', async () => {
  await assert.rejects(
    refreshGmailAccessToken({ refreshToken: 'refresh-secret', clientId: 'id', clientSecret: 'secret', fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) }) }),
    /invalid_grant/,
  );
});
