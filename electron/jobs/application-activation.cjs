const crypto = require('node:crypto');

const ACTIVATION_CODE_PATTERN = /\b(?:code|verification|verify|activation)\D{0,24}([A-Z0-9]{6,10})\b/i;
const ACTIVATION_LANGUAGE = /activate|activation|verify(?: your)? (?:email|account)|confirm(?: your)? (?:email|account)|verification/i;
const NON_ACTIVATION_LANGUAGE = /unsubscribe|newsletter|job alert|marketing|password reset/i;

function normalizeHost(value) {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
}

function normalizeEmail(value) {
  const text = String(value || '').trim().toLowerCase();
  return (text.match(/<([^>]+)>/)?.[1] || text).replace(/^mailto:/, '').trim();
}

function redactActivationUrl(value) {
  try {
    const url = new URL(String(value || ''));
    url.search = '';
    url.hash = '';
    return `${url.origin}${url.pathname}`.slice(0, 1000);
  } catch {
    return '';
  }
}

function extractActivationUrl(body, host) {
  const expectedHost = normalizeHost(host);
  const urls = String(body || '').match(/https?:\/\/[^\s<>"']+/gi) || [];
  return urls.map((candidate) => candidate.replace(/[),.;]+$/, '')).find((candidate) => {
    try {
      const parsed = new URL(candidate);
      return parsed.protocol === 'https:' && parsed.host === expectedHost && /activate|verify|confirm|welcome/i.test(`${parsed.pathname}${parsed.search}`);
    } catch { return false; }
  }) || '';
}

function activationCandidateFromEmail(email, { host, recipient, requestedAt } = {}) {
  const expectedHost = normalizeHost(host);
  const body = String(email?.body || '').slice(0, 200000);
  const subject = String(email?.subject || '').slice(0, 1000);
  const text = `${subject}\n${body}`;
  const normalizedRecipient = normalizeEmail(recipient);
  const recipients = String(email?.recipients || '').split(/[;,\s]+/).map(normalizeEmail).filter(Boolean);
  if (!expectedHost || (normalizedRecipient && recipients.length && !recipients.includes(normalizedRecipient))) return null;
  if (NON_ACTIVATION_LANGUAGE.test(text) || !ACTIVATION_LANGUAGE.test(text)) return null;
  const senderHost = normalizeEmail(email?.sender || email?.from).split('@')[1] || '';
  const activationUrl = extractActivationUrl(body, expectedHost);
  const code = body.match(ACTIVATION_CODE_PATTERN)?.[1]?.toUpperCase() || '';
  if (!activationUrl && !code) return null;
  if (senderHost && senderHost !== expectedHost && !/no-reply|noreply|support|account|verify/i.test(normalizeEmail(email?.sender || email?.from))) return null;
  if (requestedAt && email?.receivedAt && new Date(email.receivedAt).getTime() < new Date(requestedAt).getTime()) return null;
  return {
    messageId: String(email.id || email.externalId || '').slice(0, 160),
    externalId: String(email.externalId || '').slice(0, 300),
    receivedAt: email.receivedAt || null,
    activationUrl: activationUrl || '',
    activationUrlRedacted: redactActivationUrl(activationUrl),
    code: code || '',
    codeHash: code ? crypto.createHash('sha256').update(code).digest('hex') : '',
    signals: ['activation_language', activationUrl ? 'matching_activation_url' : 'one_time_code'].slice(0, 5),
  };
}

function matchActivationEmails(emails, context = {}) {
  const candidates = (Array.isArray(emails) ? emails : [])
    .map((email) => activationCandidateFromEmail(email, context))
    .filter(Boolean)
    .sort((a, b) => String(b.receivedAt || '').localeCompare(String(a.receivedAt || '')));
  return candidates[0] || null;
}

function credentialReference(host, username) {
  const identity = `${normalizeHost(host)}\0${normalizeEmail(username)}`;
  return `external-${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 32)}`;
}

module.exports = { normalizeHost, normalizeEmail, redactActivationUrl, activationCandidateFromEmail, matchActivationEmails, credentialReference };
