'use strict';

// MiniSimplify — Simplify-style in-page autofill engine, North Star edition.
// buildMiniSimplifySource() compiles the engine to a self-executing string
// with the approved profile and route policy baked in; main process injects
// it into the employer view via webContents.executeJavaScript.

function msEngineBoot() {
  if (window.MiniSimplify) return;
  const boot = window.__MINISIMPLIFY_BOOT__ || { profile: {}, policy: {} };
  const PROFILE = boot.profile || {};
  const POLICY = Object.assign({ route: 'assistant', force: false }, boot.policy || {});
  // Autopilot owns the form end-to-end, so it overwrites stale pre-filled
  // values. The assistant only fills empties unless the user forces a refill —
  // a hand-typed answer mid-session must never be silently wiped.
  const overwriteText = POLICY.route === 'autopilot' || POLICY.force === true;

  // Evidence gating: a field may only be classified from text a human could
  // actually read, or a plain identifier attribute. React state keys like
  // "page.label" and hashes like "b8af6f" are NOT question text — filling
  // based on them writes answers into questions nobody can read.
  const plainIdentifier = (value) => /^[A-Za-z][A-Za-z_-]{2,}$/.test(String(value || '').trim());
  const readableText = (value) => { const s = String(value || '').replace(/\s+/g, ' ').trim(); return s.length >= 3 && /[A-Za-z]{3}/.test(s) && !/^[0-9a-f]{4,}$/i.test(s); };

  function classify(el) {
    const visible = [
      el.getAttribute('aria-label'), el.placeholder,
      el.labels && el.labels[0] && el.labels[0].innerText,
      el.closest('label') && el.closest('label').innerText,
      // ATS-specific attributes (Workday's data-automation-id, Greenhouse and
      // Lever apply-field hooks) are vendor-applied labels for the control.
      el.getAttribute && el.getAttribute('data-automation-id'),
      (function () { const c = el.closest('div'); const l = c && c.querySelector('label,h3,h4,[data-automation-id]'); return l ? l.innerText : ''; })()
    ].map((v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim()).filter(readableText);
    const identifiers = [el.name, el.id].filter(plainIdentifier);
    // Unrecoverable question text: no readable visible label and only hashed
    // or framework-internal attributes. Skip the field entirely — never guess.
    if (!visible.length && !identifiers.length) return null;
    const hints = visible.concat(identifiers).join(' ').toLowerCase();
    const has = function () { for (let i = 0; i < arguments.length; i++) if (arguments[i].test(hints)) return true; return false; };
    if (has(/e-?mail/)) return 'email';
    if (has(/phone|mobile|cell/)) return 'phone';
    if (has(/first.?name/)) return 'firstName';
    if (has(/last.?name|surname|family.?name/)) return 'lastName';
    if (has(/full.?name|^name$|your name/)) return 'fullName';
    if (has(/zip|postal/)) return 'zip';
    if (has(/linked[- ]?in/)) return 'linkedin';
    if (has(/website|portfolio|github/)) return 'website';
    if (has(/city/)) return 'city';
    if (has(/state|province|region/)) return 'state';
    if (has(/salary|pay|compensation|expectation/)) return 'salary';
    if (has(/years.*(experience|exp\b)/)) return 'yearsExp';
    if (has(/degree|education/)) return 'degree';
    return null;
  }

  function setValue(el, val) {
    el.focus();
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
  }

  function setSelect(el, val) {
    const target = String(val).toLowerCase();
    let best = -1; let partial = -1;
    for (let i = 0; i < el.options.length; i++) {
      const text = (el.options[i].text || '').toLowerCase();
      const value = (el.options[i].value || '').toLowerCase();
      if (text === target || value === target) { best = i; break; }
      if (partial < 0 && target.length > 2 && (text.indexOf(target) >= 0 || value.indexOf(target) >= 0)) partial = i;
    }
    if (best < 0) best = partial;
    if (best < 0 || el.selectedIndex === best) return false;
    el.selectedIndex = best;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function isEmpty(el) {
    if (el.tagName === 'SELECT') {
      const firstBlank = !!(el.options.length && el.options[0].value === '');
      return el.selectedIndex <= (firstBlank ? 0 : -1);
    }
    return !String(el.value || '').trim();
  }

  // Yes/no radios are only clicked on DECISIVE keyword evidence. Question
  // phrasing inverts truth ("Are you authorized?" vs "Do you need
  // sponsorship?"), so a bare yes/no is never guessed — undecided groups are
  // reported and handed to the assistant instead.
  function clickRadio(groupName, wantTruthy) {
    const radios = Array.prototype.slice.call(document.querySelectorAll('input[type=radio]')).filter(function (r) { return !groupName || r.name === groupName; });
    const truthyWords = ['yes', 'true', 'authorized to work', 'authorized', 'do not require', "don't require", 'eligible', 'us citizen'];
    const falsyWords = ['require sponsorship', 'requires sponsorship', 'need sponsorship', 'not authorized', 'no', 'false'];
    for (let i = 0; i < radios.length; i++) {
      const r = radios[i];
      const txt = [r.value, r.labels && r.labels[0] && r.labels[0].innerText, r.closest('label') && r.closest('label').innerText, r.parentElement && r.parentElement.innerText].filter(Boolean).join(' ').toLowerCase();
      const truthyHit = truthyWords.some(function (w) { return txt.indexOf(w) >= 0; });
      const falsyHit = falsyWords.some(function (w) { return txt.indexOf(w) >= 0; });
      const decisive = (wantTruthy && truthyHit && !falsyHit) || (!wantTruthy && falsyHit && !truthyHit);
      if (decisive) { r.click(); return true; }
    }
    return false;
  }

  function injectFile(inputEl, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    inputEl.files = dt.files;
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Employer sites (Workday especially) hide input[type=file] behind styled
  // buttons and open shadow roots. Discovery walks light DOM and every open
  // shadow root; hidden inputs are included so slot matching can still find
  // them by their surrounding label text.
  function fileInputs() {
    const found = [];
    const collect = (root) => {
      if (!root || !root.querySelectorAll) return;
      for (const input of root.querySelectorAll('input[type=file]')) found.push(input);
      for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) collect(el.shadowRoot); }
    };
    collect(document);
    return found;
  }

  function slotContextLabel(inputEl) {
    let ctx = inputEl;
    for (let k = 0; k < 6 && ctx; k++) {
      // Cross the shadow-root boundary while walking up toward visible text.
      ctx = ctx.parentElement || (ctx.getRootNode && ctx.getRootNode() !== document && ctx.getRootNode().host) || null;
      if (!ctx || !ctx.querySelector) continue;
      const heading = ctx.querySelector('h1,h2,h3,h4,label,[class*=label],[class*=Label],[data-automation-id],button');
      const text = heading ? (heading.innerText || heading.getAttribute('data-automation-id') || '') : '';
      if (String(text).trim()) return String(text).replace(/\s+/g, ' ').slice(0, 60);
    }
    return '';
  }

  window.MiniSimplify = {
    policy: POLICY,
    async scanAndFill() {
      const report = { filled: [], kept: [], skipped: [], undecided: [], policy: POLICY };
      const els = document.querySelectorAll('input:not([type=file]):not([type=hidden]):not([type=radio]):not([type=checkbox]):not([type=submit]):not([type=button]), textarea, select');
      for (const el of els) {
        if (el.disabled || el.readOnly) continue;
        const key = classify(el);
        if (!key) continue;
        const val = PROFILE[key];
        if (val === undefined || val === null || val === '') continue;
        if (!isEmpty(el) && !overwriteText) { report.kept.push(key); continue; }
        try {
          if (el.tagName === 'SELECT') {
            if (setSelect(el, String(val))) report.filled.push(key + '→select:' + (el.name || el.id || 'ok'));
            else report.skipped.push(key + ':no-matching-option');
          } else {
            setValue(el, String(val));
            report.filled.push(key + '→' + (el.name || el.id || 'ok'));
          }
        } catch (e) { report.skipped.push(key + ':' + String(e).slice(0, 40)); }
      }
      const groups = Array.prototype.slice.call(document.querySelectorAll('input[type=radio]')).map(function (r) { return r.name; }).filter(function (name, index, all) { return name && all.indexOf(name) === index; });
      // EEO / self-identification questions are never answered by the engine.
      // They are demographic disclosures, not candidate evidence; report them
      // explicitly so they surface for deliberate user review.
      const eeoGroup = /gender|race|ethnic|sexual.?orientation|lgbtq|veteran.?status.?detail|eeo|self.?identify/i;
      const ynMap = [
        [/sponsor/i, !PROFILE.sponsor],
        [/veteran/i, PROFILE.veteran],
        [/disabilit/i, PROFILE.disability],
        [/relocat/i, PROFILE.relocate],
        [/remote/i, PROFILE.remoteOk],
        [/authoriz/i, true]
      ];
      for (const g of groups) {
        if (eeoGroup.test(g)) { report.skipped.push('radio:' + g + ':eeo_self_identification'); continue; }
        for (const entry of ynMap) {
          if (entry[0].test(g)) {
            if (clickRadio(g, entry[1])) report.filled.push('radio:' + g);
            else report.undecided.push('radio:' + g);
            break;
          }
        }
      }
      return report;
    },
    // Multi-step form awareness: employer applications frequently paginate one
    // section per page. Surfacing the current step and the presence of a safe
    // Next/Continue control lets the queue pace itself per step instead of
    // treating a healthy multi-page form as a stalled flow.
    detectProgress() {
      const bodyText = String(document.body ? document.body.innerText : '').slice(0, 20000);
      const stepMatch = bodyText.match(/step\s+(\d{1,2})\s+(?:of|\/)\s+(\d{1,2})/i) || bodyText.match(/(\d{1,2})\s+of\s+(\d{1,2})\s+(?:sections|pages|steps)/i);
      const nextControl = Array.prototype.slice.call(document.querySelectorAll('button,[role=button],input[type=submit],a[href]')).find(function (el) {
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
        return /^(next|continue|save and continue|next step)\b/i.test(String(el.innerText || el.value || '').replace(/\s+/g, ' ').trim());
      });
      return {
        step: stepMatch ? Number(stepMatch[1]) : null,
        totalSteps: stepMatch ? Number(stepMatch[2]) : null,
        nextControlPresent: Boolean(nextControl),
        fieldCount: document.querySelectorAll('input:not([type=file]):not([type=hidden]), textarea, select').length
      };
    },
    // Bytes come from the main process (read from the selected local files),
    // so no CORS and no binary corruption. `which` is an inspectFiles() slot
    // index, or 'all'.
    async fillFileFromBase64(b64, filename, which) {
      const bin = atob(String(b64).trim());
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const inputs = fileInputs();
      const out = [];
      for (let i = 0; i < inputs.length; i++) {
        if (which !== 'all' && Number(which) !== i) continue;
        const file = new File([bytes], filename, { type: 'application/pdf' });
        injectFile(inputs[i], file);
        out.push({ index: i, name: filename, size: bytes.length });
      }
      return out;
    },
    async fillFile(url, filename, which) {
      const res = await fetch(url);
      const b64 = btoa(unescape(encodeURIComponent(await res.text())));
      return this.fillFileFromBase64(b64, filename, which);
    },
    inspectFiles() {
      return fileInputs().map(function (inp, i) {
        return { i: i, visible: !!(inp.offsetParent || (inp.checkVisibility && inp.checkVisibility())), label: slotContextLabel(inp) };
      });
    }
  };
}

function buildMiniSimplifySource({ profile = {}, policy = {} } = {}) {
  return 'window.__MINISIMPLIFY_BOOT__ = { profile: ' + JSON.stringify(profile) +
    ', policy: ' + JSON.stringify(policy) + ' };(' + msEngineBoot.toString() + ')();';
}

// Maps a North Star profile record onto the engine's field vocabulary.
function buildMiniSimplifyProfile({ profile = {}, job = {} } = {}) {
  const text = (v) => String(v == null ? '' : v).trim();
  return {
    fullName: text([profile.firstName, profile.lastName].filter(Boolean).join(' ')) || text(profile.fullName),
    firstName: text(profile.firstName),
    lastName: text(profile.lastName),
    email: text(profile.email),
    phone: text(profile.phone),
    city: text(profile.city),
    state: text(profile.state),
    zip: text(profile.postalCode || profile.zip),
    address: text(profile.street),
    salary: text(job.salaryExpectation || profile.salaryExpectation || profile.desiredSalary),
    linkedin: text(profile.linkedinUrl || profile.linkedin),
    website: text(profile.websiteUrl || profile.portfolio || profile.website),
    yearsExp: text(profile.yearsExperience),
    degree: text(profile.degree || profile.education),
    sponsor: Boolean(profile.requiresSponsorship),
    veteran: Boolean(profile.veteranStatus || profile.veteran),
    disability: Boolean(profile.disabilityStatus || profile.disability),
    relocate: profile.openToRelocation !== false,
    remoteOk: profile.openToRemote !== false
  };
}

module.exports = { buildMiniSimplifySource, buildMiniSimplifyProfile, msEngineBoot };
