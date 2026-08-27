// ==UserScript==
// @name         CHR Selector Capture Tool
// @namespace    matt-family-med-stratford
// @version      0.1.0
// @description  Alt+Click on any element to record its structure (tag/id/class/attributes/short label) into a review panel you can edit and copy. Built so the actual Rx renewal automation script can be written with real selectors. Makes no network calls; nothing is sent anywhere automatically.
// @author       Matt
// @match        https://*.inputhealth.com/*
// @match        https://*.chr.md/*
// @match        https://*.telushealth.com/*
// @grant        none
// @run-at       document-idle
// @homepageURL  https://github.com/drmic-cmd/chr-userscripts
// @supportURL   https://github.com/drmic-cmd/chr-userscripts/issues
// @updateURL    https://raw.githubusercontent.com/drmic-cmd/chr-userscripts/main/chr-selector-capture.user.js
// @downloadURL  https://raw.githubusercontent.com/drmic-cmd/chr-userscripts/main/chr-selector-capture.user.js
// ==/UserScript==

/*
=====================================================================================
 WHAT THIS IS FOR
=====================================================================================
 A one-time (or few-time) tool to help build the Rx renewal automation. It does NOT
 automate anything itself — it just records what you click so the structure can be
 turned into a real script afterward.

 HOW TO USE IT
   1. Ideally run this in your clinic's CHR training/demo environment, not on a
      real patient's real prescription.
   2. Walk through the Rx renewal flow as you normally would.
   3. Hold ALT and click each meaningful button/link along the way (the taskbar
      fax icon, the patient name link, the Medications tab, Renew, the specific
      medicine row, Create, Sign, Fax, the pharmacy field, Send, the taskbar file
      again, Mark Done/Next). Alt+click does NOT actually trigger the button — it
      only records it and blocks the normal click, so you can safely click things
      without firing them for real. If you want the underlying click to also fire
      normally after capturing, tap the same button again WITHOUT holding Alt.
   4. Each Alt+click pops a small prompt asking you to label what you just
      clicked (e.g. "Renew button"). This makes the captured list self-explanatory.
   5. Open the panel (bottom-left button, or Alt+Shift+C) any time to review
      everything captured so far, in a plain-text box you can freely edit.
   6. BEFORE copying anything out: read through the box and delete/replace any
      patient name, DOB, health card number, phone number, or address that
      shows up in the "text" or "href" fields. Structural info (tag, id, class,
      button labels like "Sign"/"Renew"/"Create") is what's actually needed —
      patient-specific text is not, and is only there because captured text
      wasn't filtered out automatically (deliberately — automatic redaction
      isn't reliable enough to trust blindly, so a human read-through is safer).
   7. Copy the reviewed text and send it back so the real automation script can
      be written against your actual CHR markup.

 WHAT IT DOES NOT DO
   - No fetch/XHR/network calls of any kind.
   - Nothing is copied to the clipboard automatically — only when you click
     "Copy All" after reviewing.
   - Normal (non-Alt) clicks pass through untouched, so you can keep using CHR
     normally while this is loaded.
=====================================================================================
*/

(function () {
  'use strict';

  const STORAGE_KEY = 'chrHelper.captureSession.v1';

  function loadCaptures() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveCaptures(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn('[CHR Capture] Could not save captures:', e);
    }
  }

  let captures = loadCaptures();
  let captureEnabled = true;

  function guessSelector(el) {
    if (el.id) return `#${el.id}`;
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 4) {
      let part = node.tagName.toLowerCase();
      if (node.className && typeof node.className === 'string') {
        const cls = node.className.trim().split(/\s+/).filter(Boolean).slice(0, 2);
        if (cls.length) part += '.' + cls.join('.');
      }
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        }
      }
      parts.unshift(part);
      node = node.parentElement;
      depth++;
    }
    return parts.join(' > ');
  }

  function describeElement(el) {
    const attrsOfInterest = ['type', 'name', 'role', 'aria-label', 'data-testid', 'title', 'href', 'placeholder'];
    const attrs = {};
    for (const a of attrsOfInterest) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v) attrs[a] = v.length > 80 ? v.slice(0, 80) + '…' : v;
    }
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      className: (el.className && typeof el.className === 'string') ? el.className : undefined,
      attrs: Object.keys(attrs).length ? attrs : undefined,
      text: text || undefined,
      selectorGuess: guessSelector(el),
    };
  }

  function captureElement(el) {
    const label = prompt('Label this element (what does it do?):', '');
    if (label === null) return; // user cancelled — skip
    const entry = {
      order: captures.length + 1,
      label: label || '(no label given)',
      ...describeElement(el),
    };
    captures.push(entry);
    saveCaptures(captures);
    renderPanel();
    toast(`Captured #${entry.order}: ${entry.label}`);
  }

  // ===================================================================
  // UI
  // ===================================================================
  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      #chrcap-fab {
        position: fixed; bottom: 20px; left: 20px; z-index: 999999;
        padding: 8px 12px; border-radius: 20px;
        background: #b7791f; color: #fff; border: none;
        font-size: 12px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      }
      #chrcap-panel {
        position: fixed; bottom: 60px; left: 20px; z-index: 999999;
        width: 420px; max-height: 75vh; overflow-y: auto;
        background: #fff; color: #1a202c; border: 1px solid #cbd5e0;
        border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.25);
        font-family: -apple-system, Segoe UI, Roboto, sans-serif; font-size: 12px;
        padding: 12px; display: none;
      }
      #chrcap-panel.open { display: block; }
      #chrcap-panel .chrcap-warning {
        background: #fffbea; border: 1px solid #f6e05e; border-radius: 4px;
        padding: 6px 8px; margin-bottom: 8px; font-size: 11px; color: #744210;
      }
      #chrcap-panel textarea {
        width: 100%; height: 220px; box-sizing: border-box; font-family: monospace;
        font-size: 11px; margin-top: 6px;
      }
      #chrcap-panel button {
        margin-top: 6px; margin-right: 4px; padding: 5px 8px;
        background: #edf2f7; border: 1px solid #cbd5e0; border-radius: 4px;
        cursor: pointer; font-size: 11px;
      }
      #chrcap-toast {
        position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
        background: #2d3748; color: #fff; padding: 6px 14px; border-radius: 16px;
        font-size: 12px; z-index: 999999; opacity: 0; transition: opacity 0.2s;
        pointer-events: none;
      }
      #chrcap-toast.show { opacity: 1; }
    `;
    document.head.appendChild(style);
  }

  function toast(msg) {
    let t = document.getElementById('chrcap-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'chrcap-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 1500);
  }

  function formatCapturesAsText() {
    if (!captures.length) return '(nothing captured yet — Alt+Click something first)';
    return captures
      .map((c) => {
        const bits = [`#${c.order} [${c.label}]`, `tag=${c.tag}`];
        if (c.id) bits.push(`id=${c.id}`);
        if (c.className) bits.push(`class="${c.className}"`);
        if (c.attrs) bits.push(`attrs=${JSON.stringify(c.attrs)}`);
        if (c.text) bits.push(`text="${c.text}"`);
        bits.push(`selectorGuess="${c.selectorGuess}"`);
        return bits.join(' | ');
      })
      .join('\n');
  }

  let panelEl = null;

  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'chrcap-panel';
    panel.innerHTML = `
      <div class="chrcap-warning">
        Before copying: scan the box below and delete/replace any patient name,
        DOB, health card #, phone, or address. Keep structural info (tag/id/
        class/button labels) — that's what's actually needed.
      </div>
      <div>Capture mode: <b id="chrcap-status">ON</b> (Alt+Shift+C to toggle)</div>
      <textarea id="chrcap-text" readonly></textarea>
      <div>
        <button id="chrcap-copy">Copy All</button>
        <button id="chrcap-clear">Clear All</button>
        <button id="chrcap-refresh">Refresh</button>
      </div>
    `;
    document.body.appendChild(panel);
    panel.querySelector('#chrcap-copy').addEventListener('click', () => {
      const ta = panel.querySelector('#chrcap-text');
      ta.select();
      navigator.clipboard.writeText(ta.value).then(
        () => toast('Copied — please still re-read it before sending.'),
        () => toast('Clipboard blocked — select the text and copy manually.')
      );
    });
    panel.querySelector('#chrcap-clear').addEventListener('click', () => {
      if (confirm('Clear all captured elements? This cannot be undone.')) {
        captures = [];
        saveCaptures(captures);
        renderPanel();
      }
    });
    panel.querySelector('#chrcap-refresh').addEventListener('click', renderPanel);
    return panel;
  }

  function renderPanel() {
    if (!panelEl) return;
    panelEl.querySelector('#chrcap-text').value = formatCapturesAsText();
    panelEl.querySelector('#chrcap-status').textContent = captureEnabled ? 'ON' : 'OFF';
  }

  function buildFab() {
    const fab = document.createElement('button');
    fab.id = 'chrcap-fab';
    fab.textContent = `📋 Capture (${captures.length})`;
    fab.addEventListener('click', () => {
      panelEl.classList.toggle('open');
      renderPanel();
    });
    document.body.appendChild(fab);
    return fab;
  }

  // ===================================================================
  // Init
  // ===================================================================
  function init() {
    injectStyles();
    panelEl = buildPanel();
    const fab = buildFab();
    renderPanel();

    document.addEventListener(
      'click',
      (e) => {
        if (!e.altKey || !captureEnabled) return;
        const el = e.target.closest('button, a, [role="button"], input, select, [onclick]') || e.target;
        e.preventDefault();
        e.stopPropagation();
        captureElement(el);
        fab.textContent = `📋 Capture (${captures.length})`;
      },
      true // capture phase, so we intercept before CHR's own handlers
    );

    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        captureEnabled = !captureEnabled;
        renderPanel();
        toast(`Capture mode ${captureEnabled ? 'ON' : 'OFF'}`);
      }
    });
  }

  init();
})();
