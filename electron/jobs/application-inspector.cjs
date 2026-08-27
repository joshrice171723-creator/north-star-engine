const crypto = require('crypto');
const { classifyField } = require('./application-policy.cjs');
const MAX_FIELDS = 300;
const MAX_LABEL = 1000;
const MAX_OPTIONS = 200;
const clean = (value, max = MAX_LABEL) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
const fingerprint = (field) => crypto.createHash('sha256').update(JSON.stringify([field.elementType, field.inputType, field.label, field.name, field.id, field.autocomplete, field.required, field.options])).digest('hex').slice(0, 32);

function normalizeDescriptor(raw = {}) {
  const field = { elementType: clean(raw.elementType, 20).toLowerCase(), inputType: clean(raw.inputType, 40).toLowerCase(), label: clean(raw.label), name: clean(raw.name, 160), id: clean(raw.id, 160), autocomplete: clean(raw.autocomplete, 160), required: Boolean(raw.required), disabled: Boolean(raw.disabled), readOnly: Boolean(raw.readOnly), empty: Boolean(raw.empty), validationMessage: clean(raw.validationMessage, 500), accept: clean(raw.accept, 300), options: Array.isArray(raw.options) ? raw.options.slice(0, MAX_OPTIONS).map((option) => clean(option, 300)).filter(Boolean) : [] };
  field.category = classifyField(field); field.fieldFingerprint = fingerprint(field);
  return field;
}

function normalizeSnapshot(raw = {}) {
  const fields = Array.isArray(raw.fields) ? raw.fields.slice(0, MAX_FIELDS).map(normalizeDescriptor) : [];
  const title = clean(raw.pageTitle, 500); const url = clean(raw.url, 2000);
  const pageFingerprint = crypto.createHash('sha256').update(JSON.stringify([url.replace(/[?#].*$/, ''), title, fields.map((field) => field.fieldFingerprint)])).digest('hex').slice(0, 32);
  const pageSignals = Array.isArray(raw.pageSignals) ? raw.pageSignals.slice(0, 12).map((signal) => clean(signal, 300)).filter(Boolean) : [];
  return { pageTitle: title, fields, pageSignals, pageFingerprint, truncated: Array.isArray(raw.fields) && raw.fields.length > MAX_FIELDS };
}

// This is static audited page code. It returns descriptors only—never field values,
// hidden controls, DOM HTML, scripts, cookies, or arbitrary page text. A small
// allowlisted set of visible status messages is captured because job boards
// can render an expired listing without exposing an actionable control.
const INSPECTION_SCRIPT = `(() => { const clean = (v, n = 1000) => String(v || '').replace(/\\s+/g, ' ').trim().slice(0, n); const labelledText = (el) => el.getAttribute('aria-labelledby') ? Array.from(document.querySelectorAll(el.getAttribute('aria-labelledby').split(/\\s+/).map((id) => '#' + CSS.escape(id)).join(','))).map((node) => node.innerText || node.textContent || '').join(' ') : ''; const labelFor = (el) => { const byFor = el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); const parent = el.closest('label'); const legend = el.closest('fieldset')?.querySelector('legend'); return clean(byFor?.innerText || parent?.innerText || labelledText(el) || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || legend?.innerText || el.name || el.id); }; const isButtonLike = (el) => el.tagName === 'BUTTON' || el.matches('a[role="button"],a[href]'); const isEmpty = (el) => { if (el.type === 'password') return true; if (isButtonLike(el)) return false; if (el.isContentEditable || (!('value' in el) && ['textbox', 'combobox'].includes(el.getAttribute('role')))) return !clean(el.textContent); return !String(el.value || '').trim(); }; const fields = Array.from(document.querySelectorAll('input,select,textarea,button,a[role="button"],a[href],[contenteditable="true"],[role="textbox"],[role="combobox"],[role="radio"],[role="checkbox"]')).filter((el) => el.type !== 'hidden' && el.getAttribute('aria-hidden') !== 'true').slice(0, 300).map((el) => ({ elementType: isButtonLike(el) ? 'button' : el.tagName.toLowerCase(), inputType: (el.type || el.getAttribute('role') || '').toLowerCase(), label: labelFor(el), name: el.name || '', id: el.id || '', autocomplete: el.autocomplete || '', required: !!el.required || el.getAttribute('aria-required') === 'true', disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true', readOnly: !!el.readOnly || el.getAttribute('aria-readonly') === 'true', empty: isEmpty(el), validationMessage: clean(el.validationMessage, 500), accept: el.accept || '', options: el.tagName === 'SELECT' || el.getAttribute('role') === 'combobox' ? Array.from(el.options || el.querySelectorAll('[role="option"]')).slice(0, 200).map((o) => clean(o.text || o.innerText, 300)) : [] })); return { url: location.href, pageTitle: document.title || '', fields }; })()`;

const PAGE_STATUS_SCRIPT = `(() => { const clean = (v) => String(v || '').replace(/\\s+/g, ' ').trim().slice(0, 300); const pattern = /job (?:is )?(?:no longer available|closed|expired)|position (?:has been )?filled|not accepting applications|listing (?:is )?unavailable|this job is no longer available/i; const visible = (el) => { const style = getComputedStyle(el); return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'; }; const text = Array.from(document.querySelectorAll('[role="alert"],[role="status"],[aria-live],.alert,.banner,[class*="alert"],[class*="banner"]')).filter(visible).map((el) => clean(el.innerText || el.textContent)).filter(Boolean).slice(0, 12); if (text.some((value) => pattern.test(value))) return text.filter((value) => pattern.test(value)); const body = clean(document.body?.innerText || '', 5000); const match = body.match(/.{0,90}(?:job (?:is )?(?:no longer available|closed|expired)|position (?:has been )?filled|not accepting applications|listing (?:is )?unavailable|this job is no longer available).{0,90}/i); return match ? [clean(match[0])] : []; })()`;

module.exports = { MAX_FIELDS, MAX_OPTIONS, normalizeDescriptor, normalizeSnapshot, INSPECTION_SCRIPT, PAGE_STATUS_SCRIPT };
