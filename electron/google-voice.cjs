const crypto = require('crypto');

function normalizePhoneNumber(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7) return '';
  // Google Voice may show the same US caller as either +1XXXXXXXXXX or
  // XXXXXXXXXX. Storing the canonical ten-digit suffix makes those forms
  // match while leaving non-US numbers intact.
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function extractPhoneNumber(value) {
  const candidates = String(value || '').match(/(?:\+?[\d(][\d\s().-]{6,}\d)/g) || [];
  return candidates.map(normalizePhoneNumber).find(Boolean) || '';
}

function extractGoogleVoiceItemNumber(sourceUrl) {
  try {
    // Google Voice message URLs identify the open conversation as
    // itemId=t.+1XXXXXXXXXX, which is more reliable than scanning message text.
    const itemId = new URL(String(sourceUrl || '')).searchParams.get('itemId') || '';
    return extractPhoneNumber(itemId);
  } catch {
    return '';
  }
}

function activityFingerprint(input = {}) {
  return crypto.createHash('sha256').update(JSON.stringify({
    phoneNumber: normalizePhoneNumber(input.phoneNumber),
    activityType: String(input.activityType || ''),
    title: String(input.title || ''),
    content: String(input.content || ''),
    sourceUrl: String(input.sourceUrl || ''),
  })).digest('hex');
}

module.exports = { normalizePhoneNumber, extractPhoneNumber, extractGoogleVoiceItemNumber, activityFingerprint };
