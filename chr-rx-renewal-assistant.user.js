// ==UserScript==
// @name         CHR Rx Renewal Assistant
// @namespace    matt-family-med-stratford
// @version      0.5.0
// @description  Explicit-trigger navigation automation for the Rx renewal flow. You press a button/hotkey for each phase — nothing runs automatically or in the background. Never clicks Sign or Send; those stay entirely manual, by design.
// @author       Matt
// @match        https://*.inputhealth.com/*
// @match        https://*.chr.md/*
// @match        https://*.telushealth.com/*
// @grant        none
// @run-at       document-idle
// @homepageURL  https://github.com/drmic-cmd/chr-userscripts
// @supportURL   https://github.com/drmic-cmd/chr-userscripts/issues
// @updateURL    https://raw.githubusercontent.com/drmic-cmd/chr-userscripts/main/chr-rx-renewal-assistant.user.js
// @downloadURL  https://raw.githubusercontent.com/drmic-cmd/chr-userscripts/main/chr-rx-renewal-assistant.user.js
// ==/UserScript==

/*
=====================================================================================
 READ ME FIRST — the safety design
=====================================================================================
 Built from the selectors you captured off your training environment. Four
 buttons/hotkeys, each a deliberate action YOU trigger — nothing auto-chains or
 fires on page load or on a timer. Boundaries:

   ① Open chart → Medications → Renew   (pure navigation — automated)
      YOU then manually click the medication(s) to renew — not scripted.
   ② Create Prescription                (automated, but only when you press it —
                                          equivalent to you clicking Create yourself,
                                          just after you've already picked the meds)
      YOU then manually click Sign — never scripted, on purpose.
   ③ Continue to Fax dialog             (automated navigation only)
      Pharmacy field gets highlighted in red for you to check.
      YOU then manually verify the pharmacy and click Send — never scripted.
   ④ Finish: mark done & next           (after you've sent the fax — automated:
                                          reopens the file from the taskbar and
                                          clicks "Mark Done and Next" for you)

 Every automated click waits for its target to actually appear and look visible/
 clickable first (polls up to 8 seconds). If something doesn't show up in time,
 the script STOPS and tells you clearly rather than guessing or clicking blind —
 you then just finish that one step by hand.

 Two of the newer selectors (the taskbar file icon, the pharmacy field) use
 class names generic enough that they could plausibly match more than one
 element on screen at once (e.g. if more than one file happens to be minimized
 to the taskbar at the same time). Rather than guessing which match is correct,
 the script checks for that and stops with a clear warning if it ever finds
 more than one — so worst case it asks you to finish that step by hand, it
 should never silently act on the wrong file.

 TEST IN YOUR TRAINING ENVIRONMENT FIRST. Watch the on-screen status line at the
 top of the panel and the browser console (F12) the first several times you use
 this before trusting it during a real patient day. Pay particular attention to
 Step ④ the first few times, since it's built on the least specific selectors.

 FIXED (2026-08-12): Step ① once opened the wrong patient's chart — the first
 patient listed in the inbox, sitting visually behind the popup. Root cause:
 the patient-name selector matched on data-testid="name-variants" alone, and
 that same test id is also used on each inbox row's own name element, so a
 plain "first match on the page" query grabbed the inbox row instead of the
 popup. That also explains why the popup never minimized — the real popup
 name link never actually got clicked.
   1. The selector is now scoped to div.patient-name-wrapper, which (per the
      original capture) belongs to the popup's own markup, not the inbox row.
   2. Every selector in this script still refuses to act if it finds more
      than one visible match, as a second layer of defense.
   3. Step ① also verifies the fax popup actually minimizes after the
      patient-name click before going anywhere near Medications — if it
      doesn't, it stops and tells you rather than continuing on an uncertain
      chart.
 No prescription action was taken against the wrong patient when this
 happened. Re-test the whole flow in the training environment before trusting
 Step ① again on a real patient day.

 CHANGED (0.5.0, for beta testing): the panel is now small and translucent
 by default (bottom-right) so it doesn't sit on top of whatever's behind it.
 It still shows the Alt+1..4 reminders at that size. Hovering over it, or
 triggering a step (by button or hotkey), pops it to full size/opacity so
 you can read the status line; it shrinks back a few seconds after that step
 finishes if you're not hovering over it. This is purely visual — the
 hotkeys and click-safety logic are unchanged.
=====================================================================================
*/

(function () {
  'use strict';

  // ===================================================================
  // Selectors — built from your capture. Class names tied to CHR/Quasar
  // permission-state (e.g. "hover", "active", "visible-can-*") are
  // deliberately left out of these selectors since they're unstable —
  // matching on the more specific structural/semantic classes instead,
  // with a text check as a second confirmation before anything is clicked.
  // ===================================================================
  const SELECTORS = {
    patientName: {
      label: 'Patient name link (file viewer popup)',
      // FIX (after a wrong-patient click on 2026-08-12): the original version
      // matched on data-testid="name-variants" alone, which also matches the
      // patient name rendered inside each inbox row (a plain "tr.q-tr" table
      // row, sitting visually behind the popup). document.querySelector just
      // grabbed whichever came first in DOM order — the inbox row, not the
      // popup — which is why it opened the wrong chart and the popup never
      // got the click that would've minimized it.
      //
      // Scoped now to only match inside div.patient-name-wrapper, which — per
      // the original capture — wraps the popup's own name element and is NOT
      // part of the inbox row's markup. Still guarded by uniqueAmongOrThrow
      // underneath in case more than one popup/wrapper is ever open at once.
      find: () =>
        uniqueAmongOrThrow(
          document.querySelectorAll('div.patient-name-wrapper span[data-testid="name-variants"]'),
          'Patient name link (file viewer popup)'
        ),
    },
    medicationsTab: {
      label: 'Medications tab',
      find: () =>
        uniqueAmongOrThrow(
          Array.from(document.querySelectorAll('a.open-section.menu-btn')).filter(
            (el) => el.textContent && el.textContent.trim() === 'Medications'
          ),
          'Medications tab'
        ),
    },
    renewButton: {
      label: 'Renew Medications button',
      find: () => uniqueAmongOrThrow(document.querySelectorAll('a.represcribe.btn'), 'Renew Medications button'),
      verifyTextIncludes: 'renew',
    },
    createButton: {
      label: 'Create Prescription button',
      find: () => uniqueAmongOrThrow(document.querySelectorAll('span.create-prescription.btn'), 'Create Prescription button'),
      verifyTextIncludes: 'create',
    },
    faxButton: {
      label: 'Fax with e-Signature button',
      find: () => uniqueAmongOrThrow(document.querySelectorAll('a.fax-pdf'), 'Fax with e-Signature button'),
      verifyTextIncludes: 'fax',
    },
    signButton: {
      // Not clicked by this script — kept here only so we could later detect
      // "has the sign screen loaded" if useful. Sign stays 100% manual.
      label: 'Sign button (detection only, never auto-clicked)',
      find: () => document.getElementById('sign-prescription'),
    },

    pharmacyField: {
      label: 'Pharmacy field in fax dialog',
      // Scoped to the "selected item" chip inside the search field — if this
      // ever matches more than one visible element on screen, uniqueVisibleOrThrow
      // aborts rather than highlighting/guessing the wrong one.
      find: () =>
        uniqueVisibleOrThrow(
          'div.search-field.placeholderable div.selected-item.hoverable div.item-name.display-field',
          'Pharmacy field'
        ),
    },
    taskbarFileAfterSend: {
      label: 'Taskbar file icon (post-send)',
      // This class looks like a generic attachment icon — if you ever have more
      // than one file minimized to the taskbar at once, this will (correctly)
      // refuse to guess which one and stop instead.
      find: () => uniqueVisibleOrThrow('div.inbox-item.file-item div.icon.entypo.attach', 'Taskbar file icon'),
    },
    markDoneButton: {
      label: '"Mark Done and Next" button',
      find: () => uniqueVisibleOrThrow('a.right-action.btn.next-item', '"Mark Done and Next" button'),
    },
  };

  // ===================================================================
  // Utilities
  // ===================================================================
  function findByExactText(cssSelector, text) {
    const els = document.querySelectorAll(cssSelector);
    for (const el of els) {
      if (el.textContent && el.textContent.trim() === text) return el;
    }
    return null;
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }

  // Use this instead of a plain querySelector/querySelectorAll result whenever
  // a selector is broad enough that it might plausibly match more than one
  // visible element (e.g. a generic icon class, or a name element that could
  // exist in more than one panel at once). Returns null if nothing matches
  // yet (keep waiting), the element if exactly one visible match exists, or
  // throws if there's more than one — ambiguity should stop the script, never
  // get silently resolved by picking "the first" (that's what caused the
  // wrong-patient click on 2026-08-12).
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

  // Thin wrapper for the common case of passing a plain CSS selector string.
  function uniqueVisibleOrThrow(selector, label) {
    return uniqueAmongOrThrow(document.querySelectorAll(selector), label);
  }

  // Sanity check: after clicking what we believe is the real patient-name
  // link, the fax popup should minimize to the taskbar (that element itself,
  // or its containing popup, should stop being visible). If it doesn't within
  // a few seconds, something is wrong — either the wrong element got clicked,
  // or CHR didn't respond the way it normally does — and we should NOT go on
  // to click Medications/Renew against whatever chart happens to be showing.
  function waitForInvisible(el, { timeout = 3000, interval = 150 } = {}) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function tick() {
        if (!isVisible(el)) return resolve();
        if (Date.now() - start > timeout) {
          return reject(
            new Error(
              'clicked the patient name, but the fax popup doesn\'t look like it minimized as expected — stopping before touching Medications. Please check you\'re on the correct patient\'s chart before continuing by hand'
            )
          );
        }
        setTimeout(tick, interval);
      })();
    });
  }

  function waitFor(finderFn, { timeout = 8000, interval = 150 } = {}) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function tick() {
        let el;
        try {
          el = finderFn();
        } catch (e) {
          // A thrown error (e.g. ambiguous match) is a real problem, not a
          // "not loaded yet" state — surface it immediately, don't retry.
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
    if (selectorDef.verifyTextIncludes) {
      const text = (el.textContent || '').toLowerCase();
      if (!text.includes(selectorDef.verifyTextIncludes)) {
        throw new Error(`found an element but its text didn't look right for "${selectorDef.label}" — stopping rather than risk a wrong click`);
      }
    }
    setStatus(`Clicking: ${selectorDef.label}`);
    el.scrollIntoView({ block: 'center' });
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.click();
    // small settle delay so the next wait doesn't race the click's own re-render
    await new Promise((r) => setTimeout(r, 250));
    return el;
  }

  // ===================================================================
  // Steps — each one is only ever run because YOU pressed its button/hotkey
  // ===================================================================
  async function step1_openToRenewList() {
    try {
      const nameEl = await clickWhenReady(SELECTORS.patientName);
      setStatus('Waiting for the fax popup to minimize …');
      await waitForInvisible(nameEl);
      await clickWhenReady(SELECTORS.medicationsTab);
      await clickWhenReady(SELECTORS.renewButton);
      setStatus('✅ Renew list is up — double check this is the right patient, click the medication(s) yourself, then press ②.', false);
    } catch (e) {
      setStatus(`⚠️ Stopped at Step ①: ${e.message}. Finish this part by hand.`, true);
    }
  }

  async function step2_createPrescription() {
    try {
      await clickWhenReady(SELECTORS.createButton);
      setStatus('✅ Prescription created — review it, then click Sign yourself (not automated).', false);
    } catch (e) {
      setStatus(`⚠️ Stopped at Step ②: ${e.message}. Click Create by hand.`, true);
    }
  }

  async function step3_continueToFax() {
    try {
      await clickWhenReady(SELECTORS.faxButton);
      if (SELECTORS.pharmacyField && SELECTORS.pharmacyField.find) {
        try {
          const field = await waitFor(SELECTORS.pharmacyField.find, { timeout: 4000 });
          highlightElement(field);
          setStatus('⚠️ STOP: pharmacy field highlighted above — double-check it, then click Send yourself.', true);
        } catch (e) {
          setStatus('⚠️ STOP: double-check the pharmacy field yourself (could not auto-highlight it), then click Send.', true);
        }
      } else {
        setStatus('⚠️ STOP: double-check the pharmacy field is correct, then click Send yourself.', true);
      }
    } catch (e) {
      setStatus(`⚠️ Stopped at Step ③: ${e.message}. Click "Fax with e-Signature" by hand.`, true);
    }
  }

  async function step4_finishAndNext() {
    try {
      await clickWhenReady(SELECTORS.taskbarFileAfterSend);
      await clickWhenReady(SELECTORS.markDoneButton);
      setStatus('✅ Done — back at the inbox.', false);
    } catch (e) {
      setStatus(`⚠️ Stopped at Step ④: ${e.message}. Finish by hand.`, true);
    }
  }

  function highlightElement(el) {
    el.scrollIntoView({ block: 'center' });
    const prevOutline = el.style.outline;
    const prevShadow = el.style.boxShadow;
    el.style.outline = '3px solid #e53e3e';
    el.style.boxShadow = '0 0 0 6px rgba(229, 62, 62, 0.25)';
    setTimeout(() => {
      el.style.outline = prevOutline;
      el.style.boxShadow = prevShadow;
    }, 6000);
  }

  // ===================================================================
  // UI
  // ===================================================================
  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      /* Compact + translucent by default so it doesn't sit on top of the
         buttons behind it — hover, focus, or an in-progress step brings it
         to full size/opacity. Alt+1..4 always work either way; this is
         purely visual. */
      #chrrx-panel {
        position: fixed; bottom: 20px; right: 20px; z-index: 999999;
        width: 168px; background: #fff; color: #1a202c;
        border: 1px solid #cbd5e0; border-radius: 8px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.25);
        font-family: -apple-system, Segoe UI, Roboto, sans-serif; font-size: 12px;
        padding: 8px;
        opacity: 0.32;
        transition: opacity 0.12s ease, width 0.12s ease;
      }
      #chrrx-panel:hover,
      #chrrx-panel:focus-within,
      #chrrx-panel.chrrx-active {
        opacity: 1;
        width: 300px;
        padding: 12px;
      }
      #chrrx-panel h4 { margin: 0 0 8px; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #chrrx-panel button {
        display: block; width: 100%; margin-bottom: 6px; padding: 7px 8px;
        background: #ebf8ff; border: 1px solid #90cdf4; border-radius: 4px;
        cursor: pointer; font-size: 12px; text-align: left;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      #chrrx-panel button:hover { background: #bee3f8; }
      #chrrx-panel button:disabled { opacity: 0.5; cursor: not-allowed; }
      #chrrx-status {
        margin-top: 8px; padding: 6px 8px; border-radius: 4px;
        background: #f7fafc; border: 1px solid #e2e8f0; min-height: 32px;
        font-size: 11px; line-height: 1.4;
      }
      #chrrx-status.warn { background: #fffbea; border-color: #f6e05e; color: #744210; }
      #chrrx-status.err { background: #fff5f5; border-color: #feb2b2; color: #822727; }
    `;
    document.head.appendChild(style);
  }

  let chrrxCollapseTimer = null;
  let chrrxHovered = false;

  function expandPanel() {
    const panel = document.getElementById('chrrx-panel');
    if (!panel) return;
    panel.classList.add('chrrx-active');
    if (chrrxCollapseTimer) clearTimeout(chrrxCollapseTimer);
  }

  // Shrinks back to the small/translucent state a few seconds after a step
  // finishes, unless the mouse is still over it (hover keeps it expanded via
  // CSS regardless of this class).
  function scheduleCollapse(delayMs) {
    const panel = document.getElementById('chrrx-panel');
    if (!panel) return;
    if (chrrxCollapseTimer) clearTimeout(chrrxCollapseTimer);
    chrrxCollapseTimer = setTimeout(() => {
      if (!chrrxHovered) panel.classList.remove('chrrx-active');
    }, delayMs);
  }

  function setStatus(msg, isWarnOrError) {
    const el = document.getElementById('chrrx-status');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('warn', 'err');
    if (isWarnOrError) el.classList.add(msg.startsWith('⚠️') && msg.includes('Stopped') ? 'err' : 'warn');
    console.log('[CHR Rx Assistant]', msg);
    // Pop to full size while something is actively happening or just went
    // wrong, then settle back down after a few seconds so it stops covering
    // whatever's underneath it.
    expandPanel();
    const isTerminal = msg.startsWith('✅') || msg.startsWith('⚠️');
    scheduleCollapse(isTerminal ? 4000 : 8000);
  }

  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'chrrx-panel';
    panel.innerHTML = `
      <h4>Rx Renewal Assistant</h4>
      <button id="chrrx-1">① Alt+1 — Open chart → Medications → Renew</button>
      <button id="chrrx-2">② Alt+2 — Create Prescription</button>
      <button id="chrrx-3">③ Alt+3 — Continue to Fax</button>
      <button id="chrrx-4">④ Alt+4 — Finish: mark done & next</button>
      <div id="chrrx-status">Ready. Start with ① once a patient's Rx fax popup is open and you've read the request.</div>
    `;
    document.body.appendChild(panel);
    panel.querySelector('#chrrx-1').addEventListener('click', step1_openToRenewList);
    panel.querySelector('#chrrx-2').addEventListener('click', step2_createPrescription);
    panel.querySelector('#chrrx-3').addEventListener('click', step3_continueToFax);
    panel.querySelector('#chrrx-4').addEventListener('click', step4_finishAndNext);
    panel.addEventListener('mouseenter', () => { chrrxHovered = true; });
    panel.addEventListener('mouseleave', () => {
      chrrxHovered = false;
      scheduleCollapse(600);
    });
    return panel;
  }

  function init() {
    injectStyles();
    buildPanel();
    document.addEventListener('keydown', (e) => {
      if (!e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return;
      if (e.key === '1') { e.preventDefault(); step1_openToRenewList(); }
      if (e.key === '2') { e.preventDefault(); step2_createPrescription(); }
      if (e.key === '3') { e.preventDefault(); step3_continueToFax(); }
      if (e.key === '4') { e.preventDefault(); step4_finishAndNext(); }
    });
  }

  init();
})();
