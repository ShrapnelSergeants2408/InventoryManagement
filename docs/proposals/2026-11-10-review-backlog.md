# Review backlog — fixes and small features

**Prepared:** 2026-11-10, from a review of the app at 1.0.0 (SPEC v0.18) · **Status:** B1, B2 and B3 built as M24 (SPEC v0.19, app 1.1.0; `docs/reviews/M24.md`), which fixes A2 and A3 and most of A1 (both devices' new items are kept and the import warns; where two devices counted the same item, the newest count is still used without a conflict). A1 (two devices on one kit: a conflict), A4 (one undo per import), B4 (Send all kits), B5 (helper progress), B6 (count report), B7 (spot-check list), B8 (a new kit keeps the count round), B9 (cycle counts), B10 (help on the Send tab), C1 (pull request checks), C2 (starter catalog out of the offline cache), C3 (one version number), C4 (parallel check runner), C5 (audit fixes without breaking changes) and shorter kit file names are built as M25 (SPEC v0.20, app 1.2.0; `docs/reviews/M25.md`). Everything else is a proposal, not approved or built

Smaller than the three future features in `future-features/`. None is in `docs/SPEC.md` yet; each needs a spec entry before it's built (HANDOFF §5). Dan's priority is marked.

## A. Helper-flow bugs

Worked around for the first count by `docs/GETTING-STARTED-HELPERS.md`.

| # | Issue | Evidence | Fix |
|---|---|---|---|
| A1 | **One kit opened on two devices loses data.** The later count overwrites the earlier with no conflict, and the second device's new items are dropped without a message | A throwaway test on `planImport` (2026-11-10): two files with the same helper id gave 0 conflicts, 0 warnings, one of two new items kept | See B1 |
| A2 | **A second kit for the same helper drops its new items.** Pending ids are `pending-<helper id>-<n>` and `n` restarts at 1 with each kit, so they match ids the tablet has already seen | Read from `src/data/helper-db.ts` (`joinKit`, `nextPendingId`) and `src/domain/import-counts.ts`; not run as a test | Put the kit id in the pending id, or keep the sequence across kits |
| A3 | **"Everything is sent" after a save to Downloads.** Chrome on Android can't share a ZIP, so Send my counts saves the file to the phone and the Send screen then reads as sent. Kits on the tablet behave the same way | `src/io/share.ts`, `HelperSend.tsx`; Chrome's file-type list (`docs/history/spec-questions.md` Q1). Not re-tested on a device | See B2 |
| A4 | **Only the last import can be undone,** so importing helpers' files one at a time leaves Undo covering the final one only | SPEC §18.5 (h), as designed | Say so on the Import screen, or keep an undo per import |

## B. Suggestions

| # | Suggestion | Notes | Priority |
|---|---|---|---|
| B3 | **App-link QR code on the Helper devices screen.** Students scan the tablet to open the app on their phone | The QR library is already in the app (labels). The code holds the app's own address. Could also sit on the Send count kit dialog | **Dan: first** |
| B1 | **Device id in kits and counts files.** Made when a device joins; the tablet warns at import when one kit arrives from two devices | Fixes A1; with the pending-id change, A2. Raises the counts file format version | High (bug) |
| B2 | **Honest send state.** After a save to Downloads, keep a notice ("Saved to Downloads. Now upload it") until the student confirms, instead of "Everything is sent" | Fixes A3. Same notice for kits on the tablet | High (bug) |
| B4 | **Send all kits:** build every helper's kit in one step | Saves a tap-through per helper | |
| B5 | **Per-helper progress on the tablet:** last import time and counted n of m for each helper | `lastImportAt` is already stored | |
| B6 | **Count report export:** before → after for each item in an import or a count round, as CSV | | |
| B7 | **Spot-check list after an import:** items with big changes, zero counts, or counted outside a helper's groups | For a mentor recount | |
| B8 | **Keep "already counted" marks in a new kit,** so a helper that starts again doesn't see progress at zero | | |
| B9 | **Cycle counts:** flag items or groups not counted in N days, so recounts rotate | A setting, like the stale-price age | |
| B10 | **In-app help on the helper's Send tab,** with the student-card steps from the Getting Started guide | | |

## C. Upkeep

| # | Item | Notes |
|---|---|---|
| C1 | Run tests and the build on pull requests, not only on push to `main` | `.github/workflows/deploy.yml` |
| C2 | Leave the starter catalog (5.4 MB) out of the offline precache; fetch it only during shop-tablet setup | A helper's first load is 7.7 MB today. Setup would then need a connection, which SPEC §2 has to allow |
| C3 | One source for the version number | Now in `src/io/backup.ts`, `package.json` and two check scripts |
| C4 | Shared module and one parallel runner for the browser checks | 28 scripts, about 25 minutes in a row |
| C5 | `npm audit fix` for the build tools | 8 low or moderate advisories, none in what ships (`npm audit --omit=dev`: 0) |
