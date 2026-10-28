# Stage 6 — Build plan (proposal)

**Date:** 2026-10-21 CDT · **Spec:** `docs/SPEC.md` v0.8 (approved 2026-10-21 13:46) · **Status:** awaiting Dan's OK. No code yet.
**Starting point:** `main` at `ef5a800` (PR #14 merged). The build matches v0.7 and is tagged `stage5-verified` (`11baab4`); 510 unit tests pass and the build is clean.

## 1. How every milestone runs

Same routine as Stage 4 (`docs/stage4-plan.md` §4), plus the §18.7 rules:

1. **Its own branch** from an up-to-date `main` (`m11-filter-order`, `m12-categories`, …). It's merged by PR only after its verification passes and Dan says OK. Each merge deploys to GitHub Pages, so the tablet gets it on the next reload.
2. **Tests first where there's logic.** Anything with a number or a decision lives in `src/domain/` or `src/io/` and has Vitest tests, including the must-have tests in SPEC §18.6 and §19. UI files only render and call those.
3. **Browser check:** a new `scripts/m1x-ui-check.mjs` (headless Chrome, like M2–M10).
4. **Regression on every milestone:**
   - `npx vitest run` (all old and new tests);
   - `npm run build`;
   - **all** earlier browser checks (`m2`–`m10`, then each new one);
   - a mutation pass on the new domain code, checking that every mutant compiles before counting it as caught.
5. **Verification written as a review of someone else's work** (`docs/reviews/M1x.md`): each acceptance criterion with evidence (test name and line, or check step), then fixes. M12 and M16 also get an **independent fresh-session review** before merging (STAGE6-START: data migration and real counts are the high-risk parts).
6. Commit, push, update the session log, open the PR, and stop for Dan's OK. Then the hands-on Tab S8 check for that milestone, before the next one starts.

Numbering continues from Stage 4 (M1–M10), so `docs/reviews/` stays unambiguous. Milestone 6 (helper devices) is too big for one review. It's split into **M16a/b/c**, each with its own branch, review and merge, in the same order the data flows.

## 2. Milestones

| M | Scope | Spec | Risk |
|---|---|---|---|
| **M11** | Filter order | F5 | Low |
| **M12** | New categories, new seed, Stage 5 finding 2 | §11, §12, §7 `categories.csv`, F9, F22 | **High** (data) |
| **M13** | Bulk move | F28, F9 | Medium |
| **M14** | Order-list search and Export shown lines only | F12, F13 | Medium (money) |
| **M15** | Named order lists, first schema upgrade | F27, F8, F10, F21, F15, F17, §3, §7 | **High** (schema) |
| **M15b** | Add many items to an order list: checkboxes, quantity rule | F27 (add many), F28, F12 | Medium (money) |
| **M16a** | Helpers on the main tablet: records, count kits, second schema upgrade | §18.1, §18.2 (kit), §3, F24 | **High** (schema) |
| **M16b** | Helper mode on the device: join, count, add items, send | §18.2 (join), §18.3, §18.4, F22, §2, §17 | Medium |
| **M16c** | Import counts, undo, pending items | §18.5, F26, F24, F15, F17 | **High** (real counts) |

### M11 — Filter order (F5)

- **Acceptance:** the filter panel shows Needs order · Short only · Low spares only · Category · **Location · Supplier**, in that order. Today it's Category · Supplier · Location (`src/ui/screens/inventory/FilterPanel.tsx:57-76`).
- **Tests:** none new in Vitest. The order is a UI layout and `src/domain/filters.ts` doesn't change. The browser check reads the section headings in order.
- **Screens:** Inventory › Filters.
- **Regression:** `m2-ui-check` (filters). Also check that the active-filter chips and count don't depend on the order.
- A small one, to check the routine (branch, PR, Pages deploy, tablet) before the risky ones.

### M12 — Categories (§11), the new seed and `categories.csv`

- **Acceptance:**
  - First launch loads `seed/frc2408-starter-catalog-2026-10-21.zip`. It has 11 categories in §11 order, including empty ones (Assemblies, Programming, Misc) and empty subcategories. It still has 129 items, 168 vendor options and 128 photos, and an order total of $8,413.66.
  - "Start empty" gets the §11 list too.
  - `categories.csv` in both layouts (§7) loads with the right order.
  - Backups keep writing the v0.7 layout.
- **Also in scope: Stage 5 finding 2** (names whose capitals don't match the lists). Bulk move and the new names touch the same code, and the fix is small:
  - restore and the seed rewrite each item's category, subcategory and location to the list's spelling;
  - `itemsIn` and the subcategory check compare with `nameKey`.
- **Tests (§19 Categories):**
  - the real 2026-10-21 seed: counts, $8,413.66, the category and subcategory order, and empty groups kept;
  - both `categories.csv` layouts (the new-seed layout and a v0.7 backup);
  - a backup without `categories.csv` rebuilds the list from the items;
  - the round-trip keeps empty categories and their order;
  - a case-mismatch restore (`motors`) ends up as `Motors`, with rename and remove behaving (the Stage 5 probe P1, written as a real test).
- **Code:**
  - `src/io/seed.ts` `SEED_FILE`;
  - the `seedUrl` import in `src/ui/screens/Setup.tsx`;
  - `tests/helpers.ts` `SEED_PATH`;
  - `src/io/lists-csv.ts` (spelling fix-up);
  - `src/domain/lists.ts`, `src/data/items.ts` (`nameKey` compares).
- **Seed swap fallout:** 33 references to the 2026-10-17 file name in `tests/` and `scripts/`. Old category names appear in 19 test files and 4 browser checks (`m2`, `m3`, `m8`, `m9`). Most of the test files use hand-made fixtures, which can keep the old names. Only checks that load the seed move to the new names. Each change is reviewed so a test isn't weakened just to pass. The old seed ZIP stays in the repo until this milestone merges, then it's removed in the same PR (nothing loads it any more).
- **Screens:** Setup (step 3), Inventory list headers, Categories, Labels (by category), Count (by category). These are only renamed; their behavior doesn't change.
- **Existing installs:** no remap (§15 Q7c). The tablet keeps its test data and old categories until the fresh start in STAGE6-START step 6.
- **Regression:** all browser checks, re-run on the new seed; F22 and F17 Stage 5 checks; the backup → restore round-trip.

### M13 — Bulk move (F28)

- **Acceptance:**
  - **Select** mode on the Inventory list, and in search and filter results, with checkboxes on rows and group headers, plus "Select all shown".
  - **Move to…** a category and subcategory, including "+ New subcategory…" and "+ New category…".
  - A confirmation with the count and where the items come from ("Move 12 items to Fasteners › Bolts?").
  - One transaction. No PIN.
- **Tests (§19 Bulk move):**
  - only category and subcategory change; every other field, `updatedAt` aside, is byte-equal;
  - all-or-nothing (a failure partway leaves everything as it was);
  - the reported count is right;
  - creating a new subcategory or category while moving;
  - a header checkbox selects exactly the items shown under it (respecting the current search and filters).
- **Code:** a new `moveItems(db, ids, place)` in `src/data/items.ts`, next to the existing `CategoryPlace` used by `removeCategory`. Selection state is a pure helper in `src/domain/`.
- **Screens:** Inventory (`Inventory.tsx`, `ItemRow.tsx`): selection mode, a bottom action bar, the move dialog. Check row heights and 48 px targets in both orientations.
- **Regression:** `m2` (list, search, filters), `m3` (edit and category screens).

### M14 — Order-list search and Export shown lines only (F12, F13)

- **Acceptance:**
  - A search box on the Order screen filters lines by item name, part #, supplier or notes as you type.
  - "Showing n of m lines" and the total of the lines shown; the grand total of the whole list stays visible.
  - **Export CSV** always exports every line.
  - **Export shown lines only** exports the filtered lines, with "filtered" and the search text in the file name and a note in the first row.
- **Tests (§19 Order search):**
  - matching on each field, with accents and capitals ignored like F4 (`src/domain/search.ts`);
  - n of m and the shown total, to the cent;
  - Export CSV is byte-equal to today's output (F13 unchanged);
  - the shown-only export has exactly the filtered lines with subtotals for the groups shown, the note row, and the grand total of the shown lines;
  - a file name with unsafe characters in the search text is cleaned.
- **Code:** `src/domain/order.ts` (filter an `OrderList`), `src/io/order-csv.ts` (note row, file name).
- **Screens:** Order (`Order.tsx`, `ExportDialog.tsx`).
- **Regression:** `m4` (order list, CSV, stale banner). The F13 columns and the subtotal rows don't change.

### M15 — Named order lists (F27) and the first schema upgrade

- **Acceptance (F27):**
  - The Order screen has **Automatic** plus named lists. Create, rename, duplicate and delete lists.
  - "Add to order list" from the row menu, the detail card and a scan result. The default quantity is the suggested order qty, otherwise one pack. Adding an item that's already on the list asks first.
  - Each list shows supplier groups and totals as in §4, with the same no-price and stale flags, per-line +/− and remove, search and both exports.
  - A deleted item leaves every list, and the delete confirmation says how many lists it was on.
  - `order-lists.csv` is in full backups. A full restore replaces the lists; a CSV-only restore keeps them and drops lines for items that are gone (§15 Q7d).
  - Lists never change inventory.
- **Schema upgrade (section 3 below):** `version(2)` adds `orderLists`. Two changes go first in this milestone:
  - the **schema-version guard** (Stage 5 finding 6);
  - **Stage 5 finding 1**: "Set up again" must not appear for a blocked or temporary open failure. With a real upgrade, "blocked" (another tab open during an upgrade) becomes possible for the first time, and today that screen deletes everything in two taps.
- **Tests (§19 Named order lists, plus):**
  - default quantity;
  - pack rounding and totals;
  - no-price lines left out of the total;
  - delete removes the item from every list (multi-entry index);
  - lists never touch `on_hand`, `desired`, `spares` or the automatic list;
  - the `order-lists.csv` round-trip, including empty lists, quotes and commas in names and notes;
  - full vs CSV-only restore behavior;
  - the upgrade tests in section 3.
- **Code:**
  - `src/data/db.ts`;
  - a new `src/data/order-lists.ts`;
  - `src/io/order-lists-csv.ts`;
  - `src/io/backup.ts`, `bundle.ts`, `restore.ts`;
  - `src/data/items.ts` `deleteItem`;
  - `src/data/inventory.ts` `replaceAll`.

  The manifest app version is bumped (`APP_VERSION` is still `0.1.0`).
- **Screens:** Order (tabs or a picker for Automatic / named lists), item row menu (new), Detail, Scan result, Delete confirmation, Restore dialog (the comparison mentions order lists), StorageError.
- **Regression:** `m4`, `m5` (backup, restore, price import), `m6` (PIN gates: none added), `m8` (scan), `m3` (delete). The F15/F17 Stage 5 checks.

### M15b — Add many items to an order list (F27, Dan 2026-10-23)

- **Acceptance:**
  - The Automatic list gets Select mode: checkboxes on lines and supplier headers, and "Select all shown" (so a search narrows the selection first).
  - Inventory Select mode (F28) gets **Add to order list…** beside Move to….
  - The Add dialog picks a list (or "+ New list…") and a quantity rule: up to desired + spares, up to desired only, or one pack each, rounded up to whole packs.
  - Items already at the target are skipped, and the dialog says how many. Items already on the list: asked once, replace or keep.
  - Saved in one transaction. The Automatic list and inventory don't change.
- **Tests:** each quantity rule with pack rounding, against hand-worked numbers; skipped count; replace vs keep; a hidden-selection warning as in F28; the list's totals to the cent.
- **No schema change** (uses M15's `orderLists`).
- **Screens:** Order (Automatic, Select mode), Inventory (Select bar), the Add dialog.
- **Regression:** `m4`, `m13`, `m14`, M15's check.

### M16a — Helpers on the main tablet, and the second schema upgrade

- **Acceptance:**
  - Count-in start screen › **Helper devices**:
    - add, edit and remove helpers (unique name; groups of one kind; Allow new items);
    - every group is shown with its helpers, and unassigned groups are highlighted;
    - a warning when two helpers share a group;
    - the name is locked once a kit has been sent.
  - **Send count kit** builds the §18.2 ZIP (with prices blank, photos optional) and opens the share sheet. `last_kit_at` is recorded.
  - F24 groups show their assigned helper.
- **Schema `version(3)`:**
  - `helpers`, `pendingItems`, `pendingPhotos` and `importUndo` tables;
  - items get `countedBy`;
  - `lastCounted` becomes a local date-time.

  The code that writes and reads `last_counted` switches together:
  - `saveCount` and add-item write `nowLocalIso()`;
  - `inventory-csv.ts` accepts both forms;
  - `isCounted` compares the local date explicitly.
- **Tests:**
  - kit contents: `kit.json` fields and format version, prices blank, the photos switch;
  - helper rules: unique name, one kind of group, the name lock;
  - date-time `last_counted`: the §19 count-round cases, CSV in/out, date-only files read as local midnight;
  - the upgrade (section 3).
- **Screens:** Count start screen (`Count.tsx`), a new Helper devices screen and helper editor.
- **Regression:** `m9` (count-in, rounds), `m5` (backup and restore with the new columns), the F24 Stage 5 checks.

### M16b — Helper mode on the device

- **Acceptance:**
  - F22 first asks **Set up the shop tablet** / **Join as a helper**. A device that already has an inventory database never sees the question (§18.7).
  - Join opens a kit; the navy "HELPER · name" bar; Count / Scan / Send tabs.
  - Counting uses the F24 screens for the assigned groups. Search and scan reach any item, and counts outside the assignment are flagged.
  - Location and barcode changes; **Add item not on the list** (if allowed) saved as Pending.
  - **Send my counts** builds the cumulative §18.4 ZIP. "Last sent … · n not sent"; a reminder banner.
  - Opening a new kit or **Leave helper mode** checks for unsent counts first.
  - A newer kit format is refused with "reload".
  - Works on phones from 360 CSS px, in Android Chrome and iPhone Safari (zxing fallback).
- **Storage:** a separate `frc2408-helper` database (§15 Q7e). The helper never opens the inventory database, so it can't become a main tablet by accident.
- **Tests:**
  - the counts file: cumulative, latest values only, blank means unchanged, sequence number;
  - new-item validation (required fields);
  - pending ids `pending-<helper id>-<n>`;
  - the unsent-changes count;
  - kit format version refusal;
  - Leave helper mode deletes only the helper database.
- **Screens:** Setup (first question), helper shell and bar, Count / Scan / Send. The shared components get phone layouts: keypad, stepper, Add item form (§17 phone sizes).
- **Regression:** the §18.7 list:
  - the F22 and F24 Stage 5 checks;
  - **tablet screenshots before and after** (1280 × 800 and portrait) for every screen using the keypad, stepper or Add item form, compared pixel by pixel, so phone layouts don't shift the tablet layout;
  - `m9`, `m10`.

### M16c — Import counts, undo, pending items

- **Acceptance (§18.5):**
  - **Check, preview, apply, summary**, with every row of the preview table.
  - Several files at once, in `counted_at` order, with conflicts between files.
  - Unknown kit or helper: a warning, then allowed. Restore files and kit files are rejected with a pointer to the right screen, and Restore rejects kits and counts files.
  - Apply is all-or-nothing.
  - **Undo this import** on the summary and the Backup screen until the next import or restore.
  - **Pending from helpers (n)**: accept (prefilled Add item, real id on save), match to an existing item (use or add the count), discard, flag likely duplicates, combine.
  - `pending-items.csv` and pending photos in full backups; Restore replaces them (Q7d).
  - Imported counts follow the round rule (Q7g).
- **Tests:** everything in §18.6, plus:
  - Undo is exact, field by field;
  - Undo removes a created location only when no item uses it;
  - an import after a restore can't undo across the restore;
  - pending photo storage and backup round-trip.
- **Screens:** Import counts (from Count and Backup), Pending review, Backup screen (Undo button), Restore dialog. Use the `docs/mockups/helper-screens/` mockups (11a–11f), with the §11 category names.
- **Regression:** `m5`, `m9`, the F15/F17/F24 Stage 5 checks, and a full kit → helper → counts → import round trip in two browser contexts (main and helper) in one check script.

### v0.13 milestones (added 2026-10-28)

| # | Milestone | Spec | Risk |
|---|---|---|---|
| **M18** | Stage 5 leftovers: findings 3, 4, 5, 7, 8, 9 | §2, F16, F17, §9, §22 | Low–medium (restore) |
| **M19** | Placed orders, receiving, on order, price copy; schema v4 | F30, F31, §4, §21.1–§21.4, §21.6, F2, F12, F27, F8, F23, F9, §6 | **High** (schema, counts, money) |
| **M20** | Order history, spending summary, CSV exports, printable summary | F32, §21.5 | Medium (money) |

- **M18:** done as `docs/reviews/M18.md`.
- **M19:** v0.13 approved 2026-10-28; ready to build. Acceptance and tests are §21.1–§21.4, §21.6 and the matching §22 items. Regression: `m5` (backup and restore with the new files and the Orders row), `m15`/`m15b` (named lists losing ordered lines; quantity rules subtracting on order), `m3` (delete with units on order), the upgrade check pattern from `m16a-upgrade-check.mjs` (v3 → v4 against a copy of the tablet backup). Independent fresh-session review recommended (receiving changes real counts; a schema upgrade).
- **M20:** after M19. Acceptance and tests are §21.5 and the matching §22 items, with ranges tested on boundary dates. Regression: `m14` (order exports), `m8` (print route).

## 3. The Dexie schema upgrade

**Today:** `version(1)` only (`src/data/db.ts:49-56`): `items, photos, suppliers, locations, categories, settings`. Categories already have their own table, so §11 needs no schema change.

| Version | Milestone | Change | Data migration |
|---|---|---|---|
| 2 | M15 | Add `orderLists: 'id, key, *itemIds'` | None (new empty table). Writes `schemaVersion = 2` |
| 3 | M16a | Add `helpers: 'id, &key'` (unique name key, like `orderLists`; M16a), `pendingItems: 'id, helperId, barcode'`, `pendingPhotos: 'pendingId'`, `importUndo: 'id'` | Every item: a date-only `lastCounted` becomes local midnight with that date's UTC offset; `countedBy = ''` added. Nothing else changes. Writes `schemaVersion = 3` |

**Guard (built in M15, before `version(2)` ships):**
- the app knows its own schema version;
- on boot, if the database's stored `schemaVersion` is higher, it shows a "This app is out of date — reload to update" screen with a Reload button and writes nothing;
- the service-worker update banner already exists (M10), so reload brings in the new build.

This covers an old cached copy, and a rollback of the Pages deploy. Dexie 4 doesn't refuse on its own (Stage 5 probe P4).

**Blocked upgrades:**
- if another tab holds the database during an upgrade, Dexie raises `blocked`. The app shows "Close other tabs of this app" with **Try again**, never the "Set up again" path (finding 1);
- old tabs close their connection on `versionchange`.

**How it's tested:**
1. **Unit (fake-indexeddb), each version:**
   - build a `version(1)` database with real-shaped rows: an item with a dated `last_counted` on each side of the DST change (2026-03-08 and 2026-11-01), a blank one, photos, categories, suppliers, locations, and settings (PIN hash, `countSince`, `lastBackupAt`);
   - open it with the new `InventoryDb` and compare every row field by field: only the planned fields changed, and everything else is byte-equal, photos included;
   - also upgrade 1 → 3 in one step, since the tablet may skip M15's deploy.
2. **Real tablet data:**
   - before M15 merges, export a **full backup from the Tab S8** and save it outside the repo (it holds team data, so it isn't committed);
   - a test reads it via an env-var path, restores it into a `version(1)` database in fake-indexeddb, upgrades it, and checks:
     - item, photo and list counts;
     - the $ order total;
     - every `last_counted` converted;
     - `export → restore` round-trips after the upgrade.
   - The same test runs again in M16a.
3. **Real browser, real upgrade (browser check):**
   - build `stage5-verified` into a temp folder; serve it; run setup and restore the tablet backup;
   - stop it and serve the new build **at the same origin**; reload; check the data on screen and in IndexedDB;
   - then serve the old build again: the guard screen appears and nothing is written.

   **Corrected in M15:** the old build can't show the guard screen, because the guard is new in M15. So step 3 serves the old build again to show what a rollback actually does: Dexie 4 opens the v2 database without an error and leaves the v2 data alone (`scripts/m15-upgrade-check.mjs`). The guard itself is tested from M15 onward: a v2 build opening a database marked v3 (unit tests and `scripts/m15-ui-check.mjs`). The old build in step 3 is `main` before M15, which the tablet runs today, not `stage5-verified`.

   **M16a (the second upgrade):** `main` before M16a has the guard, so step 3 now shows it for real: `scripts/m16a-upgrade-check.mjs` serves `main` (v2) again over the upgraded v3 database, which shows "This app is out of date" and writes nothing.
4. **On the tablet:**
   - export a full backup first; that backup is the way back (§18.7);
   - after the deploy, reload and check the item count, the order total and the About screen;
   - the tablet then gets its fresh start (STAGE6-START step 6) once M16c is merged.

## 4. Decisions for Dan

1. **Split milestone 6 into M16a/b/c.** Each is still a separate branch, review and merge. Recommended: it keeps each review to one part of the data flow.
2. **Stage 5 findings folded in:** finding 2 in M12, findings 1 and 6 in M15. Findings 3, 4, 5, 7, 8 and 9 aren't scheduled; they can go in a separate fix-up milestone whenever you like. Recommended as listed.
3. **Old seed removed in M12** once nothing loads it. Recommended; it's in git history and in the `stage5-verified` tag.
4. **Real tablet backup for the upgrade tests** (section 3, step 2): kept outside the repo and read by path. Needs one export from the Tab S8 before M15.

## 5. Things only the Tab S8 (or a phone) can confirm, by milestone

- **M11–M14:** layout and gloves on the new controls.
- **M15:**
  - the upgrade on the real database;
  - the order-list CSV opening in Sheets or Excel.
- **M16a:** the share sheet with a count kit (with and without photos, about 6 MB).
- **M16b:**
  - opening a kit on an Android phone and on an iPhone;
  - zxing scanning on iPhone Safari;
  - Send from a phone (iOS share sheet with a ZIP);
  - layout at 360 px;
  - iPhone data clearing after days without use.
- **M16c:**
  - a real two-device count;
  - clocks on different devices.
