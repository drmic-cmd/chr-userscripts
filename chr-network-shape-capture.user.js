// ==UserScript==
// @name         CHR Network Shape Capture
// @namespace    matt-family-med-stratford
// @version      0.1.0
// @description  Records the SHAPE of CHR's own network traffic (URL patterns with IDs stripped, JSON field names and value types) so automation can be designed without ever capturing patient data. Values are never recorded. Makes no network calls of its own; nothing leaves the browser.
// @author       Matt
// @match        https://*.inputhealth.com/*
// @match        https://*.chr.md/*
// @match        https://*.telushealth.com/*
// @grant        none
// @run-at       document-start
// @homepageURL  https://github.com/drmic-cmd/chr-userscripts
// @supportURL   https://github.com/drmic-cmd/chr-userscripts/issues
// @updateURL    https://raw.githubusercontent.com/drmic-cmd/chr-userscripts/main/chr-network-shape-capture.user.js
// @downloadURL  https://raw.githubusercontent.com/drmic-cmd/chr-userscripts/main/chr-network-shape-capture.user.js
// ==/UserScript==

/*
=====================================================================================
 WHAT THIS IS FOR
-------------------------------------------------------------------------------------
 Designing the fax-inbox doctor tagger needs to know HOW CHR loads the inbox list
 and the fax PDFs. This tool watches CHR's own requests and records only:
   - method + URL pattern (numbers, IDs, tokens and query VALUES replaced)
   - status, content type, size
   - for JSON: field NAMES and value TYPES (e.g. "fromNumber: str(phone-like)")
 It never records string contents, numbers, dates, or names.

 HOW TO USE
   1. Alt+Shift+N opens/closes the panel. Recording is OFF until you press Start.
   2. Press Start, then: open Inbox -> Cedar Pod Fax tab -> open ONE unsorted fax.
   3. With the fax open, press "Scan viewer" (reports how the PDF is displayed).
   4. Press Stop, glance over the list, then "Copy all" and paste into Claude.
 Recording lives in memory only; reloading the page clears it.
=====================================================================================
*/

(function () {
  'use strict';

  const MAX_DEPTH = 6;
  const MAX_KEYS = 80;
  const SKIP_EXT = /\.(js|css|png|jpe?g|gif|svg|woff2?|ttf|ico|map)(\?|$)/i;

  let recording = false;
  const entries = new Map(); // key -> entry (deduplicated by method + pattern)

  // ---------- redaction ----------
  function redactSegment(seg) {
    if (!seg) return seg;
    if (/^[a-z_-]+$/.test(seg) && seg.length <= 40) return seg; // plain API words
    if (/^v\d+$/i.test(seg)) return seg;                         // version like v2
    if (/^\d+$/.test(seg)) return '{num}';
    if (/^[0-9a-f-]{16,}$/i.test(seg)) return '{id}';
    return '{x}'; // anything else (mixed case, digits, encoded text) is hidden
  }

  function redactUrl(raw) {
    let u;
    try { u = new URL(raw, location.href); } catch (e) { return '{unparseable-url}'; }
    if (u.protocol === 'blob:') return 'blob:{x}';
    if (u.protocol === 'data:') return 'data:{x}';
    const path = u.pathname.split('/').map(redactSegment).join('/');
    const qKeys = [...new Set([...u.searchParams.keys()])]
      .map(k => (/^[A-Za-z_.\[\]-]+$/.test(k) ? k : '{key}'));
    const host = u.host === location.host ? '' : u.host;
    return host + path + (qKeys.length ? '?' + qKeys.map(k => k + '=…').join('&') : '');
  }

  function strHint(s) {
    let hint = '';
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) hint = 'date-like';
    else if (/^\+?[\d\s().-]{10,16}$/.test(s)) hint = 'phone-like';
    else if (/^https?:\/\//.test(s)) hint = 'url';
    else if (/^[0-9a-f-]{16,}$/i.test(s)) hint = 'id-like';
    else if (/\.pdf(\?|$)/i.test(s)) hint = 'pdf-path';
    return 'str' + (hint ? '(' + hint + ')' : '');
  }

  function shape(v, depth) {
    if (v === null) return 'null';
    const t = typeof v;
    if (t === 'string') return strHint(v);
    if (t === 'number') return 'num';
    if (t === 'boolean') return 'bool';
    if (depth >= MAX_DEPTH) return '…';
    if (Array.isArray(v)) {
      return v.length ? ['[' + v.length + ' items] of:', shape(v[0], depth + 1)] : '[]';
    }
    if (t === 'object') {
      const out = {};
      const keys = Object.keys(v);
      let idKeys = 0;
      for (const k of keys.slice(0, MAX_KEYS)) {
        if (/^[0-9a-f-]{6,}$/i.test(k) || /^\d+$/.test(k)) { // map keyed by IDs
          if (idKeys++ === 0) out['{idKey}'] = shape(v[k], depth + 1);
          continue;
        }
        out[/^[A-Za-z0-9_$.-]+$/.test(k) ? k : '{key}'] = shape(v[k], depth + 1);
      }
      if (keys.length > MAX_KEYS) out['…'] = (keys.length - MAX_KEYS) + ' more keys';
      return out;
    }
    return t;
  }

  // ---------- recording ----------
  function record(method, url, status, ctype, size, body) {
    if (!recording) return;
    if (SKIP_EXT.test(url)) return;
    const pattern = redactUrl(url);
    const key = method + ' ' + pattern;
    const prev = entries.get(key);
    const entry = prev || { method, pattern, status, ctype: ctype || '?', size, count: 0, shape: null };
    entry.count++;
    entry.status = status;
    if (size != null) entry.size = size;
    if (body !== undefined && entry.shape === null) entry.shape = shape(body, 0);
    entries.set(key, entry);
    render();
  }

  function parseMaybeJson(text, ctype) {
    if (!/json/i.test(ctype || '') && !/^\s*[\[{]/.test(text || '')) return undefined;
    try { return JSON.parse(text); } catch (e) { return undefined; }
  }

  // fetch hook
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      const p = origFetch.apply(this, arguments);
      if (!recording) return p;
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      p.then(res => {
        const ctype = res.headers.get('content-type') || '';
        const len = res.headers.get('content-length');
        if (/json|text/i.test(ctype)) {
          res.clone().text()
            .then(t => record(method, url, res.status, ctype, t.length, parseMaybeJson(t, ctype)))
            .catch(() => record(method, url, res.status, ctype, len));
        } else {
          record(method, url, res.status, ctype, len != null ? +len : null);
        }
      }).catch(() => {});
      return p;
    };
  }

  // XHR hook
  const XO = XMLHttpRequest.prototype.open;
  const XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__shape = { method: String(method || 'GET').toUpperCase(), url: String(url) };
    return XO.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (recording && this.__shape) {
      this.addEventListener('loadend', () => {
        const ctype = this.getResponseHeader('content-type') || '';
        let size = null, body;
        try {
          if (this.responseType === '' || this.responseType === 'text') {
            size = (this.responseText || '').length;
            body = parseMaybeJson(this.responseText, ctype);
          } else if (this.responseType === 'json') {
            body = this.response;
          } else if (this.response && this.response.size != null) {
            size = this.response.size;
          } else if (this.response && this.response.byteLength != null) {
            size = this.response.byteLength;
          }
        } catch (e) { /* ignore */ }
        record(this.__shape.method, this.__shape.url, this.status, ctype, size, body);
      });
    }
    return XS.apply(this, arguments);
  };

  // ---------- viewer scan (structure only, never text) ----------
  function scanViewer() {
    const lines = [];
    const sel = 'iframe, embed, object';
    document.querySelectorAll(sel).forEach(el => {
      const src = el.getAttribute('src') || el.getAttribute('data') || '';
      lines.push(el.tagName.toLowerCase() + ' src=' + (src ? redactUrl(src) : '(none)') +
        (el.getAttribute('type') ? ' type=' + el.getAttribute('type') : ''));
    });
    const canvases = document.querySelectorAll('canvas').length;
    const textLayers = document.querySelectorAll('.textLayer, .react-pdf__Page__textContent');
    let spans = 0;
    textLayers.forEach(t => { spans += t.querySelectorAll('span').length; });
    const imgs = [...document.querySelectorAll('img')]
      .filter(i => i.naturalWidth > 600)
      .map(i => 'large img src=' + redactUrl(i.currentSrc || i.src));
    lines.push('canvas elements: ' + canvases);
    lines.push('pdf text layers: ' + textLayers.length + ' (spans: ' + spans + ')');
    lines.push('window.pdfjsLib present: ' + !!window.pdfjsLib);
    imgs.forEach(l => lines.push(l));
    viewerReport = lines.join('\n');
    render();
  }
  let viewerReport = '';

  // ---------- panel ----------
  let panel, listEl, statusEl;

  function buildPanel() {
    panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;right:16px;bottom:16px;width:480px;max-height:60vh;z-index:2147483647;' +
      'background:#fff;color:#222;border:1px solid #888;border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.25);' +
      'font:12px/1.4 system-ui,sans-serif;display:none;flex-direction:column;';
    panel.innerHTML =
      '<div style="padding:8px 10px;background:#2d4a6b;color:#fff;border-radius:8px 8px 0 0;font-weight:600;">' +
      'CHR Network Shape Capture <span data-s style="font-weight:400;opacity:.85"></span></div>' +
      '<div style="padding:8px;display:flex;gap:6px;flex-wrap:wrap;">' +
      '<button data-a="start">Start</button><button data-a="stop">Stop</button>' +
      '<button data-a="scan">Scan viewer</button><button data-a="copy">Copy all</button>' +
      '<button data-a="clear">Clear</button></div>' +
      '<pre data-l style="margin:0;padding:8px;overflow:auto;flex:1;background:#f6f7f9;white-space:pre-wrap;"></pre>';
    statusEl = panel.querySelector('[data-s]');
    listEl = panel.querySelector('[data-l]');
    panel.addEventListener('click', e => {
      const a = e.target.getAttribute && e.target.getAttribute('data-a');
      if (a === 'start') recording = true;
      if (a === 'stop') recording = false;
      if (a === 'clear') { entries.clear(); viewerReport = ''; }
      if (a === 'scan') scanViewer();
      if (a === 'copy') {
        navigator.clipboard.writeText(reportText()).then(
          () => { statusEl.textContent = '— copied'; },
          () => { statusEl.textContent = '— copy failed; select the text manually'; });
        return;
      }
      render();
    });
    document.body.appendChild(panel);
  }

  function reportText() {
    const parts = [];
    for (const e of entries.values()) {
      let s = '### ' + e.method + ' ' + e.pattern + '  [' + e.status + ', ' + e.ctype.split(';')[0] +
        (e.size != null ? ', ' + e.size + ' bytes' : '') + ', seen ' + e.count + 'x]';
      if (e.shape !== null) s += '\n' + JSON.stringify(e.shape, null, 1);
      parts.push(s);
    }
    if (viewerReport) parts.push('### VIEWER SCAN\n' + viewerReport);
    return parts.join('\n\n') || '(nothing recorded yet)';
  }

  function render() {
    if (!panel) return;
    statusEl.textContent = (recording ? '— RECORDING' : '— stopped') + ' · ' + entries.size + ' patterns';
    listEl.textContent = reportText();
  }

  document.addEventListener('keydown', e => {
    if (e.altKey && e.shiftKey && (e.key === 'N' || e.key === 'n')) {
      if (!panel) buildPanel();
      panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
      render();
      e.preventDefault();
    }
  }, true);
})();
