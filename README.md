# chr-userscripts

Tampermonkey userscripts for navigating CHR (inputhealth / chr.md / telushealth) faster.

**Nothing here signs, sends, or submits anything on its own.** Every script only
automates navigation and template/field selection — the clinically significant
actions (Sign, Send, Apply) are always left for you to click by hand. See the
comment block at the top of each script for the exact safety design and any
known-issue history.

## Scripts

| Script | What it does | Hotkeys |
|---|---|---|
| [CHR Rx Renewal Assistant](chr-rx-renewal-assistant.user.js) | Walks the Rx renewal flow: open chart → Medications → Renew, Create Prescription, continue to Fax (highlights the pharmacy field for you to check), then Mark Done & Next. | Alt+1, Alt+2, Alt+3, Alt+4 |
| [CHR Quick Pick (Forms)](chr-quick-pick.user.js) | One-click/keystroke shortcuts to open and pre-fill common requisitions and forms, with fax recipients pre-selected where applicable. | Alt+1 Bloodwork · Alt+2 Imaging (HPHA X-ray) · Alt+3 Imaging (GNMI Stratford) · Alt+4 Work and School Note MMD · Alt+5 PAP req · Alt+6 FIT - colorectal cancer req |
| [CHR Selector Capture Tool](chr-selector-capture.user.js) | Not automation — a helper for building the other two. Alt+Click any element on a page to record its structure (tag/class/attributes/text) into a review panel, so a new form/step can be captured accurately and sent over to have a real quick pick or workflow step built from it. | Alt+Click to capture · Alt+Shift+C to toggle capture mode |

## Install (one click, per machine)

Tampermonkey must already be installed in the browser (Chrome, Edge, or Firefox).
Then just open these links — Tampermonkey will pop up an install screen automatically:

- **Rx Renewal Assistant:** https://raw.githubusercontent.com/drmic-cmd/chr-userscripts/main/chr-rx-renewal-assistant.user.js
- **Quick Pick (Forms):** https://raw.githubusercontent.com/drmic-cmd/chr-userscripts/main/chr-quick-pick.user.js
- **Selector Capture Tool:** https://raw.githubusercontent.com/drmic-cmd/chr-userscripts/main/chr-selector-capture.user.js

Click **Install** on each. That's the whole setup — no copy-paste needed.

Note: the capture tool is only needed on whichever machine you're actively using to
build out a new form or workflow step — it doesn't need to go on every staff machine
the way the other two do.

## Getting updates

Each script points back at this repo (`@updateURL` / `@downloadURL`), so once
it's installed, Tampermonkey checks this repo periodically on its own and will
offer the newer version whenever `@version` in the file here is higher than
what's installed.

To force an immediate check on any machine instead of waiting:
Tampermonkey Dashboard (toolbar icon → Dashboard) → **Check for Userscript Updates**
(under the Dashboard's wrench/utilities menu).

## Publishing a change (for Matt)

1. Edit the `.user.js` file, bump the `// @version` line (Tampermonkey only
   offers an update if the version number goes up).
2. Commit and push to `main` on this repo — either via `git push`, or by using
   GitHub's web editor / drag-and-drop upload on this repo page.
3. Every machine with the script installed will pick up the change on its next
   automatic check, or immediately if someone clicks "Check for Userscript
   Updates."

No build step, no branches to worry about — `main` is what everyone reads from.
