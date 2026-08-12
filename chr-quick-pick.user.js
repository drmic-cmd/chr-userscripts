// ==UserScript==
// @name         CHR Quick Pick (Forms)
// @namespace    matt-family-med-stratford
// @version      0.3.0
// @description  One-click shortcuts to common forms (bloodwork requisition, imaging requisition, ...) from inside a patient chart. Navigation/template-selection only — nothing is signed, submitted, or finalized by this script.
// @author       Matt
// @match        https://*.inputhealth.com/*
// @match        https://*.chr.md/*
// @match        https://*.telushealth.com/*
// @grant        none
// @run-at       document-idle
// @homepageURL  https://github.com/drmic-cmd/chr-userscripts
// @supportURL   https://github.com/drmic-cmd/chr-userscripts/issues
// @updateURL    https://raw.githubusercontent.com/drmic-cmd/chr-userscripts/main/chr-quick-pick.user.js
// @downloadURL  https://raw.githubusercontent.com/drmic-cmd/chr-userscripts/main/chr-quick-pick.user.js
// ==/UserScript==

/*
=====================================================================================
 READ ME FIRST
=====================================================================================
 Same safety pattern as the Rx Renewal Assistant: every click waits for its
 target to actually appear and be the ONLY visible match before clicking —
 if a selector ever finds more than one plausible match, it stops with a
 clear message rather than guessing (that's the lesson from the wrong-patient
 bug in the Rx script). No network calls, nothing auto-submitted.

 WHAT EACH QUICK PICK DOES, IN GENERAL:
   1. Figures out how to reach the template picker:
        - If you're inside an open encounter note (its own "Add Form" button
          is visible), it uses that.
        - Otherwise it uses Main Menu → Forms → Add Form.
      Either route lands on the same "choose a folder" popup.
   2. Clicks "All Templates".
   3. Types the form's search text into the template search box.
   4. Then, per form:
        - Bloodwork: clicks the matching template ("Lab - MOHLTC (ON)") to
          open it, then STOPS — you review and click Apply/Continue yourself.
        - Imaging: clicks the matching template AND the confirm/auto-populate
          button, landing you on the populated form ready for review.
      Neither path signs or submits any order — both only open/pre-fill a
      form for you to review and complete yourself.

 ONE WEAKER SPOT WORTH WATCHING: the imaging "auto-populate & continue"
 button is a plain <input type="submit"> with a fairly generic class
 ("save primary") and, unlike the other buttons in this script, it has no
 visible text for the script to double-check against (submit inputs show
 their label via a "value" attribute, which wasn't captured). It's still
 protected by the same "only click if there's exactly one visible match"
 rule, but pay extra attention to this specific step the first several
 times you test it.

 TEST IN YOUR TRAINING ENVIRONMENT FIRST, with the console open (F12),
 before relying on this during a real patient day. Adding another form later
 is just adding an entry to QUICK_PICKS near the bottom — send me a fresh
 capture the same way as before and I'll wire it in, and it'll get the next
 free Alt+N hotkey automatically.

 CHANGED (0.3.0): each quick pick now also has an Alt+N hotkey (Alt+5 for
 bloodwork, Alt+6 for imaging — picking up after the Rx Renewal Assistant's
 Alt+1..4 so the two scripts never collide) so you don't need to click
 through the panel. The panel itself is also now small and translucent by
 default, expanding on hover or while a pick is running, so it doesn't sit
 on top of the chart underneath it.
=====================================================================================
*/

(function () {
  'use strict';

  // ===================================================================
  // Selectors — built from your capture. Generic/reused classes (e.g.
  // "btn btn-primary", "ih-list-button", "item-title truncate") are always
  // paired with an exact-text filter, since those classes get reused all
  // over CHR for unrelated buttons/menu items.
  // ===================================================================
  const SELECTORS = {
    menuButton: {
      label: 'Main Menu button',
      find: () =>
        uniqueAmongOrThrow(
          Array.from(document.querySelectorAll('div.patient-header-section-menu button')).filter(
            (el) => el.textContent && el.textContent.trim() === 'Menu'
          ),
          'Main Menu button'
        ),
    },
    addFormEncounter: {
      label: '"Add Form" button (inside an open encounter note)',
      find: () => uniqueAmongOrThrow(document.querySelectorAll('a.title-btn.add-form'), '"Add Form" button (encounter)'),
    },
    formsMenuItem: {
      label: '"Forms" menu item',
      find: () =>
        uniqueAmongOrThrow(
          Array.from(document.querySelectorAll('button.ih-list-button')).filter(
            (el) => el.textContent && el.textContent.trim() === 'Forms'
          ),
          '"Forms" menu item'
        ),
    },
    addFormMenu: {
      label: '"Add Form" button (Forms section, main-menu route)',
      find: () => uniqueAmongOrThrow(document.querySelectorAll('a.new-item.new-form'), '"Add Form" button (Forms section)'),
    },
    allTemplatesButton: {
      label: '"All Templates" folder',
      find: () =>
        uniqueAmongOrThrow(
          Array.from(document.querySelectorAll('div.item-title.truncate')).filter(
            (el) => el.textContent && el.textContent.trim() === 'All Templates'
          ),
          '"All Templates" folder'
        ),
    },
    searchInput: {
      label: 'Template search box',
      find: () =>
        uniqueAmongOrThrow(document.querySelectorAll('input.search.field[placeholder="Search template..."]'), 'Template search box'),
    },
    bloodworkResult: {
      label: 'Bloodwork template result',
      find: () =>
        uniqueAmongOrThrow(
          Array.from(document.querySelectorAll('div.item-title.truncate.item-title-custom')).filter(
            (el) => el.textContent && el.textContent.trim() === 'Lab - MOHLTC (ON)'
          ),
          'Bloodwork template result'
        ),
    },
    imagingResult: {
      label: 'Imaging template result',
      find: () =>
        uniqueAmongOrThrow(
          Array.from(document.querySelectorAll('div.item-title.truncate.item-title-custom')).filter(
            (el) => el.textContent && el.textContent.trim() === 'Imaging - Xray/US/BMD - SGH/HPHA'
          ),
          'Imaging template result'
        ),
    },
    imagingConfirm: {
      label: 'Auto-populate / continue button (imaging)',
      // No text to verify against (submit inputs show their label via a
      // "value" attribute, not captured) — relies solely on the
      // exactly-one-visible-match rule. See the header note above.
      find: () => uniqueAmongOrThrow(document.querySelectorAll('input.save.primary[type="submit"]'), 'Auto-populate / continue button'),
    },
  };

  // ===================================================================
  // Utilities (same battle-tested versions as the Rx Renewal Assistant)
  // ===================================================================
  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }

  function uniqueAmongOrThrow(candidates, label) {
    const matches = Array.from(candidates).filter(isVisible);
    if (matches.length === 0) return null;
    if (matches.length > 1) {
      throw new Error(
        `found ${matches.length} possible matches for "${label}" — stopping rather than guess which one; please do this step by hand`
      );
    }
    return matches[0];
  }

  function waitFor(finderFn, { timeout = 8000, interval = 150 } = {}) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function tick() {
        let el;
        try {
          el = finderFn();
        } catch (e) {
          return reject(e);
        }
        if (el && isVisible(el)) return resolve(el);
        if (Date.now() - start > timeout) {
          return reject(new Error('timed out waiting — the page may not have loaded, or the button has moved'));
        }
        setTimeout(tick, interval);
      })();
    });
  }

  async function clickWhenReady(selectorDef, opts) {
    setStatus(`Waiting for: ${selectorDef.label} …`);
    const el = await waitFor(selectorDef.find, opts);
    setStatus(`Clicking: ${selectorDef.label}`);
    el.scrollIntoView({ block: 'center' });
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.click();
    await new Promise((r) => setTimeout(r, 250));
    return el;
  }

  // Sets an input's value in a way that Vue/React-style reactive bindings
  // actually notice (a plain `.value = x` assignment is often silently
  // ignored by frameworks that override the native setter).
  function setReactiveInputValue(inputEl, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeSetter.call(inputEl, value);
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ===================================================================
  // Shared flow: get to the template search box, type the search text
  // ===================================================================
  async function openFormPickerAndSearch(searchText) {
    let usedEncounterRoute = false;
    const encounterBtn = SELECTORS.addFormEncounter.find(); // throws if ambiguous, else el or null
    if (encounterBtn) {
      setStatus('Open encounter detected — using its "Add Form" button…');
      await clickWhenReady(SELECTORS.addFormEncounter);
      usedEncounterRoute = true;
    }
    if (!usedEncounterRoute) {
      setStatus('No open encounter detected — using Main Menu → Forms → Add Form…');
      await clickWhenReady(SELECTORS.menuButton);
      await clickWhenReady(SELECTORS.formsMenuItem);
      await clickWhenReady(SELECTORS.addFormMenu);
    }
    await clickWhenReady(SELECTORS.allTemplatesButton);
    const searchEl = await waitFor(SELECTORS.searchInput.find);
    setStatus(`Typing search: "${searchText}" …`);
    setReactiveInputValue(searchEl, searchText);
    await new Promise((r) => setTimeout(r, 600)); // let the live filter settle
  }

  // ===================================================================
  // Quick picks — add more forms here later, same shape each time
  // ===================================================================
  const QUICK_PICKS = [
    {
      id: 'bloodwork',
      label: '🩸 Alt+5 — Bloodwork Requisition (Lab - MOHLTC)',
      hotkey: '5',
      searchText: 'Lab - MOH',
      autoSelectResult: SELECTORS.bloodworkResult, // clicks the template for you...
      autoConfirm: null, // ...but stops there — you review and click Apply/Continue yourself
    },
    {
      id: 'imaging',
      label: '🩻 Alt+6 — Imaging - Xray/US/BMD (SGH/HPHA)',
      hotkey: '6',
      searchText: 'imaging - xray/us/bmd',
      autoSelectResult: SELECTORS.imagingResult, // proceeds automatically
      autoConfirm: SELECTORS.imagingConfirm,
    },
  ];

  async function runQuickPick(pick) {
    try {
      await openFormPickerAndSearch(pick.searchText);
      if (!pick.autoSelectResult) {
        // No result selector configured for this form — stop at the search
        // box and let the user pick manually.
        setStatus(`✅ Search ready for "${pick.label}" — click the correct result yourself.`, false);
        return;
      }
      await clickWhenReady(pick.autoSelectResult);
      if (pick.autoConfirm) {
        await clickWhenReady(pick.autoConfirm);
        setStatus(`✅ "${pick.label}" opened and populated — review before you continue.`, false);
      } else {
        setStatus(`✅ "${pick.label}" template opened — review, then click Apply/Continue yourself.`, false);
      }
    } catch (e) {
      setStatus(`⚠️ Stopped: ${e.message}`, true);
    }
  }

  // ===================================================================
  // UI — top-left, so it doesn't collide with the Rx Renewal Assistant
  // panel (bottom-right) if both are loaded at once.
  // ===================================================================
  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      /* Compact + translucent by default so it doesn't sit on top of
         whatever's behind it — hover, focus, or an in-progress pick brings
         it to full size/opacity. Alt+5/Alt+6 always work either way; this
         is purely visual. */
      #chrqp-panel {
        position: fixed; top: 20px; left: 20px; z-index: 999999;
        width: 168px; background: #fff; color: #1a202c;
        border: 1px solid #cbd5e0; border-radius: 8px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.25);
        font-family: -apple-system, Segoe UI, Roboto, sans-serif; font-size: 12px;
        padding: 8px;
        opacity: 0.32;
        transition: opacity 0.12s ease, width 0.12s ease;
      }
      #chrqp-panel:hover,
      #chrqp-panel:focus-within,
      #chrqp-panel.chrqp-active {
        opacity: 1;
        width: 300px;
        padding: 12px;
      }
      #chrqp-panel h4 { margin: 0 0 8px; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #chrqp-panel button {
        display: block; width: 100%; margin-bottom: 6px; padding: 7px 8px;
        background: #f0fff4; border: 1px solid #9ae6b4; border-radius: 4px;
        cursor: pointer; font-size: 12px; text-align: left;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      #chrqp-panel button:hover { background: #c6f6d5; }
      #chrqp-status {
        margin-top: 8px; padding: 6px 8px; border-radius: 4px;
        background: #f7fafc; border: 1px solid #e2e8f0; min-height: 32px;
        font-size: 11px; line-height: 1.4;
      }
      #chrqp-status.warn { background: #fffbea; border-color: #f6e05e; color: #744210; }
      #chrqp-status.err { background: #fff5f5; border-color: #feb2b2; color: #822727; }
    `;
    document.head.appendChild(style);
  }

  let chrqpCollapseTimer = null;
  let chrqpHovered = false;

  function expandPanel() {
    const panel = document.getElementById('chrqp-panel');
    if (!panel) return;
    panel.classList.add('chrqp-active');
    if (chrqpCollapseTimer) clearTimeout(chrqpCollapseTimer);
  }

  function scheduleCollapse(delayMs) {
    const panel = document.getElementById('chrqp-panel');
    if (!panel) return;
    if (chrqpCollapseTimer) clearTimeout(chrqpCollapseTimer);
    chrqpCollapseTimer = setTimeout(() => {
      if (!chrqpHovered) panel.classList.remove('chrqp-active');
    }, delayMs);
  }

  function setStatus(msg, isWarnOrError) {
    const el = document.getElementById('chrqp-status');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('warn', 'err');
    if (isWarnOrError) el.classList.add(msg.startsWith('⚠️') ? 'err' : 'warn');
    console.log('[CHR Quick Pick]', msg);
    expandPanel();
    const isTerminal = msg.startsWith('✅') || msg.startsWith('⚠️');
    scheduleCollapse(isTerminal ? 4000 : 8000);
  }

  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'chrqp-panel';
    const buttonsHtml = QUICK_PICKS.map((p, i) => `<button data-idx="${i}">${p.label}</button>`).join('');
    panel.innerHTML = `
      <h4>Quick Pick: Forms</h4>
      ${buttonsHtml}
      <div id="chrqp-status">Ready. Open a patient's chart, then pick a form.</div>
    `;
    document.body.appendChild(panel);
    panel.querySelectorAll('button[data-idx]').forEach((btn) => {
      btn.addEventListener('click', () => runQuickPick(QUICK_PICKS[Number(btn.dataset.idx)]));
    });
    panel.addEventListener('mouseenter', () => { chrqpHovered = true; });
    panel.addEventListener('mouseleave', () => {
      chrqpHovered = false;
      scheduleCollapse(600);
    });
    return panel;
  }

  function init() {
    injectStyles();
    buildPanel();
    document.addEventListener('keydown', (e) => {
      if (!e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return;
      const pick = QUICK_PICKS.find((p) => p.hotkey === e.key);
      if (!pick) return;
      e.preventDefault();
      runQuickPick(pick);
    });
  }

  init();
})();
