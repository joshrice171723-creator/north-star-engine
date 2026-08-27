const crypto = require('crypto');

const JOB_TERMS = [
  'application', 'applicant', 'candidate', 'interview', 'recruiter', 'recruiting',
  'hiring', 'job opportunity', 'position', 'role', 'offer', 'screening',
  'assessment', 'onsite', 'phone screen', 'technical screen', 'talent acquisition',
];

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function htmlToText(value) {
  return normalizeText(String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>'));
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = String(text || '').match(pattern);
    if (match?.[1]) return normalizeText(match[1].replace(/[<>]/g, ''));
  }
  return '';
}

function extractApplicationConfirmation({ subject = '', body = '', receivedAt = null } = {}) {
  const rawText = `${subject}\n${body}`;
  const text = htmlToText(rawText);
  const explicitConfirmation = /(?:we\s+have\s+sent\s+your\s+.{0,180}\bapplication\b|\bapplication\s+(?:has\s+been\s+)?(?:sent|submitted|received)\b|\bthank\s+you\s+for\s+applying\b|\bapplication\s+for\s+.+\s+(?:sent|submitted)\b)/i.test(text);
  if (!explicitConfirmation) return null;

  // Dice confirmation subjects carry a clean role/employer pair. Prefer it
  // over parsing the HTML body, whose tracking copy can look like employer text.
  const subjectIdentity = String(subject || '').match(/^application\s+for\s+(.+?)\s+at\s+(.+?)\s+sent\s*$/i);
  const roleTitle = firstMatch(text, [
    /we\s+have\s+sent\s+your\s+(.{2,140}?)\s+application\s+to\b/i,
    /application\s+for\s+["“']?(.{2,140}?)["”']?\s+(?:job\s+)?(?:in|at)\b/i,
    /application\s+for\s+(.{2,140}?)\s+(?:sent|submitted)\b/i,
    /job\s+title\s*[:\-]\s*(.{2,140})$/im,
  ]);
  const company = firstMatch(text, [
    /\bapplication\s+to\s+(.{2,120}?)(?:\.|\s+you\s+may\s+want|\s+has\s+been|\s*$)/i,
    /\bat\s+([A-Z][A-Za-z0-9&.,' -]{2,100})\b/i,
  ]);
  const location = firstMatch(text, [
    /\bjob\s+in\s+([A-Za-z .,'-]{2,100})(?:\s+by\s+|\s*$)/i,
    /\blocation\s*[:\-]\s*([A-Za-z0-9 .,'-]{2,100})/i,
  ]);
  const urls = (rawText.match(/https?:\/\/[^\s"'<>]+/gi) || []).map((value) => value.replace(/[),.;]+$/, ''));
  const url = urls.find((value) => /\/details\/|\/land\/ad\/|\/job(?:[-_/]|\.)/i.test(value)) || urls.find((value) => /(?:job|career|adzuna)/i.test(value)) || '';
  const source = (() => { try { return new URL(url).hostname.replace(/^www\./, '').split('.')[0]; } catch { return ''; } })();
  const resolvedRoleTitle = normalizeText(subjectIdentity?.[1] || roleTitle);
  const resolvedCompany = normalizeText(subjectIdentity?.[2] || company);
  if (!resolvedRoleTitle || (!resolvedCompany && !url)) return null;
  const appliedAt = (() => { const parsed = receivedAt ? new Date(receivedAt) : null; return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null; })();
  return { roleTitle: resolvedRoleTitle, company: resolvedCompany, location, url, source, appliedAt, confidence: 'high' };
}

function classifyJobEmail({ subject = '', from = '', body = '', pipelineSignals = [] } = {}) {
  const text = `${subject} ${from} ${body}`.toLowerCase();
  const matchedTerms = JOB_TERMS.filter((term) => text.includes(term));
  const normalizedPipelineSignals = [...new Set(pipelineSignals.map((term) => normalizeText(term).toLowerCase()).filter((term) => term.length >= 3))];
  const matchedPipelineSignals = normalizedPipelineSignals.filter((term) => text.includes(term));
  const score = Math.min(100, matchedTerms.length * 18 + matchedPipelineSignals.length * 35 + (from.toLowerCase().includes('recruit') ? 20 : 0));
  return { isJobRelated: score >= 18, score, matchedTerms, matchedPipelineSignals };
}

function chunkText(text, { size = 1200, overlap = 180 } = {}) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const chunks = [];
  for (let start = 0; start < normalized.length; start += Math.max(1, size - overlap)) {
    const content = normalized.slice(start, start + size).trim();
    if (content) chunks.push({ index: chunks.length, content });
    if (start + size >= normalized.length) break;
  }
  return chunks;
}

function searchChunks(chunks, query, limit = 10) {
  const terms = normalizeText(query).toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 1);
  if (!terms.length) return [];
  return chunks.map((chunk) => {
    const content = String(chunk.content || '').toLowerCase();
    const score = terms.reduce((total, term) => total + (content.includes(term) ? 1 : 0), 0);
    return { ...chunk, score };
  }).filter((chunk) => chunk.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}

function stableEmailId(provider, externalId) {
  return `email-${crypto.createHash('sha256').update(`${provider}:${externalId}`).digest('hex').slice(0, 32)}`;
}

function decodeBase64Url(value) {
  return Buffer.from(String(value || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function header(payload, name) {
  return payload?.headers?.find((entry) => String(entry.name).toLowerCase() === name.toLowerCase())?.value || '';
}

function extractGmailText(payload) {
  // Gmail nests multipart/alternative and multipart/related bodies, so only
  // inspecting the first level can incorrectly produce an empty email body.
  const candidates = [];
  const visit = (part) => {
    if (!part || typeof part !== 'object') return;
    if (part.body?.data && (part.mimeType === 'text/plain' || part.mimeType === 'text/html')) candidates.push(part);
    (Array.isArray(part.parts) ? part.parts : []).forEach(visit);
  };
  visit(payload);
  const textPart = candidates.find((part) => part.mimeType === 'text/plain') || candidates.find((part) => part.mimeType === 'text/html');
  return decodeBase64Url(textPart?.body?.data || payload?.body?.data || '');
}

function normalizeGmailMessage(message, options = {}) {
  const payload = message?.payload || {};
  const subject = normalizeText(header(payload, 'Subject'));
  const from = normalizeText(header(payload, 'From'));
  const to = normalizeText(header(payload, 'To'));
  const receivedAt = header(payload, 'Date') || null;
  const body = normalizeText(extractGmailText(payload));
  const classification = classifyJobEmail({ subject, from, body, pipelineSignals: options.pipelineSignals });
  return { externalId: message.id, threadId: message.threadId || '', subject, from, to, receivedAt, body, ...classification };
}

module.exports = { JOB_TERMS, classifyJobEmail, chunkText, searchChunks, stableEmailId, normalizeGmailMessage, extractApplicationConfirmation };
