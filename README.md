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
| [CHR Quick Pick (Forms)](chr-quick-pick.user.js) | One-click/keystroke shortcuts to open and pre-fill the bloodwork and imaging requisition templates. | Alt+5 (bloodwork), Alt+6 (imaging) |

## Install (one click, per machine)

Tampermonkey must already be installed in the browser (Chrome, Edge, or Firefox).
Then just open these links — Tampermonkey will pop up an install screen automatically:

- **Rx Renewal Assistant:** https://raw.githubusercontent.com/drmic-cmd/chr-userscripts/main/chr-rx-renewal-assistant.user.js
- **Quick Pick (Forms):** https://raw.githubusercontent.com/drmic-cmd/chr-userscripts/main/chr-quick-pick.user.js

Click **Install** on each. That's the whole setup — no copy-paste needed.

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
