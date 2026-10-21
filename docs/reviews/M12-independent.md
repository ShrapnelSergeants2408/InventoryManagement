# M12 independent review — Categories (§11), the new seed, `categories.csv`, Stage 5 finding 2

**Reviewed:** branch `m12-categories` at `58a9e1a` (PR #16), diff `main...m12-categories`. Written in a fresh session by a reviewer who took no part in the build. The builder's [M12 review](M12.md) was not trusted; each claim was re-checked. Requirements: SPEC v0.8 §7 (`categories.csv`), §11, §12, F9, F22, §15 Q7b/Q7c, §19 "Categories"; `docs/stage6-plan.md` M12; Stage 5 review finding 2 (probe P1).
**Date:** 2026-10-21, 14:30–14:55 CDT · **Risk: High** (the data every later milestone builds on).

## How it was done

| What | Result |
|---|---|
| `npx vitest run` | 33 files, 520 tests, all pass |
| `npm run build` | Clean (`tsc --noEmit` + Vite). 16 precache entries, 7,464 KiB |
| `node scripts/m12-ui-check.mjs <chrome> <dir>` | **13/13 pass**, no console errors or warnings |
| Regression browser checks re-run on the new seed: `m2`, `m3`, `m8`, `m9` (the ones whose category names changed most) | M2 **28**, M3 **50**, M8 **61**, M9 **71**; all pass, clean consoles. Same counts as the builder reports |
| Seed comparison script (Papa Parse, outside the repo): new seed vs the `stage5-verified` 2026-10-17 seed vs `seed/category-mapping-2026-10-21.csv` | See "Seed data" below |
| Throwaway probe tests (`tests/zz-probe-review.test.ts`, 7 tests, deleted afterwards) | Output quoted per finding as P1–P7 |
| Read every changed test and browser check (`git diff main...m12-categories -- tests scripts`) | See "Test changes" below |

No file under `src/`, `tests/`, `scripts/`, `seed/` or `docs/SPEC.md` was changed.

## Findings

| # | Severity | Finding |
|---|---|---|
| 1 | **Minor (upper end)** | The item editor still refuses to save an item stored with other capitals before the fix |
| 2 | Minor | Rows stored before the fix still split off in the Inventory list, filters, labels and count-in |
| 3 | Minor | A case-only duplicate subcategory left by the old code can be renamed into an exact duplicate; its items then show twice |
| 4 | Note | Restore-plan comment is stale; the only ZIP test for "no `categories.csv` keeps the tablet's list" was rewritten |
| 5 | Note | `categories.csv` silently merges names that differ only in capitals |
| 6 | Note | Ten seed placements are flagged "check" in the mapping file; worth Dan's glance |

### 1. Minor (upper end): the editor still refuses to save an item stored before the fix

M12.md says, for finding 2: "an item already stored as `pneumatics`/`valves` … saves a notes edit". That holds only for the data layer (`updateItem` → `fitToLists`, `src/data/items.ts:24-36`). The editor screen checks the draft first, and that check still compares exactly:
- `buildItem`: `ctx.categories.find((c) => c.name === d.category)` → error "Choose a category" (`src/domain/item-form.ts:152-153`);
- the editor's own lookup for the subcategory list (`src/ui/screens/item/Editor.tsx:128`), and the category `<select>` (`Editor.tsx:268-274`) has no option for `pneumatics`, so the browser shows the first category (Electrical) while the draft still holds `pneumatics`.

So on a tablet holding such a row, a student who edits only the notes gets "Choose a category." under a field that appears to say Electrical. Re-picking the category clears the subcategory (`Editor.tsx:268`). This is the Stage 5 "Edits refused" bullet, still present in the UI.

**Probe P1:** `buildItem(draftFromItem(item{category:'pneumatics', subcategory:'valves'}), {categories: [Pneumatics, Motors], …})` → `[{"field":"category","message":"Choose a category."}]`.

**Who is affected:** only rows written by the old code (a hand-edited CSV restored before this build). New restores and the seed now respell names, so no new mismatched rows are created. The real tablet keeps its old data until the fresh start (§15 Q7c).

**Steps to reproduce (old data):** on `main`, restore a data-only CSV with one item's category changed to `motors`. Switch to this build. Open that item → Edit → change Notes → Save. You get "Choose a category."

**Suggested fix:** in `draftFromItem` (or at the top of `buildItem` and in `Editor.tsx:128`), match the category with `nameKey` and use the list's spelling. Do the same for the subcategory, so `subOptions` doesn't list `valves` beside `Valves`. Add a `buildItem` unit test using the `lc` item from `edits-db.test.ts`. It's about three lines of code, and the M12 review row should then say what is really covered.

### 2. Minor: rows stored before the fix still split off in the list, filters, labels and count-in

`itemsIn` now ignores capitals, but the screens that group items still compare exactly:
- Inventory list: `src/domain/inventory-view.ts:96-103`, `124-125`, `149`, `167-168`;
- filter: `src/domain/filters.ts:41`;
- labels: `src/domain/labels.ts:209-215`;
- count by category: `src/domain/count.ts:63`.

**Probe P2** (lists Pneumatics/Motors, location Bin 1; one item `Pneumatics/Valves/Bin 1`, one stored as `pneumatics/valves/bin 1`):
- Inventory headers: `[["Pneumatics",1],["Motors",0],["pneumatics",1]]`, so a second "pneumatics" header appears;
- the filter on Pneumatics doesn't show the old row;
- labels by category `[["Pneumatics",1],["pneumatics",1]]`; count by category, the same;
- labels by location `[["Bin 1",1],["No location",1]]`, but count by location `[["Bin 1",2]]`. This is still the Stage 5 "walk orders disagree" bullet.

M12 also adds a new disagreement for these rows. More › Categories counts with `itemsIn` and now says Pneumatics has 2 items, while the Inventory header says 1.

Rename and remove now do the right thing (**P3**). A case-only rename `Pneumatics → PNEUMATICS` moves both rows. A subcategory rename moves both. Removing the subcategory counts 2 and moves both. After any rename or move the rows are respelled, and the split disappears.

**Workaround that exists today:** More › Backup (full) and then restore that file. The restore now respells every row (`src/io/restore.ts:69`).

**Suggested fix (pick one):** (a) a one-time pass at app start that runs `spellLikeLists` over stored items and saves the ones that change. It's cheap, idempotent, and closes findings 1–3 for old data in one place. Or (b) switch the four groupers to `nameKey`. Or (c) accept it and add one line to the tablet notes: "if a second header with odd capitals shows up, back up and restore".

### 3. Minor: an old case-only duplicate subcategory can be renamed into an exact duplicate

The old `fitToLists` could add `brushless` next to `Brushless` (Stage 5 finding 2, "Duplicate subcategories"). On such a list:
- `renameSubcategory('Motors', 'brushless', 'Brushless')` is allowed. `checkName` skips every name with the same key as `self`, not just `self` itself (`src/domain/lists.ts:14-24`). The list becomes `["Brushless","Brushless"]`.
- The Inventory list then shows the subcategory, and each of its items, twice (**P4**: `category Motors 2, subcategory Brushless 2, item a, item b, subcategory Brushless 2, item a, item b`).
- Because `itemsIn` now ignores capitals, removing the stray `brushless` reports "still holds 2 items" (both spellings). Moving them to `Brushless` and removing does work.

The `checkName` logic is older than M12, and the case is reachable only with old data. An edit with both spellings listed respells to the first one, `Brushless` (P4), which is correct.

**Suggested fix:** in `checkName`, exclude only the entry being renamed (by index or exact name). Then a rename onto a different entry with the same key is refused. Or let `renameSubcategory` merge into the existing entry. Fix 2(a) would also respell the items, though not the list.

### 4. Note: stale comment and lost ZIP coverage

- `src/io/restore.ts:47` still says a list file missing from the backup applies to "the starter catalog". Since M12 the starter catalog has `categories.csv` and replaces the category list (M12.md finding 1). Update the comment.
- `tests/backup-restore.test.ts` "the starter catalog restores…" was the only test where a **ZIP** without `categories.csv` keeps the tablet's categories. It now checks the opposite, which is correct for the new seed. The keep-list rule is still tested through the CSV path, which goes through the same `planRestore`. A small ZIP case (a full backup with `categories.csv` removed) would bring back the ZIP-specific coverage of `bundle.ts:113-116`.
- For reference, from **P6**: restoring the old 2026-10-17 seed ZIP onto a §11 tablet keeps the 11 categories and appends the 10 old names the items use (Structure, Motion, …, Pit & Safety). That's 21 categories. A v0.7 full backup restores its own old 12-category list exactly. Both follow Q5. That's the expected way an old backup comes back after the fresh start, and Dan should know it.
- `SEED_FILE` is unused, and `docs/START-HERE.md` names the old seed; the builder already noted both.

### 5. Note: `categories.csv` merges names that differ only in capitals, silently

`Motors,,0` + `MOTORS,Brushless,1` parses to a single `Motors` with `Brushless`, with no problem reported. The same happens for `Brushless`/`BRUSHLESS` subcategories (**P5**). That fits §3 (names are unique ignoring capitals), and items are then respelled to the first spelling. A warning in the restore summary would help someone who hand-edited the file. Not required by the spec.

### 6. Note: seed placements flagged "check"

`seed/category-mapping-2026-10-21.csv` has 10 rows with a `check` note: st-0010, 0049, 0052, 0054, 0060, 0061, 0069, 0097, 0115 and 0116. Examples:
- electrical tape is in Misc;
- Dual Lock is in Fasteners with no subcategory;
- the forks kit is in Mechanical › Chassis.

Each is a reasonable call, and all of them follow §11's placement rules. The PDH, Mini Power Module, Pneumatic Hub, radio and gamepad are in Electrical › Control System, and the swerve module is in Assemblies. They are judgment calls Dan hasn't seen one by one. This is not a code issue.

## Checked and sound

- **`spellLikeLists`** (`src/io/lists-csv.ts:181-196`):
  - a subcategory is looked up only within the item's own category (P5: `tools/motors` stays `motors`; Electrical › Motors isn't borrowed);
  - blank names stay blank;
  - unchanged items keep their identity;
  - it runs after `complete*`, so every name has a list entry.
- **Restore** respells items against the lists it is about to write, whether those came from the file or from the tablet (`restore.ts:58-69`). The builder's test restores `motors`, `FASTENERS/nuts` and `bin f3` as `Motors`, `Fasteners/Nuts` and `Bin F3`, with no duplicate list entries.
- **`fitToLists`** finds the category ignoring capitals and takes the list's spelling of the category and subcategory. It no longer adds `valves` next to `Valves`. P7: an old `pneumatics/valves/bin 1` row saves as `Pneumatics/Valves/Bin 1` through `updateItem`.
- **`itemsIn` with `nameKey`:**
  - `removeCategory` and `removeSubcategory` now count old rows, so the F9 guard holds (the builder's test and P3);
  - `moveItems` respells to the target, and its "already there" filter is exact, so old rows are always rewritten;
  - `renameCategoryItems` and `renameSubcategoryItems` return early only on an exact `from === to`, so a case-only rename (`Pneumatics → PNEUMATICS`) moves every row (P3);
  - two categories can't differ only in capitals (`checkName`, the `categories.csv` parse and `completeCategories` all use `nameKey`), so the wider match can't pull in another category's items;
  - subcategory matches are always within one category.
- **Seed loader** (`src/io/seed.ts`): the lists are built first, then the items are respelled. Locations stay empty, and `other` is added.
- **Setup** imports the 2026-10-21 ZIP. Start empty takes its categories from the same seed (unit and browser checks).

## Seed data (§11, §12)

| Check | Result |
|---|---|
| `categories.csv` in the seed vs the SPEC §11 table (parsed from `docs/SPEC.md`) | **Identical**: 11 categories in order, all 58 subcategories in order, `—` rows empty (P6) |
| Items, vendor options, photos, order total (`readSeed` → `buildOrderList`) | **129, 168, 128, $8,413.66**; no warnings (P6). Independently from the raw CSV: 168 vendors, 128 `photo_file`, $8,413.66 |
| Every item in a listed category and subcategory | **Yes**: 0 of 129 outside the list. Blank subcategories: 1 in Assemblies, 1 in Fasteners, 3 in Misc |
| New `inventory.csv` vs the 2026-10-17 seed | Same 129 ids and same headers. **0 cells differ** outside `category` and `subcategory` |
| New `inventory.csv` vs `category-mapping-2026-10-21.csv` | All 129 rows match: `old_*` = the old seed, `new_*` = the new seed, names equal. No extra or missing ids |
| Categories with items | 9 (Public Relations and Programming are empty), which matches M8's 9 label groups |

## `categories.csv` (§7)

- **Seed layout** (blank-subcategory row carrying the category position, then subcategory rows numbered by subcategory position): parses to §11. The parser takes a category's position from its first row only. Unit test "a later row of the seed layout never moves its category" pins this.
  - One caveat, not a bug: per the §7 wording, a category whose *first* row is a subcategory row takes that row's number as its position. P5: `A,,1 / B,X,3 / C,,2` → A, C, B. The new seed always has the blank row first.
- **v0.7 layout:** still written; the first lines of a backup are `category,subcategory,order` / `Electrical,Control System,0` / `Electrical,Sensors,0`. It reads back to the same list.
- **Round trip:** seed → database → full backup → restore onto a tablet with other categories gives exactly the original list, including empty categories and empty subcategories (P6).
- **v0.7 backup on a §11 tablet:** the backup's 12 old categories replace the list exactly (P6, Q5).

## Test changes (did any get weaker?)

| File | Change | Verdict |
|---|---|---|
| `tests/seed.test.ts` | Old 12-name list → `SPEC_CATEGORIES`; adds order 0–10, two full subcategory lists, the 58 total, empty groups kept, every item listed | **Stronger** |
| `tests/setup.test.ts` | Inline 12 names → `SPEC_CATEGORIES`; Start empty now also asserts the names | Same or stronger |
| `tests/inventory-view.test.ts` | 12 → 11 headers; the sum-to-129 and short-124 checks are kept | Same behavior |
| `tests/backup-restore.test.ts` | Seed restore: "tablet categories kept" → "§11 list replaces" | Correct for the new seed, but see finding 4 (ZIP keep-list coverage) |
| `tests/backup-restore.test.ts`, `edits-db.test.ts`, `lists-csv.test.ts` | New: case-mismatch restore, old-row remove/edit/rename, both layouts, `spellLikeLists` | New coverage; good |
| `scripts/m2` | Bolts & Screws → Screws; filter Motors → Electrical; 12 → 11 | Same behavior |
| `scripts/m3` | Detail via Electrical › Motors (subtitle now includes the subcategory, which is correct); add item to Mechanical; new sub "Relays" (Mechanical already has Spacers); remove Solenoids → Accumulation; rename Assemblies (1 item, was 4) | Same behavior. The rename moves 1 item instead of 4, still enough to show items follow; the "0 left / n moved" assertion is kept |
| `scripts/m7` | Control System & Sensors › Controller & Radio → Electrical › Control System (st-0099 is there per the mapping) | Same |
| `scripts/m8` | 12 → 9 groups; selection = Power Transfer (17) + 2 NEO motors = 19 (was Fasteners 16 + 3), so every later sheet, page and print number is unchanged; "3 labels" → "2 labels" in the clear-a-category check | Same behavior; the item pick is now by name instead of "first 3 rows", which is sturdier |
| `scripts/m9` | `st-0001` → the first walk item read from the data (`expectFirst`, already used throughout the file); "Item 1 of 12" → `Item 1 of ${n}` | Same behavior; less tied to the seed |
| `scripts/m4`, `m5`, `m6`, `m10` | `>= 12` waits → `>= 11`; M10 "12 categories" → 11 | Same |

No check was removed and no assertion was loosened to an always-true form. The cosmetic leftover `motorsShort` (m2) now holds the Electrical count.

## M12 acceptance criteria

| Criterion | Holds? | Evidence |
|---|---|---|
| First launch loads the 2026-10-21 seed: 11 categories in §11 order, empty ones included | ✅ | m12 check (Inventory headers, Categories screen, IndexedDB 0–10); P6 matches the SPEC table exactly |
| Still 129 items, 168 vendor options, 128 photos, $8,413.66 | ✅ | P6; raw-CSV script; m12 "129 items · 124 short" |
| Every item in a listed category and subcategory | ✅ | Script (0 outside), `seed.test.ts`, m12 IndexedDB check |
| Start empty gets the §11 list | ✅ | m12 second launch (0 items, 11 categories, 58 subcategories); `setup.test.ts` |
| `categories.csv` in both layouts loads with the right order | ✅ | `lists-csv.test.ts` and P5/P6 (see the first-row caveat above) |
| Backups keep writing the v0.7 layout | ✅ | P6 first lines; the pinned test |
| Backup without `categories.csv` rebuilds from items; round trip keeps empty groups and order | ✅ | Existing CSV tests; P6 round trip (ZIP-specific test lost, finding 4) |
| Finding 2: restore and seed respell to the lists | ✅ | Builder's restore test; code read |
| Finding 2: `itemsIn` and the subcategory check use `nameKey` | ✅ | P3, P7, `edits-db.test.ts` |
| Finding 2 for rows already stored by the old code | ⚠️ Partly | Remove, rename and the data-layer edit work. The **editor UI still refuses** (finding 1), and the list, filters, labels and count still split such rows (finding 2) |
| Existing installs keep their categories (Q7c) | ✅ | No schema change or migration |

## Verdict

**Merge after one small fix.** The seed, the §11 list, `categories.csv` and the restore-time respelling are correct and well tested. The browser checks and unit tests pass, and no test was weakened. The one gap that contradicts the milestone's own claim is finding 1: for an item already stored with other capitals, the editor still says "Choose a category". A `nameKey` match in `draftFromItem`/`buildItem` plus a unit test closes it. Findings 2 and 3 affect only data written by the old code and have a workaround (full backup → restore). They can go in this PR as the startup respell (2a) or be logged for later. Findings 4–6 are notes.
