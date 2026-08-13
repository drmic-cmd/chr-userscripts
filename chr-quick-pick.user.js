// ==UserScript==
// @name         CHR Quick Pick (Forms)
// @namespace    matt-family-med-stratford
// @version      0.9.4
// @description  One-click shortcuts to common forms (bloodwork requisition, imaging requisition, work/school note, HPV & cytology cervical screening, ...) from inside a patient chart. Navigation/template-selection only — nothing is signed, submitted, or finalized by this script.
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
        - Bloodwork: clicks the matching template to open it, then STOPS —
          you review and click Apply/Continue yourself.
        - Imaging: clicks the matching template, opens the fax-recipient
          search, switches from the default "Contact" tab to "Facility",
          pre-selects "HPHA XR" as the recipient (so the later fax step is
          already populated with the correct number instead of needing a
          manual search), then clicks Apply.
        - Work and School Note MMD, Mailed Colorectal Cancer Screening
          (FIT): click the matching template AND the confirm/auto-populate
          button, landing you on the populated form ready for review.
        - HPV & Cytology Cervical Screening (ON): click the matching
          template, then select the "MMD" preset option in the
          auto-populate dialog, THEN click the confirm/auto-populate
          button — one extra required step versus the other auto-populate
          forms.
      No path signs or submits any order, and none of this sends the fax
      itself — the recipient is only pre-filled; you still review and send
      it yourself.

 ONE WEAKER SPOT WORTH WATCHING: the shared "auto-populate & continue"
 button (used by imaging, the MMD note, the HPV/cytology requisition, and
 the FIT test) is a plain <input type="submit"> with a fairly generic
 class ("save primary") and, unlike the other buttons in this script, it
 has no visible text for the script to double-check against (submit
 inputs show their label via a "value" attribute, which wasn't captured).
 It's still protected by the same "only click if there's exactly one
 visible match" rule, but pay extra attention to this specific step the
 first several times you test any of those four forms. The imaging
 recipient search (typing "xr" and picking "HPHA XR") has the same
 protection as everything else here, but is worth double-checking the
 first several runs too, since it's new and involves typing into a second
 search box mid-flow.

 TEST IN YOUR TRAINING ENVIRONMENT FIRST, with the console open (F12),
 before relying on this during a real patient day. Adding another form later
 is just adding an entry to QUICK_PICKS near the bottom — send me a fresh
 capture the same way as before and I'll wire it in. Alt+3 is already
 reserved for the second X-ray requisition; after that, Alt+7, 8, 9, 0 are
 free.

 CHANGED (0.3.0): each quick pick now also has an Alt+N hotkey (Alt+5 for
 bloodwork, Alt+6 for imaging — picking up after the Rx Renewal Assistant's
 Alt+1..4 so the two scripts never collide) so you don't need to click
 through the panel. The panel itself is also now small and translucent by
 default, expanding on hover or while a pick is running, so it doesn't sit
 on top of the chart underneath it.

 CHANGED (0.4.0): added two more forms — Work and School Note MMD (Alt+7,
 stops after opening, no auto-populate) and Alpha Labs Cytology & HPV
 Requisition (Alt+8, auto-populates). The imaging and cytology forms now
 share one selector for the auto-populate confirm button, since both use
 the same generic submit button.

 CHANGED (0.4.1): correction — the MMD note also has an auto-populate step
 (same shared Apply button), not just template-open-and-stop as first
 wired. It now auto-confirms too, same as imaging and cytology.

 CHANGED (0.5.0): the panel is now draggable and minimizable, since a
 4-form list was starting to cover buttons underneath it.
   - Drag anywhere by its "⠿ Quick Pick: Forms" title bar.
   - Click the "–" button (top-right of the panel) to shrink it down to a
     small circle; click that circle again to restore it.
   - Both the position and minimized/expanded state are remembered (via
     localStorage) so it stays put across page reloads and new patients —
     it does NOT reset itself.
   - While minimized, the panel won't auto-pop-open when a pick runs (that
     would defeat the point of minimizing it) — instead the restore circle
     pulses briefly so you know something happened, especially useful for
     catching a ⚠️ stop. Alt+5..8 hotkeys work identically whether the
     panel is minimized, expanded, or mid-drag.

 CHANGED (0.6.0): correction — the Alt+8 form was wired to the wrong
 template ("Alpha Labs Cytology & HPV Requisition"). It's now pointed at
 the correct one, "HPV & Cytology Cervical Screening - Ontario Health
 (ON)". Its auto-populate dialog also requires selecting an "MMD" preset
 option before Apply, which the script now does automatically as part of
 this pick — that step doesn't apply to imaging or the school note.

 CHANGED (0.7.0): imaging (Alt+6) now pre-selects "HPHA XR" as the fax
 recipient inside its auto-populate dialog, before clicking Apply — this
 was previously skipped entirely. That means once the requisition is
 populated, the fax step is already pointed at the correct number instead
 of needing a manual recipient search later. Nothing is faxed by this
 script; only the recipient field is pre-filled for you to review.

 CHANGED (0.7.1): correction — the fax-recipient search defaults to a
 "Contact" tab, not the "Facility" one the correct address lives under.
 The imaging pick now explicitly clicks "Facility" before searching, or
 "xr" would have searched the wrong database and found nothing (or the
 wrong entry).

 CHANGED (0.7.2): fix — the fax-recipient search box wasn't returning any
 results ("xr" appeared in the box, but the dropdown stayed empty and the
 script timed out waiting for it). That search box only triggers its
 lookup off real keystroke events, not the single instant value-set used
 elsewhere in this script. It now types into that one box character-by-
 character with real keydown/keypress/keyup events, the same as typing by
 hand — this only affects the fax-recipient search; the template search
 box (which was already working) is unchanged.

 CHANGED (0.8.0): renumbered hotkeys to Alt+1 through Alt+0, dedicated
 entirely to this script (Quick Pick), freeing up the whole 1-0 range as
 the list of forms grows:
   Alt+1 Bloodwork · Alt+2 Imaging (HPHA X-ray) · Alt+3 reserved for a
   second X-ray requisition, coming soon · Alt+4 Work and School Note MMD
   · Alt+5 HPV & Cytology Cervical Screening (PAP)

 ⚠️ IMPORTANT INTERIM NOTE: the Rx Renewal Assistant script still uses
 Alt+1 through Alt+4 for its own steps (unchanged, on purpose — its
 hotkeys are being redesigned separately). Until that happens, if BOTH
 scripts are loaded on the same page, pressing Alt+1 through Alt+4 will
 trigger a step in EACH script simultaneously — e.g. Alt+1 would fire
 "Bloodwork" here AND "open chart → renew list" in Rx Renewal Assistant
 at the same time. Only Alt+5 and up are collision-free for now. Be
 deliberate about testing this before using Alt+1..4 for real patient work
 with both scripts active — this gets resolved once the Rx script's
 hotkeys move.

 CHANGED (0.9.0): added Alt+6 — Mailed Colorectal Cancer Screening (FIT).
 Search text "mailed", opens the template and stops there for you to
 review/Apply yourself (no auto-populate dialog has been captured for this
 one yet — if it turns out to have one, send a capture and it'll pick up
 the same auto-populate handling as the other forms).

 CHANGED (0.9.1): correction — the FIT test does have an auto-populate
 dialog after all. Alt+6 now clicks the shared Apply button too, same as
 imaging/MMD/cytology, instead of stopping at the open template.

 CHANGED (0.9.2): fix — the FIT test's search ("mailed") wasn't returning
 results, same symptom as the earlier fax-recipient bug (text visible in
 the box, empty results). Root cause: the main template search apparently
 behaves inconsistently between folders — some filter client-side off any
 instant value-set (why bloodwork/imaging/MMD/PAP "just worked"), but at
 least this one only triggers its lookup off real keystroke events. Rather
 than patch it form-by-form as this keeps surfacing, ALL template searches
 now type character-by-character with real keydown/keypress/keyup events,
 the same fix already used for the fax-recipient box. Also renamed the
 panel labels: Alt+5 is now "PAP req", Alt+6 is now "FIT - colorectal
 cancer req" (cosmetic only, no behavior change).

 CHANGED (0.9.3): typing into search boxes is now much faster. All but the
 last character of the search text is set instantly; only the last
 character gets a real keystroke (keydown/keypress/keyup). CHR's search
 debounce reads the box's current value whenever it sees a keyup, not
 which key was pressed, so one genuine keystroke against the already-
 complete text is enough to trigger it — no need to simulate typing the
 whole word out letter by letter. Applies to both the template search and
 the fax-recipient search.

 CHANGED (0.9.4): fix — Alt+6 was timing out ("timed out waiting") after
 the search populated correctly, because the FIT template's result was
 matched on the exact full captured text (ending oddly at "...Ontario
 Healt"), which apparently doesn't match the live DOM text byte-for-byte.
 Switched to matching on a stable leading substring ("Mailed Colorectal
 Cancer Screening (FIT)") instead — still requires exactly one visible
 match, so this doesn't weaken the safety check, it just stops depending
 on getting every trailing character of a truncated-looking string exactly
 right.
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
    fitResult: {
      label: 'Mailed Colorectal Cancer Screening (FIT) template result',
      // Matched on a stable leading substring rather than the full captured
      // text — the captured text ended oddly at "...Ontario Healt", which
      // strongly suggests the live DOM text doesn't render byte-for-byte
      // identical to what was captured (a different truncation point,
      // trailing whitespace, etc.), so a strict full-text match was never
      // finding anything and just timing out. This still enforces "exactly
      // one visible match," so a lookalike template would correctly stop
      // the script with a warning rather than risk a wrong click.
      find: () =>
        uniqueAmongOrThrow(
          Array.from(document.querySelectorAll('div.item-title.truncate.item-title-custom')).filter(
            (el) => el.textContent && el.textContent.trim().startsWith('Mailed Colorectal Cancer Screening (FIT)')
          ),
          'Mailed Colorectal Cancer Screening (FIT) template result'
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
    mmdResult: {
      label: 'Work and School Note MMD template result',
      find: () =>
        uniqueAmongOrThrow(
          Array.from(document.querySelectorAll('div.item-title.truncate.item-title-custom')).filter(
            (el) => el.textContent && el.textContent.trim() === 'Work and School Note MMD'
          ),
          'Work and School Note MMD template result'
        ),
    },
    cytologyResult: {
      label: 'HPV & Cytology Cervical Screening template result',
      find: () =>
        uniqueAmongOrThrow(
          Array.from(document.querySelectorAll('div.item-title.truncate.item-title-custom')).filter(
            (el) => el.textContent && el.textContent.trim() === 'HPV & Cytology Cervical Screening - Ontario Health (ON)'
          ),
          'HPV & Cytology Cervical Screening template result'
        ),
    },
    cytologyPresetMMD: {
      label: '"MMD" preset option (in the cytology/HPV auto-populate dialog)',
      // This is a plain option row inside the auto-populate dialog (not the
      // main template-picker list), so it only carries "item-title truncate"
      // — no "-custom" suffix. Matched on exact text, same safety rule as
      // everything else here.
      find: () =>
        uniqueAmongOrThrow(
          Array.from(document.querySelectorAll('div.item-title.truncate')).filter(
            (el) => el.textContent && el.textContent.trim() === 'MMD'
          ),
          '"MMD" preset option'
        ),
    },
    imagingChangeRecipient: {
      label: '"No Recipient Selected" fax-recipient button (imaging auto-populate panel)',
      // "embos" is a domain-specific styling class (not a generic reused
      // one like "btn"), so pairing it with the exact-text filter is extra
      // safe. "hover"/"active" from the capture are transient click-state
      // classes and are deliberately left out.
      find: () =>
        uniqueAmongOrThrow(
          Array.from(document.querySelectorAll('a.change-recipient.embos')).filter(
            (el) => el.textContent && el.textContent.trim() === 'No Recipient Selected'
          ),
          '"No Recipient Selected" fax-recipient button'
        ),
    },
    imagingRecipientSearchInput: {
      label: 'Fax-recipient search box (imaging auto-populate panel)',
      find: () =>
        uniqueAmongOrThrow(
          document.querySelectorAll('div.ih-search-selector input.search-field[type="text"][name="value"]'),
          'Fax-recipient search box'
        ),
    },
    imagingFacilityTab: {
      label: '"Facility" tab (fax-recipient search — defaults to "Contact" otherwise)',
      // Matched on the stable classes only; "hover"/"active" from the
      // capture are transient click-state classes, not part of its
      // identity, so they're deliberately left out.
      find: () =>
        uniqueAmongOrThrow(
          Array.from(document.querySelectorAll('div.hoverable.activatable.selectable-resource')).filter(
            (el) => el.textContent && el.textContent.trim() === 'Facility'
          ),
          '"Facility" tab'
        ),
    },
    imagingRecipientResult: {
      label: '"HPHA XR" fax recipient result',
      find: () =>
        uniqueAmongOrThrow(
          Array.from(document.querySelectorAll('div.item-title.truncate')).filter(
            (el) => el.textContent && el.textContent.trim() === 'HPHA XR'
          ),
          '"HPHA XR" fax recipient result'
        ),
    },
    // Shared by any form whose "auto-populate & continue" dialog uses this
    // generic submit button (currently imaging, MMD note, and cytology).
    // Deliberately matches only on the stable classes — "hover"/"active"
    // seen in some captures of this button are transient click-state
    // classes, not part of its identity, so they're left out on purpose.
    autoPopulateConfirm: {
      label: 'Auto-populate / continue button',
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
  }

  // Some CHR search boxes only trigger their AJAX lookup off a real keyup
  // event — but that lookup reads whatever the box's current value is at
  // that moment, not which specific key was pressed. So there's no need to
  // simulate every keystroke: this sets all but the last character
  // instantly, then fires one real keydown/keypress/keyup for the last
  // character so the debounce sees a genuine keystroke against the
  // already-complete text. Much faster than typing the whole thing out.
  async function typeQuickly(inputEl, text) {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    inputEl.focus();
    if (text.length === 0) {
      setReactiveInputValue(inputEl, '');
      return;
    }
    const allButLast = text.slice(0, -1);
    const lastChar = text.slice(-1);
    setReactiveInputValue(inputEl, allButLast);
    inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: lastChar, bubbles: true }));
    inputEl.dispatchEvent(new KeyboardEvent('keypress', { key: lastChar, bubbles: true }));
    nativeSetter.call(inputEl, text);
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: lastChar, bubbles: true }));
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
    // Some folders' template search only filters client-side off any
    // value-set (which is why this worked fine for most forms so far), but
    // at least one folder's search only triggers its lookup off a real
    // keyup event — same issue as the fax-recipient box. typeQuickly()
    // handles both cases: it sets the text instantly, then fires one real
    // keystroke for the last character so a debounce listener sees it too.
    await typeQuickly(searchEl, searchText);
    await new Promise((r) => setTimeout(r, 900)); // let the filter/AJAX lookup settle
  }

  // ===================================================================
  // Shared flow: pre-select a fax recipient inside a form's auto-populate
  // dialog, before hitting Apply — used so the fax step later doesn't need
  // its own manual recipient search.
  // ===================================================================
  async function selectFaxRecipient(recipientDef) {
    await clickWhenReady(recipientDef.changeButton);
    if (recipientDef.tab) {
      // The search defaults to the "Contact" tab — switch to "Facility"
      // (or whichever tab is configured) before it opens, or the search
      // hits the wrong address database entirely.
      await clickWhenReady(recipientDef.tab);
    }
    const searchEl = await waitFor(recipientDef.searchInput.find);
    setStatus(`Typing recipient search: "${recipientDef.searchText}" …`);
    // This box needs a real keyup event to trigger its AJAX lookup (an
    // instant value-set left it showing the text with no results) — see
    // the 0.7.2 note in the header. typeQuickly() sets the text instantly
    // and fires one real keystroke for the last character to satisfy that.
    await typeQuickly(searchEl, recipientDef.searchText);
    await new Promise((r) => setTimeout(r, 900)); // let the AJAX lookup return
    await clickWhenReady(recipientDef.result);
  }


  // ===================================================================
  // Quick picks — add more forms here later, same shape each time.
  //
  // Numbering scheme (0.8.0): Alt+1 through Alt+0, dedicated to this
  // script only. Alt+3 is deliberately left unassigned — reserved for a
  // second X-ray requisition to be added later, so it doesn't need to
  // renumber everything after it once that's captured.
  // ===================================================================
  const QUICK_PICKS = [
    {
      id: 'bloodwork',
      label: '🩸 Alt+1 — Bloodwork Requisition (Lab - MOHLTC)',
      hotkey: '1',
      searchText: 'Lab - MOH',
      autoSelectResult: SELECTORS.bloodworkResult, // clicks the template for you...
      autoConfirm: null, // ...but stops there — you review and click Apply/Continue yourself
    },
    {
      id: 'imaging',
      label: '🩻 Alt+2 — Imaging - Xray/US/BMD (SGH/HPHA)',
      hotkey: '2',
      searchText: 'imaging - xray/us/bmd',
      autoSelectResult: SELECTORS.imagingResult, // proceeds automatically
      autoRecipient: {
        // Pre-selects "HPHA XR" as the fax recipient so the later fax step
        // is already populated with the correct number.
        changeButton: SELECTORS.imagingChangeRecipient,
        tab: SELECTORS.imagingFacilityTab, // must switch off the default "Contact" tab first
        searchInput: SELECTORS.imagingRecipientSearchInput,
        searchText: 'xr',
        result: SELECTORS.imagingRecipientResult,
      },
      autoConfirm: SELECTORS.autoPopulateConfirm,
    },
    // Alt+3 reserved — a second X-ray requisition is coming; send its
    // capture whenever it's ready and it'll slot in right here as hotkey '3'.
    {
      id: 'mmd',
      label: '📝 Alt+4 — Work and School Note MMD',
      hotkey: '4',
      searchText: 'mmd',
      autoSelectResult: SELECTORS.mmdResult, // proceeds automatically
      autoConfirm: SELECTORS.autoPopulateConfirm,
    },
    {
      id: 'cytology',
      label: '🧫 Alt+5 — PAP req',
      hotkey: '5',
      searchText: 'hpv',
      autoSelectResult: SELECTORS.cytologyResult,
      autoPreset: SELECTORS.cytologyPresetMMD, // selects "MMD" in the auto-populate dialog, before Apply
      autoConfirm: SELECTORS.autoPopulateConfirm,
    },
    {
      id: 'fit',
      label: '🧪 Alt+6 — FIT - colorectal cancer req',
      hotkey: '6',
      searchText: 'mailed',
      autoSelectResult: SELECTORS.fitResult, // proceeds automatically
      autoConfirm: SELECTORS.autoPopulateConfirm,
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
      if (pick.autoRecipient) {
        await selectFaxRecipient(pick.autoRecipient);
      }
      if (pick.autoPreset) {
        await clickWhenReady(pick.autoPreset);
      }
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
      #chrqp-header {
        display: flex; align-items: center; justify-content: space-between;
        margin-bottom: 8px; gap: 6px;
      }
      #chrqp-drag-handle {
        cursor: move; font-weight: 600; font-size: 13px; user-select: none;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;
      }
      #chrqp-min-btn {
        flex-shrink: 0; width: 20px; height: 20px; padding: 0; margin: 0;
        border: 1px solid #cbd5e0; border-radius: 4px; background: #f7fafc;
        cursor: pointer; font-size: 13px; line-height: 1; color: #4a5568;
      }
      #chrqp-min-btn:hover { background: #e2e8f0; }
      #chrqp-panel button.chrqp-pick {
        display: block; width: 100%; margin-bottom: 6px; padding: 7px 8px;
        background: #f0fff4; border: 1px solid #9ae6b4; border-radius: 4px;
        cursor: pointer; font-size: 12px; text-align: left;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      #chrqp-panel button.chrqp-pick:hover { background: #c6f6d5; }
      #chrqp-status {
        margin-top: 8px; padding: 6px 8px; border-radius: 4px;
        background: #f7fafc; border: 1px solid #e2e8f0; min-height: 32px;
        font-size: 11px; line-height: 1.4;
      }
      #chrqp-status.warn { background: #fffbea; border-color: #f6e05e; color: #744210; }
      #chrqp-status.err { background: #fff5f5; border-color: #feb2b2; color: #822727; }

      /* Minimized: collapses to a small draggable circle showing just the
         restore button, anchored at whatever position it was left at. */
      #chrqp-panel.chrqp-minimized {
        width: 40px !important; padding: 0 !important; opacity: 0.55;
        border-radius: 999px; overflow: hidden;
      }
      #chrqp-panel.chrqp-minimized:hover,
      #chrqp-panel.chrqp-minimized:focus-within {
        width: 40px !important; opacity: 1;
      }
      #chrqp-panel.chrqp-minimized #chrqp-drag-handle,
      #chrqp-panel.chrqp-minimized #chrqp-body {
        display: none;
      }
      #chrqp-panel.chrqp-minimized #chrqp-header {
        margin: 0; justify-content: center; padding: 8px 0;
      }
      #chrqp-panel.chrqp-minimized #chrqp-min-btn {
        width: 24px; height: 24px; border-radius: 999px; font-size: 15px;
      }
      @keyframes chrqp-pulse-anim {
        0% { box-shadow: 0 0 0 0 rgba(72,187,120,0.55); }
        70% { box-shadow: 0 0 0 9px rgba(72,187,120,0); }
        100% { box-shadow: 0 0 0 0 rgba(72,187,120,0); }
      }
      #chrqp-min-btn.chrqp-pulse { animation: chrqp-pulse-anim 0.8s ease-out 2; }
    `;
    document.head.appendChild(style);
  }

  let chrqpCollapseTimer = null;
  let chrqpHovered = false;

  function expandPanel() {
    const panel = document.getElementById('chrqp-panel');
    if (!panel || panel.classList.contains('chrqp-minimized')) return;
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

  function pulseMinButton() {
    const btn = document.getElementById('chrqp-min-btn');
    if (!btn) return;
    btn.classList.remove('chrqp-pulse');
    void btn.offsetWidth; // restart the animation if it's already mid-pulse
    btn.classList.add('chrqp-pulse');
  }

  function setStatus(msg, isWarnOrError) {
    const el = document.getElementById('chrqp-status');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('warn', 'err');
    if (isWarnOrError) el.classList.add(msg.startsWith('⚠️') ? 'err' : 'warn');
    console.log('[CHR Quick Pick]', msg);
    const panel = document.getElementById('chrqp-panel');
    if (panel && panel.classList.contains('chrqp-minimized')) {
      // Respect that the user minimized it on purpose — don't pop it back
      // open on its own, just pulse the restore button so they notice.
      pulseMinButton();
      return;
    }
    expandPanel();
    const isTerminal = msg.startsWith('✅') || msg.startsWith('⚠️');
    scheduleCollapse(isTerminal ? 4000 : 8000);
  }

  // Position and minimized state persist across page loads (this script
  // runs directly in the page, so plain localStorage is fine — same
  // mechanism the page itself could use, just under its own key).
  const POS_KEY = 'chrqp-panel-pos';
  const MIN_KEY = 'chrqp-panel-minimized';

  function loadSavedPosition(panel) {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (!raw) return;
      const { left, top } = JSON.parse(raw);
      if (typeof left === 'number' && typeof top === 'number') {
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
      }
    } catch (e) {
      /* corrupt or blocked storage — just keep the default position */
    }
  }

  function savePosition(panel) {
    try {
      const rect = panel.getBoundingClientRect();
      localStorage.setItem(POS_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
    } catch (e) {
      /* storage blocked — dragging still works, just won't persist */
    }
  }

  function loadMinimizedState(panel, minBtn) {
    try {
      if (localStorage.getItem(MIN_KEY) === '1') {
        panel.classList.add('chrqp-minimized');
        minBtn.textContent = '▢';
        minBtn.title = 'Restore';
      }
    } catch (e) {
      /* ignore — starts expanded */
    }
  }

  function saveMinimizedState(panel) {
    try {
      localStorage.setItem(MIN_KEY, panel.classList.contains('chrqp-minimized') ? '1' : '0');
    } catch (e) {
      /* storage blocked — toggle still works, just won't persist */
    }
  }

  // Clamp so a drag (or a saved position from a since-resized window) can
  // never leave the panel stuck off-screen.
  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function makeDraggable(panel, handle) {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      const rect = panel.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      panel.classList.add('chrqp-active'); // stay fully visible while dragging
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const maxLeft = window.innerWidth - panel.offsetWidth - 4;
      const maxTop = window.innerHeight - panel.offsetHeight - 4;
      panel.style.left = `${clamp(startLeft + dx, 4, Math.max(4, maxLeft))}px`;
      panel.style.top = `${clamp(startTop + dy, 4, Math.max(4, maxTop))}px`;
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      savePosition(panel);
      scheduleCollapse(600);
    });
  }

  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'chrqp-panel';
    const buttonsHtml = QUICK_PICKS.map((p, i) => `<button class="chrqp-pick" data-idx="${i}">${p.label}</button>`).join('');
    panel.innerHTML = `
      <div id="chrqp-header">
        <span id="chrqp-drag-handle">⠿ Quick Pick: Forms</span>
        <button id="chrqp-min-btn" title="Minimize">–</button>
      </div>
      <div id="chrqp-body">
        ${buttonsHtml}
        <div id="chrqp-status">Ready. Open a patient's chart, then pick a form.</div>
      </div>
    `;
    document.body.appendChild(panel);

    panel.querySelectorAll('button.chrqp-pick').forEach((btn) => {
      btn.addEventListener('click', () => runQuickPick(QUICK_PICKS[Number(btn.dataset.idx)]));
    });

    panel.addEventListener('mouseenter', () => { chrqpHovered = true; });
    panel.addEventListener('mouseleave', () => {
      chrqpHovered = false;
      scheduleCollapse(600);
    });

    const minBtn = panel.querySelector('#chrqp-min-btn');
    minBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const nowMinimized = panel.classList.toggle('chrqp-minimized');
      panel.classList.remove('chrqp-active');
      minBtn.classList.remove('chrqp-pulse');
      minBtn.textContent = nowMinimized ? '▢' : '–';
      minBtn.title = nowMinimized ? 'Restore' : 'Minimize';
      saveMinimizedState(panel);
    });

    loadSavedPosition(panel);
    loadMinimizedState(panel, minBtn);
    makeDraggable(panel, panel.querySelector('#chrqp-drag-handle'));

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
