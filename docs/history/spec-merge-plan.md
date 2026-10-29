# Spec merge plan: claude.ai proposal → SPEC v0.8

**Date:** 2026-10-21 (America/Chicago) · **Author:** Claude Code (Opus 5.5), Stage 6 step 3 · **No code or `docs/SPEC.md` changed.**
**Inputs:** `docs/SPEC.md` (v0.7, the approved spec), `docs/history/2026-10-21-claude-proposal.md` (the "v0.6 draft" from claude.ai, based on v0.5), the source (`src/data/db.ts`, `src/io/lists-csv.ts`, `src/io/inventory-csv.ts`, `src/domain/count.ts`, `src/data/count.ts`), `docs/history/spec-questions.md`, `docs/history/stage5-review.md`, and the new seed `seed/frc2408-starter-catalog-2026-10-21.zip`.
**Output:** `docs/SPEC-next-draft.md` (v0.8 draft), approved by Dan 2026-10-21 13:46 and made `docs/SPEC.md`.

---

## 1. What this repo's v0.6 and v0.7 are

No git tags exist, locally or on GitHub (`git tag` and `git ls-remote --tags origin` are both empty). There are no version branches either. The versions exist only in `docs/SPEC.md` and the commit messages.

| Version | When | Commit | What changed |
|---|---|---|---|
| **v0.5** | 2026-10-17 15:40 | (Stage 3, claude.ai) | Last version both sides share. The proposal starts from here |
| **v0.6** | 2026-10-18 18:50 CDT | `744b4c2` "F24 count rounds (SPEC v0.6)" | **Count rounds** for count-in (F24). After the first count, every group showed "Recount 100%", so Dan asked for a "counting since <date>" setting. Progress, Start/Continue/Recount and the group summary count an item only if its `last_counted` is on or after that date. Blank means "any time" (the first count). **Start a new count** sets it to today; it can be changed or cleared. Nothing is erased. Built and tested in the same commit (`countSince` setting, `src/domain/count.ts`, `src/data/count.ts`, `Count.tsx`) |
| **v0.7** | 2026-10-18 19:57 CDT | `7e6f0cc` "SPEC v0.7" | Spec text only; the code already did this from M5. (1) A **Category** managed list in §3 (name, order, ordered subcategories; empty ones allowed). (2) **`categories.csv`** in the full backup (§7) so empty categories and their order survive a restore (spec-questions Q3, approved 2026-10-17). (3) **`manifest.json`** in the full backup (app version, `savedAt`, item and photo counts), used by the restore comparison (Q8, approved 2026-10-17). (4) §15: the NEO 2.0 / WCP-1011 test fit and the 2027 radio closed as robot questions; label sheets still open, waiting for a purchase |

After v0.7 (no spec change): `34cf04b` T-01 (persistent storage asked on every launch until granted), merged as PR #13; `11baab4` Stage 5 review (`docs/history/stage5-review.md`); `ba72d61` Stage 6 kit (proposal, helper-screen mockups, new seed).

**The name clash:** the proposal calls itself "v0.6 (draft)". It's a different document from the repo's v0.6. Both branch from v0.5. So the merged version is **v0.8**.

---

## 2. Each proposal change: status in the repo spec

Legend: **Already** = the repo spec already says this · **New** = add as written · **Conflict** = both sides say different things; resolution given.

| # | Proposal change | Status | Resolution in v0.8 |
|---|---|---|---|
| 1 | **Helper devices** (F26, §18.1–18.5), §1 and §2 text, §17 helper-mode conventions | **New** | Added as written. Four places touch repo changes, listed as rows 1a–1d |
| 1a | F24 rewritten with a **Helpers** paragraph | **Conflict** | The proposal's F24 is the v0.5 text plus helpers. It **drops the v0.6 count rounds**. v0.8 keeps the repo's F24 (with count rounds) and appends the proposal's Helpers paragraph. "Progress … counts items counted on any device once imported" is reworded to work with rounds: an imported count counts toward the current round when its `counted_at` is on or after the "counting since" date |
| 1b | F22 first launch: **Set up the shop tablet** / **Join as a helper** | **Conflict (with the built app)** | The proposal's F22 says the shop tablet "loads the starter catalog". The built app (spec-questions Q2, approved 2026-10-17) offers **starter catalog / restore a backup / start empty** as setup step 3. Stage 5 finding 8 already flags that F22 doesn't say this. v0.8 keeps the helper question first and writes the three setup choices into F22, so the merge doesn't spec away the disaster-recovery path |
| 1c | §18.7 Dexie upgrade "adds … (if not already stored) Category stores" | **Already** | A `categories` table has existed since `version(1)` (`src/data/db.ts:54`). No new store. See §4 |
| 1d | §18.5 Import counts preview: "Item's last count on this tablet is older than the kit" | **New**, one detail | Comparing `last_counted` (date-time) with the kit's `created at` needs both in date-time form. That's why `last_counted` becomes a date-time (row 8). One edge case: an item counted on the main tablet under v0.7 (date only, upgraded to local midnight) on the same day a kit is made reads as counted *before* the kit, even if it was counted after. A differing helper count then goes to **Will apply** instead of **Conflict**. This only affects counts made before the upgrade, and the tablet starts fresh after v0.8 (§18.7), so v0.8 notes it in §18.7 and doesn't add a rule |
| 2 | **Named order lists** (F27, §3 Order list, F10/F21 entry points, `order-lists.csv`) | **New** | Added as written. Two gaps filled (Claude's defaults, §15 Q7): what Restore does with order lists (follows spec-questions Q5: full ZIP replaces them; CSV-only restore keeps them and drops lines whose items are gone) and that `order-lists.csv` is part of the F15 list |
| 3 | **Bulk move** (F28) | **New** | Added as written |
| 4 | **Order-list search** + Export shown lines only (F12) | **New** | Added as written. The F12 sentence the repo kept from v0.5 is unchanged |
| 5 | **Filter order** (F5): Supplier last | **New** | Added as written |
| 6 | **New categories** (§11) and remapped seed (§12, `frc2408-starter-catalog-2026-10-21.zip`, `category-mapping-2026-10-21.csv`) | **New** | Added as written. §12's seed file name updated. See row 7 for the file format |
| 7 | **`categories.csv`** in backups and the seed (§7, F9, F22) | **Already** (v0.7), with a **format conflict** | v0.7 and the code: `category, subcategory, order`, one row per (category, subcategory), a single blank-subcategory row only for a category with no subcategories, and `order` = **the category's** position on every row (`serializeCategoriesCsv`, `src/io/lists-csv.ts:137-146`). The proposal and the new seed: a blank-subcategory row for **every** category carrying the category's position, then one row per subcategory whose `order` is **the subcategory's** position (seed: `Electrical,,1` then `Electrical,Control System,1`, `Electrical,Sensors,2` …). **Resolution:** keep the v0.7 format for writing (it's built, tested and in existing backups). Readers accept both: the category's position comes from the category's first row, and subcategories keep file-row order. The current parser already does exactly this (it takes `order` from the first row seen for each category and ignores it on later rows, `lists-csv.ts:110-133`), so the new seed loads correctly as it is. v0.8 §7 says so, and the categories milestone adds a test that loads the real 2026-10-21 seed's `categories.csv` |
| 8 | **`last_counted` as date-time** + **`counted_by`** (§3, §7, CSV column) | **New**, touches v0.6 | Added as written. The v0.6 round rule ("on or after the counting-since date") is restated for date-times: compare the local date of `last_counted`. The current code compares ISO strings as text (`isCounted`, `src/domain/count.ts:15`). That still works for `2026-10-24T18:42-05:00` ≥ `2026-10-24`, as long as values are written in local time with an offset and never as UTC `Z`. v0.8 §3 says local time with offset; §19 adds a test |
| 9 | **`pending-items.csv`** in full backups | **New** | Added. Full ZIP restore replaces pending items; CSV-only keeps them (Claude's default, §15 Q7) |
| 10 | **§9 PDF route** (Save as PDF, print elsewhere at 100%) | **New** | Added as written (Stage 5 decision, 2026-10-21 13:00) |
| 11 | **§6 PIN** additions (bulk move, order lists, §18 actions open; helpers have no PIN) | **New** | Added as written |
| 12 | **§13 parked items** (live sync, helper limits, "on order") | **New** | Added as written |
| 13 | **§14 stage table** | **Conflict** (status text) | Proposal says Stage 4 "built through milestone 10 (2026-10-19)" and Stage 5 "in progress". Merged: Stage 4 done 2026-10-18 (M10, PR #12); Stage 5 done 2026-10-21 except the real label-sheet print (D-01, waiting for labels); Stage 6 = v0.8 |
| 14 | **§15 Q6** (approve the draft, a–d) | **New**, renumbered inside | Kept as Q6. Its intro says "Two details" but lists four; fixed to "Four details". Its sub-items (c) and (d) are unchanged. A new **Q7** lists the merge decisions in this plan that need Dan's yes |
| 15 | **§18.6 / §19 tests** | **New** | Added. §19 gains tests for the merge decisions (seed `categories.csv` format, count rounds with date-times, restore of order lists and pending items) |
| 16 | **§18.7 upgrade notes** | **New**, amended | "Tag the verified build (e.g. `v0.5-verified`)" becomes `stage5-verified` (the STAGE6-START name, and v0.5 wasn't what was verified; v0.7 was). "Adds … Category stores (if not already stored)" becomes "the Category store already exists". Adds the schema-version guard from Stage 5 finding 6. Milestone order unchanged |
| 17 | **§16 decision log** | Merged | Repo entries (2026-10-18) and proposal entries (2026-10-19, 2026-10-21) interleaved by time. The proposal's undated "2026-10-19 v0.6 draft" row, which sits after the 2026-10-21 rows, is moved into order and renamed "proposal drafted in claude.ai (as 'v0.6 draft')" so it can't be confused with the repo's v0.6. New rows for today's merge |

---

## 3. F-number and section-number collisions

**None.** The repo's v0.6 and v0.7 added no features or sections: count rounds are part of F24, and the Category list and the backup files sit in §3 and §7. The repo ends at F25 and §17. The proposal adds F26, F27, F28, §18 and §19. **No renumbering needed.** §15 also has no clash: the repo uses Q1–Q5, the proposal adds Q6, and the merge adds Q7.

Naming collisions that do need care:
- **"v0.6"**: the proposal's title and every "v0.6" in its text (§2, §13, §14, §15 Q6, §18.7, §19, decision log). In v0.8 they read "v0.8" where they mean the new features and "the proposal" where they mean the claude.ai document. The old text survives only in the decision log, quoted.
- **"v0.5 build"**: the proposal calls the running app "the v0.5 build". It was built to v0.7 (count rounds, `categories.csv`, `manifest.json`). v0.8 says "the v0.7 build".

---

## 4. Data model and Dexie schema

**Current:** `version(1)`, the only version (`src/data/db.ts:49-56`):

```
items:      'id, category, location, barcode, *supplierKeys, lastCounted'
photos:     'itemId'
suppliers:  'key, name'
locations:  'key, order'
categories: 'name, order'
settings:   'key'
```

Item has `lastCounted: string` (YYYY-MM-DD or '') and no `countedBy`. Count rounds use the `countSince` setting (`src/data/count.ts:43`).

**Next: `version(2)`**, added in the milestone that first needs it:

| Store | Change | Milestone |
|---|---|---|
| `categories` | **None.** Already exists with `order` and `subcategories`. The proposal's "(if not already stored)" applies | — |
| `orderLists` (new) | `'id, key, *itemIds'`. One row per list with its `lines: {itemId, qty}[]`; `itemIds` is a derived multi-entry index so deleting an item can find every list it's on (F8, F27) | M5 (F27) |
| `items` | `lastCounted` converted to a date-time; `countedBy: ''` added (not indexed). Index list unchanged | M6 (helpers). It can go into `version(2)` with the order lists if M5 and M6 ship together; otherwise it's `version(3)` |
| `helpers` (new) | `'id, key'` (key = nameKey(name), for the uniqueness check) | M6 |
| `pendingItems` (new) | `'id, helperId, barcode'` | M6 |
| `pendingPhotos` (new) | `'pendingId'`. Kept apart from `photos` so photo counts in `manifest.json` and the restore comparison stay "item photos", and an accepted item's photo moves over with a clear step | M6 |
| `importUndo` (new) | `'id'`. A single row (`'last'`): the previous on_hand, location, barcode, last_counted and counted_by of each changed item, plus the created location names and pending ids. Cleared by the next import or a restore | M6 |

**Helper devices use a separate database** (e.g. `frc2408-helper`), not new tables in `frc2408-inventory`. §18.7 says "a device that already has an inventory database is the main tablet". If helper data lived in the same database, a helper would look like a main tablet after a reload. A separate database also makes **Leave helper mode** a simple `Dexie.delete`, and the main tablet's database can never pick up helper-only rows.

**Migrating existing data** (`version(n).upgrade(tx => …)`), in one transaction:
1. `items.toCollection().modify(i => { if (i.lastCounted && /^\d{4}-\d{2}-\d{2}$/.test(i.lastCounted)) i.lastCounted = localMidnight(i.lastCounted); i.countedBy ??= ''; })`. `localMidnight` writes `YYYY-MM-DDT00:00` plus the device's UTC offset **on that date**, so a CST date gets `-06:00` and a CDT date gets `-05:00`.
2. Nothing else changes. The `countSince` setting stays a date (YYYY-MM-DD), which is what a "since <date>" round means.
3. **Schema-version guard first (Stage 5 finding 6).** Dexie 4 lets an older build open a newer database without an error (probe P4). Before the first `version(2)` ships, store `schemaVersion` in `settings`. On boot, an app whose code is older than the stored value shows a "please reload to update" screen and doesn't write. Without this, a stale service-worker copy of the v0.7 build could write date-only `last_counted` values into an upgraded database. The proposal's helper file versions (`kit.json`, `counts.json`) cover files, not the database.

**Code that reads `last_counted` and must accept date-times** (found by search, for the build plan):
- `src/io/inventory-csv.ts:147`: `date('last_counted', …)` accepts dates only today. It needs to accept date-times, and date-only values from v0.4–v0.7 files (read as local midnight, §7).
- `src/domain/count.ts:15` `isCounted`: text compare. Correct for local-offset values, but switch to an explicit local-date compare and pin it with tests, so it doesn't break if anything ever writes `Z`.
- `src/data/count.ts:28` (`saveCount`) and the add-item path set `lastCounted: today` (a date). These change to `nowLocalIso()`.
- F12's "never counted" banner tests `lastCounted === ''`. Unaffected.

**Upgrade tests:** a fake-IndexedDB test that creates a `version(1)` database with real-shaped rows (a dated `last_counted`, a blank one, photos, categories, settings), opens it with the new `InventoryDb`, and checks every field. Then, as §18.7 asks, a check against a full backup exported from the Tab S8 (restore it into the old build, open with the new one).

**Category remap on existing installs:** the upgrade does **not** remap item categories to the new §11 list. The new list arrives only through the new seed on a fresh "Set up the shop tablet" (the plan in §18.7) or a restore. An upgraded tablet keeps its v0.5 categories and can be changed by hand (F9, F28). This is Claude's default (§15 Q7c): the tablet holds only test data, so a remap migration would be code with no user.

---

## 5. What the proposal would accidentally undo

If the proposal replaced `docs/SPEC.md` as it stands, these repo changes would be lost:

| Repo change | Where the proposal drops it | Kept in v0.8 |
|---|---|---|
| **v0.6 count rounds** ("counting since" date, Start a new count, rounds don't erase anything, F12 banner still uses blank) | F24 is the v0.5 text plus helpers; no rounds | ✅ F24 keeps rounds; helper imports join the round by `counted_at` |
| **v0.7 `manifest.json`** in the full backup and its role in the restore comparison | §7 full-backup list and F15 omit it | ✅ §7 and F15 list it |
| **v0.7 `categories.csv` format** (category position on every row) | §7 defines a different row layout (row 7 above) | ✅ v0.7 format for writing; both read |
| **v0.7 Category table wording** ("order … is the Inventory list order (F1), count-in order (F24) and labels order (§9)"; subcategories unique within a category, case-insensitive) | §3 Category table is shorter and says "categories and subcategories each have their own order" | ✅ v0.7 table, plus the proposal's "Default list on first launch comes from the starter catalog" |
| **v0.7 §7 "Both"**: "The Supplier, Location **and Category** lists are data, not settings" | Proposal drops Category from that sentence | ✅ Kept; order lists and pending items added to it |
| **v0.7 §15 Q3/Q4 closed** (robot questions) | Proposal reopens them with the v0.5 text | ✅ Closed |
| **v0.7 §15 Q2** ("waiting on a team purchase decision, 2026-10-18") | Proposal has the 2026-10-17 text | ✅ Repo text, plus the PDF route from the proposal |
| **v0.6/v0.7 decision-log rows** (2026-10-18) | Missing | ✅ Kept, in order |
| **Q2 first-launch choices** (restore a backup / start empty), built and approved but not yet in the spec | Proposal's F22 rewrite would make the gap permanent | ✅ Written into F22 (row 1b) |

Nothing in the proposal undoes T-01. That changed only code; §2 already asks for persistent storage.

---

## 6. Other things noticed (not part of the merge)

- **No `stage5-verified` tag.** STAGE6-START step 1 asks for `git tag stage5-verified`. There's a commit with that message (`11baab4`) but no tag. §18.7 relies on the tag as the known-good version to go back to.
- **No `docs/stage5-findings.md`.** STAGE6-START step 1 names it. The Stage 5 results are in `docs/history/stage5-review.md`, which doesn't yet mention T-01 as merged or D-01 as deferred.
- **Duplicate mockup folder** in `ba72d61`: `docs/mockups/helper-screens/helper-screens/` repeats `docs/mockups/helper-screens/` (16 files, byte-identical by `diff -rq`).
- **Stage 5 findings 1–9 stay open.** None conflicts with the merge. Finding 2 (category names whose capitals don't match the list) is worth fixing in the categories milestone, since bulk move and the remap touch the same code. Finding 6 is folded into §4 above. Finding 8's other two items (F16 12-hour snooze, §9 layouts in code) aren't written into v0.8; that wasn't part of this step.
- **The helper-screen mockups** show the old category names (STAGE6-START says so). Follow §11.

---

## 7. Decisions Claude made in the draft (need Dan's yes; listed in v0.8 §15 Q7)

- (a) F22: the helper question comes first, then the shop tablet keeps all three setup choices (starter catalog / restore a backup / start empty).
- (b) `categories.csv`: write the v0.7 layout; read both layouts.
- (c) Existing installs aren't remapped to the new categories by the upgrade.
- (d) Restore and the new data: a full ZIP replaces order lists and pending items; a CSV-only restore keeps both, drops order-list lines whose items no longer exist, and clears the import undo.
- (e) Helpers use their own database on the device.
- (f) A schema-version guard ships before the first schema upgrade.
- (g) Imported helper counts join the current count round by their `counted_at` date.
