// ==UserScript==
// @name         CHR Fax Owner Tagger
// @namespace    matt-family-med-stratford
// @version      0.1.2
// @description  Marks unsorted faxes in the CHR inbox that CHR's own AI suggests belong to Dr. Matt MacDonald ("MM" = top suggestion, "MM?" = second suggestion). Uses only data CHR already provides; nothing leaves the browser and nothing about patients is stored.
// @author       Matt
// @match        https://*.inputhealth.com/*
// @match        https://*.chr.md/*
// @match        https://*.telushealth.com/*
// @grant        none
// @run-at       document-start
// @homepageURL  https://github.com/drmic-cmd/chr-userscripts
// @supportURL   https://github.com/drmic-cmd/chr-userscripts/issues
// @updateURL    https://raw.githubusercontent.com/drmic-cmd/chr-userscripts/main/chr-fax-owner-tagger.user.js
// @downloadURL  https://raw.githubusercontent.com/drmic-cmd/chr-userscripts/main/chr-fax-owner-tagger.user.js
// ==/UserScript==

/*
=====================================================================================
 HOW IT WORKS
-------------------------------------------------------------------------------------
 1. When the inbox loads, CHR fetches the list of items (/inbox/search). This script
    reads that list as it arrives.
 2. For each unsorted fax (no patient attached yet), it asks CHR for the same file
    details CHR requests when someone clicks the fax (/respondents/static-files/.../view).
    That response includes CHR's AI "suggested document owners".
 3. If Dr. MacDonald is the first suggestion the row gets "MM"; if second, "MM?".
    Everything else is left unmarked.

 NOTES
   - Each background lookup is logged by CHR as a view by whoever is logged in,
     exactly like clicking the fax. Install only on Dr. MacDonald's and his MOA's
     computers.
   - Read-only: it never assigns, moves, renames or edits anything.
   - Results live in memory only (item ID -> verdict) and vanish on reload.
     The only thing saved is the on/off state of "Dim others".
   - Alt+Shift+M toggles a small diagnostics readout (counts only, no patient data).
=====================================================================================
*/

(function () {
  'use strict';

  const IS_TOP = window.top === window;
  if (!IS_TOP) return; // frames are hooked from the top window below

  const CONCURRENCY = 3;
  const DIM_KEY = 'mmFaxTagger.dimOthers';

  // ---------- state (no patient data kept) ----------
  const items = new Map();     // inbox item id -> minimal item info used for lookups
  const verdicts = new Map();  // inbox item id -> 'mine' | 'maybe' | 'other' | 'unknown' | 'error'
  const queued = new Set();
  const queue = [];
  let active = 0;
  let pathVariant = null;      // which item field the /view URL uses: 'token' or 'rid'
  let learnedHeaders = {};     // headers CHR's own app sends (kept in memory only)
  let apiOrigin = null;        // CHR's data server (e.g. https://sfht.ca.inputhealth.com), learned from its own requests
  let apiWithCreds = true;     // whether CHR's own requests send login cookies cross-site
  const API_PATH = /\/inbox\/search|\/static-files\/[^/]+\/view/;
  const diag = { lists: 0, lookups: 0, lookupErrors: 0, rowsVue: 0, rowsText: 0, rowsNone: 0, lastErrors: [],
    windows: 0, apiSeen: 0, parseFails: 0, rowsFound: 0 };

  let dimOthers = false;
  try { dimOthers = localStorage.getItem(DIM_KEY) === '1'; } catch (e) { /* ignore */ }

  // ---------- name matching ----------
  function isMe(owner) {
    if (!owner) return false;
    const ln = String(owner.lastName || owner.last_name || '').toLowerCase().replace(/[^a-z]/g, '');
    if (!/^ma?cdonald$/.test(ln)) return false;
    const fn = String(owner.firstName || owner.first_name || '').toLowerCase().replace(/[^a-z]/g, '');
    return !fn || fn === 'm' || fn.startsWith('matt');
  }

  function verdictFromView(data) {
    const owners = (data && data.document_info_suggestions &&
      data.document_info_suggestions.suggested_document_owners) || [];
    const idx = owners.findIndex(isMe);
    if (idx === 0) return 'mine';
    if (idx > 0) return 'maybe';
    return owners.length ? 'other' : 'unknown';
  }

  // ---------- inbox list ingestion ----------
  function isUnsorted(it) {
    const rs = it.resource_summary || {};
    return !it.archived && !rs.patient_attributes && !!(it.resource_token || it.resource_id);
  }

  function ingestList(data) {
    const list = data && data.inbox_items;
    if (!Array.isArray(list)) return;
    diag.lists++;
    list.forEach(it => {
      if (!it || it.id == null) return;
      const rs = it.resource_summary || {};
      items.set(it.id, {
        id: it.id,
        token: it.resource_token,
        rid: it.resource_id,
        times: [it.created_at, rs.date_of_added, rs.created_at].filter(Boolean),
        titles: [rs.title, rs.name].filter(Boolean),
        unsorted: isUnsorted(it)
      });
      if (isUnsorted(it) && !verdicts.has(it.id) && !queued.has(it.id)) {
        queued.add(it.id);
        queue.push(it.id);
      }
    });
    pump();
    scheduleRefresh();
  }

  // When CHR itself opens a fax, learn which ID form the URL uses and take the verdict for free.
  function learnFromPageView(url, data) {
    try {
      const u = new URL(url, location.href);
      const m = u.pathname.match(/\/static-files\/([^/]+)\/view/);
      const itemId = Number(u.searchParams.get('item_id'));
      if (!m || !itemId) return;
      const it = items.get(itemId);
      if (it) {
        if (String(it.token) === m[1]) pathVariant = 'token';
        else if (String(it.rid) === m[1]) pathVariant = 'rid';
      }
      if (data && !verdicts.has(itemId)) {
        verdicts.set(itemId, verdictFromView(data));
        scheduleRefresh();
      }
    } catch (e) { /* ignore */ }
  }

  // ---------- background lookups ----------
  function viewUrl(it, variant) {
    const seg = variant === 'rid' ? it.rid : it.token;
    return (apiOrigin || '') + '/respondents/static-files/' + encodeURIComponent(seg) + '/view?item_id=' + encodeURIComponent(it.id);
  }

  function getJson(url) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.__mmOwn = true;
      xhr.open('GET', url);
      if (apiOrigin && apiOrigin !== location.origin) xhr.withCredentials = apiWithCreds;
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      Object.keys(learnedHeaders).forEach(h => {
        try { xhr.setRequestHeader(h, learnedHeaders[h]); } catch (e) { /* ignore */ }
      });
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); } catch (e) { reject(new Error('bad JSON')); }
        } else reject(Object.assign(new Error('HTTP ' + xhr.status), { status: xhr.status }));
      };
      xhr.onerror = () => reject(new Error('network error'));
      xhr.send();
    });
  }

  async function lookup(id) {
    const it = items.get(id);
    if (!it) return;
    const order = pathVariant ? [pathVariant] : ['token', 'rid'];
    let lastErr;
    for (const variant of order) {
      if ((variant === 'token' && !it.token) || (variant === 'rid' && !it.rid)) continue;
      try {
        diag.lookups++;
        const data = await getJson(viewUrl(it, variant));
        pathVariant = variant;
        verdicts.set(id, verdictFromView(data));
        return;
      } catch (err) {
        lastErr = err;
        if (err.status === 401 || err.status === 403) break; // auth problem: don't keep trying
      }
    }
    diag.lookupErrors++;
    if (diag.lastErrors.length < 3) diag.lastErrors.push(String(lastErr && lastErr.message));
    verdicts.set(id, 'error');
  }

  function pump() {
    while (active < CONCURRENCY && queue.length) {
      const id = queue.shift();
      active++;
      lookup(id).finally(() => {
        active--;
        queued.delete(id);
        scheduleRefresh();
        pump();
      });
    }
  }

  // ---------- network hooks (top window + same-origin frames) ----------
  function sameOrigin(url) {
    try { return new URL(url, location.href).origin === location.origin; } catch (e) { return false; }
  }

  function handleResponse(url, text) {
    if (!/\/inbox\/search|\/static-files\/[^/]+\/view/.test(url)) return;
    let data;
    try { data = JSON.parse(text); } catch (e) { diag.parseFails++; return; }
    if (/\/inbox\/search/.test(url)) ingestList(data);
    else learnFromPageView(url, data);
  }

  function hookWindow(w) {
    if (!w || w.__mmTaggerHooked) return;
    w.__mmTaggerHooked = true;
    diag.windows++;

    const XP = w.XMLHttpRequest && w.XMLHttpRequest.prototype;
    if (XP) {
      const XO = XP.open, XS = XP.send, XH = XP.setRequestHeader;
      XP.open = function (method, url) {
        this.__mm = { url: String(url), headers: {} };
        return XO.apply(this, arguments);
      };
      XP.setRequestHeader = function (name, value) {
        if (this.__mm) this.__mm.headers[name] = value;
        return XH.apply(this, arguments);
      };
      XP.send = function () {
        const info = this.__mm;
        if (info && !this.__mmOwn && API_PATH.test(info.url)) {
          diag.apiSeen++;
          // Remember where CHR's data server is and how CHR talks to it, so our lookups look identical.
          try { apiOrigin = new URL(info.url, location.href).origin; } catch (e) { /* ignore */ }
          apiWithCreds = !!this.withCredentials || (apiOrigin === location.origin);
          const h = {};
          Object.keys(info.headers).forEach(k => {
            if (!/^(content-type|content-length|accept)$/i.test(k)) h[k] = info.headers[k];
          });
          if (Object.keys(h).length) learnedHeaders = h;
          {
            const xhr = this;
            xhr.addEventListener('load', () => {
              try {
                if (xhr.responseType === '' || xhr.responseType === 'text') handleResponse(info.url, xhr.responseText);
                else if (xhr.responseType === 'json') handleResponse(info.url, JSON.stringify(xhr.response));
              } catch (e) { /* ignore */ }
            });
          }
        }
        return XS.apply(this, arguments);
      };
    }

    const wFetch = w.fetch;
    if (wFetch) {
      w.fetch = function (input) {
        const p = wFetch.apply(this, arguments);
        try {
          const url = typeof input === 'string' ? input : (input && input.url) || '';
          if (API_PATH.test(url)) {
            diag.apiSeen++;
            try { apiOrigin = new URL(url, location.href).origin; } catch (e) { /* ignore */ }
            p.then(res => res.clone().text().then(t => handleResponse(url, t))).catch(() => {});
          }
        } catch (e) { /* ignore */ }
        return p;
      };
    }
  }

  hookWindow(window);
  function hookFrames(w, depth) {
    if (depth > 4) return;
    for (let i = 0; i < w.frames.length; i++) {
      try { void w.frames[i].document; hookWindow(w.frames[i]); hookFrames(w.frames[i], depth + 1); }
      catch (e) { /* cross-origin */ }
    }
  }
  setInterval(() => hookFrames(window, 0), 500);
  new MutationObserver(muts => {
    for (const m of muts) {
      m.addedNodes.forEach(n => {
        if (n.tagName === 'IFRAME') { try { hookWindow(n.contentWindow); } catch (e) { /* ignore */ } }
      });
    }
  }).observe(document.documentElement || document, { childList: true, subtree: true });

  // ---------- matching table rows to inbox items ----------
  const norm = s => String(s || '').replace(/\s+/g, '').toLowerCase();

  function timeLabel(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return null;
    return norm(d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
  }

  function itemFromVue(tr) {
    const vn = tr.__vnode;
    if (vn) {
      const k = vn.key;
      if (k != null) {
        if (items.has(k)) return items.get(k);
        if (items.has(Number(k))) return items.get(Number(k));
      }
      const vp = vn.props || {};
      const r = vp.row || vp.item;
      if (r && r.id != null && items.has(r.id)) return items.get(r.id);
    }
    let c = tr.__vueParentComponent;
    for (let i = 0; c && i < 8; i++, c = c.parent) {
      const p = c.props || {};
      const cands = [p.row, p.item, p.inboxItem, p.props && p.props.row];
      for (const r of cands) {
        if (r && r.id != null && items.has(r.id)) return items.get(r.id);
      }
    }
    const v2 = tr.__vue__; // Vue 2 fallback
    if (v2) {
      for (let c2 = v2, i = 0; c2 && i < 8; i++, c2 = c2.$parent) {
        const r = c2.row || c2.item || (c2.$props && (c2.$props.row || c2.$props.item));
        if (r && r.id != null && items.has(r.id)) return items.get(r.id);
      }
    }
    return null;
  }

  function itemFromText(tr) {
    const text = norm(tr.textContent);
    const matches = [];
    for (const it of items.values()) {
      if (!it.unsorted) continue;
      const timeOk = it.times.some(t => { const l = timeLabel(t); return l && text.startsWith(l); });
      if (!timeOk) continue;
      const titleOk = it.titles.some(t => norm(t).length > 10 && text.includes(norm(t)));
      if (titleOk) matches.push(it);
    }
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      // Ambiguous (same minute, same title): only usable if they all agree.
      const vs = new Set(matches.map(m => verdicts.get(m.id)));
      return vs.size === 1 ? matches[0] : null;
    }
    return null;
  }

  function rowItem(tr) {
    let it = itemFromVue(tr);
    if (it) { diag.rowsVue++; return it; }
    it = itemFromText(tr);
    if (it) { diag.rowsText++; return it; }
    diag.rowsNone++;
    return null;
  }

  // ---------- drawing ----------
  function injectStyle() {
    if (document.getElementById('mm-tagger-style')) return;
    const st = document.createElement('style');
    st.id = 'mm-tagger-style';
    st.textContent =
      'tr[data-mm-row] > td{background:rgba(15,123,108,.12) !important;}' +
      'tr[data-mm-row="MM?"] > td{background:rgba(15,123,108,.05) !important;}' +
      'td[data-mm]::before{content:attr(data-mm);display:inline-block;margin-right:6px;padding:1px 6px;' +
      'border-radius:9px;font:600 11px/16px system-ui,sans-serif;vertical-align:middle;}' +
      'td[data-mm="MM"]::before{background:#0f7b6c;color:#fff;}' +
      'td[data-mm="MM?"]::before{background:#fff;color:#0f7b6c;border:1px solid #0f7b6c;}' +
      'tr[data-mm-dim]{opacity:.35;}' +
      '#mm-tagger-chip{position:fixed;left:16px;bottom:16px;z-index:2147483646;background:#fff;color:#222;' +
      'border:1px solid #0f7b6c;border-radius:16px;padding:4px 6px 4px 12px;font:12px/20px system-ui,sans-serif;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.15);display:none;align-items:center;gap:8px;}' +
      '#mm-tagger-chip button{border:1px solid #0f7b6c;background:#fff;color:#0f7b6c;border-radius:12px;' +
      'padding:0 10px;font:12px/20px system-ui,sans-serif;cursor:pointer;}' +
      '#mm-tagger-chip button[aria-pressed="true"]{background:#0f7b6c;color:#fff;}' +
      '#mm-tagger-chip pre{margin:0;font:11px/1.3 ui-monospace,monospace;white-space:pre-wrap;}';
    (document.head || document.documentElement).appendChild(st);
  }

  let chip, chipText, dimBtn, diagEl, showDiag = false;
  function ensureChip() {
    if (chip || !document.body) return;
    chip = document.createElement('div');
    chip.id = 'mm-tagger-chip';
    chipText = document.createElement('span');
    dimBtn = document.createElement('button');
    dimBtn.type = 'button';
    dimBtn.textContent = 'Dim others';
    dimBtn.addEventListener('click', () => {
      dimOthers = !dimOthers;
      try { localStorage.setItem(DIM_KEY, dimOthers ? '1' : '0'); } catch (e) { /* ignore */ }
      scheduleRefresh();
    });
    chip.append(chipText, dimBtn);
    document.body.appendChild(chip);

    // Diagnostics box is separate from the chip so it can show even when nothing has been found.
    diagEl = document.createElement('pre');
    diagEl.id = 'mm-tagger-diag';
    diagEl.style.cssText = 'position:fixed;left:16px;bottom:56px;z-index:2147483647;display:none;margin:0;' +
      'padding:8px 10px;background:#fff;color:#222;border:1px solid #0f7b6c;border-radius:8px;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.15);font:11px/1.4 ui-monospace,monospace;white-space:pre-wrap;user-select:text;';
    document.body.appendChild(diagEl);
  }

  function badgeCell(tr) {
    const tds = tr.querySelectorAll('td');
    for (const td of tds) if (/incoming\s*fax/i.test(td.textContent)) return td;
    return tds[3] || tds[tds.length - 1] || null;
  }

  function applyRow(tr) {
    const td = badgeCell(tr);
    if (!td) return;
    const it = rowItem(tr);
    const v = it ? verdicts.get(it.id) : undefined;
    const label = v === 'mine' ? 'MM' : v === 'maybe' ? 'MM?' : null;
    if (label) { if (td.getAttribute('data-mm') !== label) td.setAttribute('data-mm', label); }
    else if (td.hasAttribute('data-mm')) td.removeAttribute('data-mm');
    if (label) { if (tr.getAttribute('data-mm-row') !== label) tr.setAttribute('data-mm-row', label); }
    else if (tr.hasAttribute('data-mm-row')) tr.removeAttribute('data-mm-row');
    // Virtual scrolling reuses row elements, so clear any stale badge in other cells.
    tr.querySelectorAll('td[data-mm]').forEach(c => { if (c !== td) c.removeAttribute('data-mm'); });

    // Dim only rows we are sure are someone else's (or already sorted). Never dim pending or unclear ones.
    const sortedOrOther = it ? (!it.unsorted || v === 'other') : false;
    if (dimOthers && sortedOrOther && !label) tr.setAttribute('data-mm-dim', '');
    else tr.removeAttribute('data-mm-dim');
  }

  // Only touch text when it changes, so our own updates don't re-trigger the page observer.
  function setText(el, t) { if (el.textContent !== t) el.textContent = t; }

  let refreshPending = false;
  function scheduleRefresh() {
    if (refreshPending) return;
    refreshPending = true;
    requestAnimationFrame(() => { refreshPending = false; refresh(); });
  }

  function refresh() {
    injectStyle();
    ensureChip();
    const rows = document.querySelectorAll('tr.ih-table-row');
    diag.rowsFound = rows.length;
    diag.rowsVue = diag.rowsText = diag.rowsNone = 0;
    rows.forEach(applyRow);
    if (!chip) return;
    chip.style.display = rows.length && items.size ? 'flex' : 'none';

    let mine = 0, maybe = 0, unclear = 0;
    verdicts.forEach(v => { if (v === 'mine') mine++; else if (v === 'maybe') maybe++; else if (v === 'unknown' || v === 'error') unclear++; });
    const checking = queue.length + active;
    setText(chipText, 'MM: ' + mine + (maybe ? ' · MM?: ' + maybe : '') +
      (unclear ? ' · unclear: ' + unclear : '') + (checking ? ' · checking ' + checking + '…' : ''));
    dimBtn.setAttribute('aria-pressed', String(dimOthers));

    diagEl.style.display = showDiag ? 'block' : 'none';
    if (showDiag) {
      setText(diagEl,
        'MM Fax Tagger v0.1.2' +
        '\nwindows hooked ' + diag.windows + ' · api requests seen ' + diag.apiSeen + ' · parse fails ' + diag.parseFails +
        '\ndata server ' + (apiOrigin ? (apiOrigin === location.origin ? 'same as page' : 'separate') : 'not seen yet') +
        ' · login headers learned ' + Object.keys(learnedHeaders).length +
        '\ninbox rows on screen ' + diag.rowsFound +
        '\nlists ' + diag.lists + ' · items ' + items.size +
        ' · unsorted ' + [...items.values()].filter(i => i.unsorted).length + ' · verdicts ' + verdicts.size +
        '\nlookups ' + diag.lookups + ' · errors ' + diag.lookupErrors + ' · url form ' + (pathVariant || '?') +
        '\nrows matched: vue ' + diag.rowsVue + ', text ' + diag.rowsText + ', none ' + diag.rowsNone +
        (diag.lastErrors.length ? '\n' + diag.lastErrors.join('\n') : ''));
    }
  }

  function startDom() {
    new MutationObserver(scheduleRefresh).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('scroll', scheduleRefresh, true);
    scheduleRefresh();
  }
  if (document.body) startDom(); else document.addEventListener('DOMContentLoaded', startDom);

  document.addEventListener('keydown', e => {
    if (e.altKey && e.shiftKey && (e.code === 'KeyM' || e.key === 'M' || e.key === 'm')) {
      showDiag = !showDiag;
      refresh();
      e.preventDefault();
    }
  }, true);
})();
