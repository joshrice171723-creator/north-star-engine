const GMAIL_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GMAIL_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/userinfo.email'];

function tokenIsUsable(credentials, now = Date.now()) {
  return Boolean(credentials?.accessToken)
    && (!Number.isFinite(credentials.expiresAt) || credentials.expiresAt > now + 60_000);
}

async function refreshGmailAccessToken({ refreshToken, clientId, clientSecret, fetchImpl = fetch }) {
  if (!refreshToken) throw new Error('A Gmail OAuth refresh token is required.');
  if (!clientId || !clientSecret) throw new Error('Gmail OAuth client credentials are not configured.');
  const response = await fetchImpl(GMAIL_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  let body = {};
  try { body = await response.json(); } catch {}
  if (!response.ok || !body.access_token) {
    const detail = body.error_description || body.error || ('HTTP ' + response.status);
    throw new Error('Gmail OAuth refresh failed: ' + detail);
  }
  return {
    accessToken: body.access_token,
    // Google may omit expires_in for unusual providers; use a conservative
    // short lifetime rather than treating an unknown token as permanent.
    expiresAt: Date.now() + (Number(body.expires_in) > 0 ? Number(body.expires_in) * 1000 : 3_000_000),
  };
}

function createPkcePair(randomBytes = require('crypto').randomBytes) {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = require('crypto').createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function buildGmailAuthorizationUrl({ clientId, redirectUri, state, codeChallenge }) {
  return new URL(GMAIL_AUTH_ENDPOINT).toString() + '?' + new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
    access_type: 'offline', prompt: 'consent', scope: GMAIL_SCOPES.join(' '), state,
    code_challenge: codeChallenge, code_challenge_method: 'S256',
  }).toString();
}

async function exchangeGmailAuthorizationCode({ code, clientId, clientSecret, redirectUri, codeVerifier, fetchImpl = fetch }) {
  const response = await fetchImpl(GMAIL_TOKEN_ENDPOINT, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret || '', redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: codeVerifier }).toString(),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token || !body.refresh_token) throw new Error('Gmail OAuth sign-in failed: ' + (body.error_description || body.error || ('HTTP ' + response.status)));
  return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000 };
}

module.exports = { GMAIL_TOKEN_ENDPOINT, GMAIL_AUTH_ENDPOINT, GMAIL_SCOPES, tokenIsUsable, refreshGmailAccessToken, createPkcePair, buildGmailAuthorizationUrl, exchangeGmailAuthorizationCode };
