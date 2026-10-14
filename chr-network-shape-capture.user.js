// ==UserScript==
// @name         CHR Network Shape Capture
// @namespace    matt-family-med-stratford
// @version      0.2.0
// @description  Records the SHAPE of CHR's own network traffic (URL patterns with IDs stripped, JSON field names and value types, WebSocket message shapes, resource loads) so automation can be designed without capturing patient data. Values are never recorded. Makes no network calls of its own; nothing leaves the browser.
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
 and the fax PDFs. This tool records only:
   - method + URL pattern (numbers, IDs, tokens and query VALUES replaced)
   - status, content type, size, and what kind of thing loaded it
   - for JSON (HTTP or WebSocket): field NAMES and value TYPES
   - short technical labels such as a GraphQL operation name or a socket event
     name like "phx_reply", with any digits/IDs replaced
 It never records free text, names, numbers, or dates.

 v0.2.0 adds: WebSocket capture, a browser "resource timing" view that sees every
 load no matter how CHR makes it, capture inside frames, and a diagnostics line.

 HOW TO USE
   1. Reload the CHR tab, then Alt+Shift+N opens/closes the panel.
   2. Press Start, then: open Inbox -> Cedar Pod Fax tab -> open ONE unsorted fax.
   3. With the fax open, press "Scan viewer", then "Add page history".
   4. Press Stop, glance over the list, then "Copy all" and paste into Claude.
 Recording lives in memory only; reloading the page clears it.
=====================================================================================
*/

(function () {
  'use strict';

  const IS_TOP = window.top === window;
  const MAX_DEPTH = 6;
  const MAX_KEYS = 80;
  const SKIP_EXT = /\.(js|css|png|jpe?g|gif|svg|woff2?|ttf|ico|map)(\?|$)/i;
  const NOISE_HOSTS = /(mixpanel|google-analytics|googletagmanager|sentry|datadog|segment|hotjar|intercom|fullstory|newrelic|nr-data)/i;
  const SAFE_LABEL_KEYS = ['operationName', 'event', 'type', 'topic', 'action', 'op', 'channel', 'method', '__typename'];

  let recording = false;
  const entries = new Map();
  const stats = { fetch: 0, xhr: 0, wsOpen: 0, wsMsg: 0, resource: 0, frames: 0 };
  let viewerReport = '';

  // ---------- redaction ----------
  function redactSegment(seg) {
    if (!seg) return seg;
    if (/^[a-z_-]+$/.test(seg) && seg.length <= 40) return seg;
    if (/^v\d+$/i.test(seg)) return seg;
    if (/^[a-z_-]+\.(json|pdf|html?)$/i.test(seg)) return seg;
    if (/^\d+$/.test(seg)) return '{num}';
    if (/^[0-9a-f-]{16,}$/i.test(seg)) return '{id}';
    if (/\.pdf$/i.test(seg)) return '{x}.pdf';
    return '{x}';
  }

  function redactUrl(raw) {
    let u;
    try { u = new URL(raw, location.href); } catch (e) { return '{unparseable-url}'; }
    if (u.protocol === 'blob:') return 'blob:{x}';
    if (u.protocol === 'data:') return 'data:' + (String(raw).slice(5).split(/[;,]/)[0] || '') + ',{x}';
    const path = u.pathname.split('/').map(redactSegment).join('/');
    const qKeys = [...new Set([...u.searchParams.keys()])]
      .map(k => (/^[A-Za-z_.\[\]-]+$/.test(k) ? k : '{key}'));
    const host = u.host === location.host ? '' : u.protocol.replace(':', '') + '://' + u.host;
    return host + path + (qKeys.length ? '?' + qKeys.map(k => k + '=…').join('&') : '');
  }

  // A short technical identifier (event names, operation names). Anything that
  // does not look like an identifier is hidden.
  function safeLabel(s) {
    if (typeof s !== 'string') return null;
    let t = s.replace(/[0-9a-f]{8}-[0-9a-f-]{20,}/gi, '{id}').replace(/\d+/g, '{n}');
    if (t.length > 60) return null;
    if (!/^[A-Za-z_{}][\w:.\/{}-]*$/.test(t)) return null;          // no spaces, no odd chars
    if (!/[:_./]/.test(t) && !/^[a-z]+[A-Z]/.test(t) && !/^[A-Z][a-z]+[A-Z]/.test(t)) {
      return null; // a single plain word could be a name; require identifier styling
    }
    return t;
  }

  function findLabel(body) {
    if (!body || typeof body !== 'object') return null;
    if (Array.isArray(body)) {
      const parts = body.filter(x => typeof x === 'string').map(safeLabel).filter(Boolean);
      return parts.length ? parts.slice(0, 3).join(' ') : null;
    }
    for (const k of SAFE_LABEL_KEYS) {
      const l = safeLabel(body[k]);
      if (l) return k + '=' + l;
    }
    if (typeof body.query === 'string') {
      const m = body.query.match(/^\s*(query|mutation|subscription)\s+(\w+)/);
      if (m) return m[1] + ' ' + m[2];
    }
    return null;
  }

  function strHint(s) {
    let hint = '';
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) hint = 'date-like';
    else if (/^\+?[\d\s().-]{10,16}$/.test(s)) hint = 'phone-like';
    else if (/^https?:\/\//.test(s)) hint = 'url';
    else if (/^[0-9a-f-]{16,}$/i.test(s)) hint = 'id-like';
    else if (/\.pdf(\?|$)/i.test(s)) hint = 'pdf-path';
    else if (/^data:application\/pdf/.test(s)) hint = 'pdf-data';
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
        if (/^[0-9a-f-]{6,}$/i.test(k) || /^\d+$/.test(k)) {
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

  function parseMaybeJson(text, ctype) {
    if (typeof text !== 'string') return undefined;
    let t = text;
    const sio = t.match(/^\d+(?=[\[{])/); // socket.io style prefix like 42["event",{...}]
    if (sio) t = t.slice(sio[0].length);
    if (!/json/i.test(ctype || '') && !/^\s*[\[{]/.test(t)) return undefined;
    try { return JSON.parse(t); } catch (e) { return undefined; }
  }

  // ---------- recording ----------
  function addEntry(e) {
    if (IS_TOP) {
      const key = e.kind + ' ' + e.method + ' ' + e.pattern + (e.label ? ' ' + e.label : '');
      const prev = entries.get(key);
      if (prev) {
        prev.count += e.count || 1;
        if (prev.shape == null && e.shape != null) prev.shape = e.shape;
        if (e.size != null) prev.size = e.size;
      } else {
        entries.set(key, Object.assign({ count: 1 }, e));
      }
      render();
    } else {
      try { window.top.postMessage({ __chrShape: e, frame: redactUrl(location.href) }, '*'); } catch (err) { /* ignore */ }
    }
  }

  function record(kind, method, url, status, ctype, size, body, reqBody) {
    if (!recording) return;
    if (SKIP_EXT.test(url) || NOISE_HOSTS.test(url)) return;
    addEntry({
      kind, method,
      pattern: redactUrl(url),
      status, ctype: (ctype || '?').split(';')[0],
      size: size == null ? null : size,
      label: findLabel(reqBody) || findLabel(body),
      shape: body === undefined ? null : shape(body, 0)
    });
  }

  // ---------- fetch ----------
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      stats.fetch++;
      const p = origFetch.apply(this, arguments);
      if (!recording) return p;
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      const reqBody = init && typeof init.body === 'string' ? parseMaybeJson(init.body) : undefined;
      p.then(res => {
        const ctype = res.headers.get('content-type') || '';
        const len = res.headers.get('content-length');
        if (/json|text/i.test(ctype)) {
          res.clone().text()
            .then(t => record('HTTP', method, url, res.status, ctype, t.length, parseMaybeJson(t, ctype), reqBody))
            .catch(() => record('HTTP', method, url, res.status, ctype, len, undefined, reqBody));
        } else {
          record('HTTP', method, url, res.status, ctype, len != null ? +len : null, undefined, reqBody);
        }
      }).catch(() => {});
      return p;
    };
  }

  // ---------- XHR ----------
  const XO = XMLHttpRequest.prototype.open;
  const XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__shape = { method: String(method || 'GET').toUpperCase(), url: String(url) };
    return XO.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    stats.xhr++;
    if (recording && this.__shape) {
      const reqBody = typeof body === 'string' ? parseMaybeJson(body) : undefined;
      this.addEventListener('loadend', () => {
        const ctype = this.getResponseHeader('content-type') || '';
        let size = null, resBody;
        try {
          if (this.responseType === '' || this.responseType === 'text') {
            size = (this.responseText || '').length;
            resBody = parseMaybeJson(this.responseText, ctype);
          } else if (this.responseType === 'json') {
            resBody = this.response;
          } else if (this.response && this.response.size != null) {
            size = this.response.size;
          } else if (this.response && this.response.byteLength != null) {
            size = this.response.byteLength;
          }
        } catch (e) { /* ignore */ }
        record('HTTP', this.__shape.method, this.__shape.url, this.status, ctype, size, resBody, reqBody);
      });
    }
    return XS.apply(this, arguments);
  };

  // ---------- WebSocket ----------
  const OrigWS = window.WebSocket;
  if (OrigWS) {
    const origSend = OrigWS.prototype.send;
    OrigWS.prototype.send = function (data) {
      if (recording && typeof data === 'string') {
        stats.wsMsg++;
        record('WS-OUT', 'SEND', this.url, '-', 'ws', data.length, parseMaybeJson(data));
      }
      return origSend.apply(this, arguments);
    };
    const Wrapped = function (url, protocols) {
      const ws = protocols !== undefined ? new OrigWS(url, protocols) : new OrigWS(url);
      stats.wsOpen++;
      if (recording) record('WS', 'OPEN', String(url), '-', 'ws', null);
      ws.addEventListener('message', ev => {
        if (!recording) return;
        stats.wsMsg++;
        if (typeof ev.data === 'string') {
          record('WS-IN', 'RECV', String(url), '-', 'ws', ev.data.length, parseMaybeJson(ev.data));
        } else {
          record('WS-IN', 'RECV', String(url), '-', 'ws-binary', ev.data && (ev.data.size || ev.data.byteLength));
        }
      });
      return ws;
    };
    Wrapped.prototype = OrigWS.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(k => { Wrapped[k] = OrigWS[k]; });
    window.WebSocket = Wrapped;
  }

  // ---------- resource timing (sees every load, however CHR makes it) ----------
  function recordResource(r) {
    stats.resource++;
    if (!recording) return;
    if (SKIP_EXT.test(r.name) || NOISE_HOSTS.test(r.name)) return;
    if (['script', 'css', 'link', 'img'].includes(r.initiatorType) && !/pdf/i.test(r.name)) return;
    addEntry({
      kind: 'LOAD', method: r.initiatorType || 'other',
      pattern: redactUrl(r.name), status: r.responseStatus || '-', ctype: '-',
      size: r.encodedBodySize || r.transferSize || null, label: null, shape: null
    });
  }
  try {
    new PerformanceObserver(list => list.getEntries().forEach(recordResource))
      .observe({ type: 'resource', buffered: false });
  } catch (e) { /* older browser */ }

  function addPageHistory() {
    const was = recording;
    recording = true;
    performance.getEntriesByType('resource').forEach(recordResource);
    recording = was;
  }

  // ---------- frames ----------
  function broadcast(msg, win) {
    for (let i = 0; i < win.frames.length; i++) {
      try { win.frames[i].postMessage(msg, '*'); broadcast(msg, win.frames[i]); } catch (e) { /* ignore */ }
    }
  }
  window.addEventListener('message', ev => {
    const d = ev.data;
    if (!d || typeof d !== 'object') return;
    if (IS_TOP && d.__chrShape) {
      stats.frames++;
      const e = d.__chrShape;
      e.pattern = e.pattern + '   (in frame ' + d.frame + ')';
      addEntry(e);
    } else if (!IS_TOP && d.__chrShapeCtl) {
      if (d.__chrShapeCtl === 'start') recording = true;
      if (d.__chrShapeCtl === 'stop') recording = false;
      if (d.__chrShapeCtl === 'history') addPageHistory();
      if (d.__chrShapeCtl === 'scan') scanViewer();
    }
  });

  // ---------- viewer scan (structure only, never text) ----------
  function scanViewer() {
    const lines = ['frame: ' + (IS_TOP ? 'top' : redactUrl(location.href))];
    document.querySelectorAll('iframe, embed, object').forEach(el => {
      const src = el.getAttribute('src') || el.getAttribute('data') || '';
      lines.push(el.tagName.toLowerCase() + ' src=' + (src ? redactUrl(src) : '(none)') +
        (el.getAttribute('type') ? ' type=' + el.getAttribute('type') : ''));
    });
    const textLayers = document.querySelectorAll('.textLayer, .react-pdf__Page__textContent');
    let spans = 0;
    textLayers.forEach(t => { spans += t.querySelectorAll('span').length; });
    lines.push('canvas elements: ' + document.querySelectorAll('canvas').length);
    lines.push('pdf text layers: ' + textLayers.length + ' (spans: ' + spans + ')');
    lines.push('pdf.js loaded: ' + !!(window.pdfjsLib || window.PDFViewerApplication));
    [...document.querySelectorAll('img')].filter(i => i.naturalWidth > 600)
      .forEach(i => lines.push('large img src=' + redactUrl(i.currentSrc || i.src)));
    const report = lines.join('\n');
    if (IS_TOP) { viewerReport = report; render(); }
    else addEntry({ kind: 'VIEWER', method: 'SCAN', pattern: report.replace(/\n/g, ' | '), status: '-', ctype: '-', size: null, label: null, shape: null });
  }

  if (!IS_TOP) return; // frames only record and forward; the panel lives in the top window

  // ---------- panel ----------
  let panel, listEl, statusEl;

  function buildPanel() {
    panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;right:16px;bottom:16px;width:520px;max-height:65vh;z-index:2147483647;' +
      'background:#fff;color:#222;border:1px solid #888;border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.25);' +
      'font:12px/1.4 system-ui,sans-serif;display:none;flex-direction:column;';
    panel.innerHTML =
      '<div style="padding:8px 10px;background:#2d4a6b;color:#fff;border-radius:8px 8px 0 0;font-weight:600;">' +
      'CHR Network Shape Capture v0.2 <span data-s style="font-weight:400;opacity:.85"></span></div>' +
      '<div style="padding:8px;display:flex;gap:6px;flex-wrap:wrap;">' +
      '<button data-a="start">Start</button><button data-a="stop">Stop</button>' +
      '<button data-a="scan">Scan viewer</button><button data-a="history">Add page history</button>' +
      '<button data-a="copy">Copy all</button><button data-a="clear">Clear</button></div>' +
      '<pre data-l style="margin:0;padding:8px;overflow:auto;flex:1;background:#f6f7f9;white-space:pre-wrap;"></pre>';
    statusEl = panel.querySelector('[data-s]');
    listEl = panel.querySelector('[data-l]');
    panel.addEventListener('click', e => {
      const a = e.target.getAttribute && e.target.getAttribute('data-a');
      if (!a) return;
      if (a === 'start') { recording = true; broadcast({ __chrShapeCtl: 'start' }, window); }
      if (a === 'stop') { recording = false; broadcast({ __chrShapeCtl: 'stop' }, window); }
      if (a === 'clear') { entries.clear(); viewerReport = ''; }
      if (a === 'scan') { scanViewer(); broadcast({ __chrShapeCtl: 'scan' }, window); }
      if (a === 'history') { addPageHistory(); broadcast({ __chrShapeCtl: 'history' }, window); }
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

  function diagnostics() {
    return '### DIAGNOSTICS\n' +
      'fetch still hooked: ' + (window.fetch !== origFetch) +
      ' | WebSocket still hooked: ' + (window.WebSocket !== OrigWS) + '\n' +
      'calls seen (all, incl. while stopped): fetch ' + stats.fetch + ', xhr ' + stats.xhr +
      ', ws opened ' + stats.wsOpen + ', ws msgs ' + stats.wsMsg +
      ', resources ' + stats.resource + ', from frames ' + stats.frames + '\n' +
      'frames on page: ' + window.frames.length;
  }

  function reportText() {
    const parts = [diagnostics()];
    for (const e of entries.values()) {
      let s = '### ' + e.kind + ' ' + e.method + ' ' + e.pattern +
        (e.label ? '  <' + e.label + '>' : '') +
        '  [' + e.status + ', ' + e.ctype + (e.size != null ? ', ' + e.size + ' bytes' : '') +
        ', seen ' + e.count + 'x]';
      if (e.shape != null) s += '\n' + JSON.stringify(e.shape, null, 1);
      parts.push(s);
    }
    if (viewerReport) parts.push('### VIEWER SCAN\n' + viewerReport);
    return parts.join('\n\n');
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
