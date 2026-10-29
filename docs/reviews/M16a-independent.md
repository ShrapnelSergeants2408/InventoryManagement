# M16a independent review: helpers on the main tablet, count kits, schema v3

**Reviewed:** branch `m16a-helpers` at `3af9910` (PR #21), diff `main...m16a-helpers` (main at `197ff26`). Written in a fresh session by a reviewer who took no part in the build. I didn't rely on the builder's [M16a review](M16a.md) and re-checked each of its claims. Requirements: SPEC v0.8 §3 (Item `last_counted` / `counted_by`, Helper), §7, §17, §18.1, §18.2, §18.7, §19 ("last_counted as date-time"), F24; `docs/history/stage6-plan.md` M16a and §3 (version 3 row, guard, testing steps).
**Date:** 2026-10-26, 15:53–16:15 CDT · **Risk: High** (a schema upgrade on the team's real shop tablet).

## How it was done

| What | Result |
|---|---|
| `npx vitest run` | 39 files pass, 1 skipped. **652 tests pass, 1 skipped**, as the builder reports |
| `TABLET_BACKUP="D:\backups\inventory-backup-2026-10-23-1323.zip" npx vitest run tests/tablet-backup.test.ts` | Passes: `129 items, 127 photos, order total 6949.47, 0 counted`. The backup has **no counted items**, so this test converts no dates (see finding 4) |
| `npm run build` | Clean (`tsc --noEmit` + Vite). 16 precache entries, 7,525.58 KiB |
| Are the provided builds the right ones? | Rebuilt `main` (197ff26) myself with `vite build`: `diff -rq` is **identical** to `scratchpad/dist-main`. `dist/` from this branch is **identical** to `scratchpad/dist-m16a` |
| `node scripts/m16a-upgrade-check.mjs <chrome> … <my main build> <dist-m16a>` | **24/24 pass**, no console errors or warnings. Results: blocked screen while another tab holds v2. After it lets go: version 30, four empty stores, all 129 items equal except `lastCounted` and `countedBy`. Every supplier, location, category, order list, photo (128) and setting is byte-equal. Order total ($8,264.75) and round progress are the same. On rollback, main shows "This app is out of date" and writes nothing (two snapshots 3 s apart). Moving forward again works |
| `node scripts/m16a-ui-check.mjs <chrome> <dir>` | **39/39 pass**, no console errors or warnings |
| Regression browser checks on this build: `m3`, `m5`, `m9`, `m15` (the four whose expectations changed) | M3 **50**, M5 **39**, M9 **71**, M15 **40**: all pass, clean consoles (same counts as the builder) |
| Throwaway probe tests (`tests/zz-probe-review.test.ts`, 7 tests, deleted afterwards) | Output quoted as P1–P6 below |
| Read every changed test and check script (`git diff main...m16a-helpers -- tests scripts`) | See "Test changes" |
| Searched all of `src/` for `lastCounted`, `last_counted`, `countedBy`, `isIsoDate`, `formatIsoDate` | See "Anything still assuming a date-only last_counted?" |

I changed no file under `src/`, `tests/`, `scripts/`, `seed/` or `docs/SPEC.md`. My probe file is deleted, and `git status` is clean apart from this review.

## Findings

| # | Severity | Finding |
|---|---|---|
| 1 | **Minor** | The `inventory.csv` taken out of a count kit still restores as a data-only CSV, and that wipes every price |
| 2 | Minor | A helper with a removed group is awkward to fix: the editor hides the stale group but refuses to save until it's gone |
| 3 | Note | `upgradeItemToV3` trusts any `YYYY-MM-DD` text, so an impossible date would shift (unreachable from the app today) |
| 4 | Note | The real-tablet test converts no dates (the backup has 0 counted items), and its expectation uses the code under test |
| 5 | Note | In zones where DST starts at midnight, "local midnight" becomes 01:00. The date is kept, which is correct |
| 6 | Note | Small things: `buildKit`'s `now` isn't used for `created_at`, spreadsheet date-times are refused, and Setup doesn't clear helpers |

None of these puts the upgrade itself at risk.

### 1. Minor: the kit's `inventory.csv` alone restores and wipes every price

`readBackupZip` refuses a ZIP that contains `kit.json` (`src/io/bundle.ts:95-102`). The builder pulled this forward because "a kit restored by mistake would wipe every price". The CSV path doesn't go through that check (`src/io/restore.ts:101-105`), and the kit's `inventory.csv` is a valid §7 file with every price blank.

**Probe P4:**
```
P4 zip false this is a count kit for a helper device, not a backup. Open it on the helper with "Join as a helper"
P4 folder zip false this is a count kit for a helper device, not a backup. …          (re-zipped inside a folder: also refused, good)
P4 kit csv alone ok= true [[[null,""],[null,""],null]]                                 (restore plan: every pack price null, every price_checked blank)
```

**Failure scenario:** someone gets the kit ZIP on the main tablet (for example from Drive) and taps **Extract** in the Android Files app. Then, in More › Backup › Restore, they pick the `inventory.csv` they find there, thinking it's a backup. The data-only restore replaces every item with copies that have no prices and no price-checked dates. The restore comparison and confirmation come first, and a full backup can undo it. But §7 says Restore rejects count kits, and this is the same data loss the ZIP check was added to prevent. It's less likely than restoring the ZIP itself, because it needs an extract step.

**Suggested fix (either one is small):**
- in `planRestore`, warn or refuse when every vendor option in the file has a blank `pack_price` while the tablet has prices ("This looks like a count kit's inventory.csv: it has no prices");
- or have the kit write a marker the CSV reader can detect. §18.2 fixes the file name `inventory.csv`, so a warning is the spec-compatible choice.

### 2. Minor: a helper with a removed group is awkward to fix

If a category or location a helper counts is removed (or a restore brings a different list), the helper card says "No longer in the list: … Edit this helper before sending a kit". **Send** refuses (**P5:** `Error: Edit this helper first: Some categories aren't in the list any more. Choose again.`). That part is right. The edit dialog is where it goes wrong:
- it starts with the stored groups, stale one included (`src/ui/screens/count/Helpers.tsx:189`);
- it only draws checkboxes for groups still in the list (`Helpers.tsx:290`), so the stale group can't be unticked;
- Save hits `checkHelper`'s "Some categories aren't in the list any more. Choose again." (`src/domain/helpers.ts:87-90`, **P5:** `{"ok":false,"errors":{"groups":"Some categories aren't in the list any more. Choose again."}}`), and the message doesn't name the group.

The only way out is the Select all / Clear button (`Helpers.tsx:285-286`). Its label is decided by `chosen.size === choices.length`, and the stale group counts toward `chosen`. Depending on the counts, the user needs one or two taps of a button whose label doesn't describe the problem, and then has to re-tick the groups they wanted.

**Who is affected:** only helpers set up before a category or location was removed. That's likely during the first count, when the categories get tidied.

**Suggested fix:** drop missing groups from the draft when the dialog opens (`groups: e.groups.filter((g) => choices has it)`), and show "Removed from the list: Tools" under the checkboxes. About three lines.

### 3. Note: `upgradeItemToV3` trusts any `YYYY-MM-DD` text

`src/data/db.ts:81-84` converts anything matching `/^\d{4}-\d{2}-\d{2}$/` with `midnightLocalIso`, which uses `new Date(y, m-1, d)` and rolls over impossible dates. **P1:**
```
{"lastCounted":"2026-02-30"} -> {"lastCounted":"2026-03-02T00:00:00-06:00","countedBy":""}
{"lastCounted":"0050-01-01"} -> {"lastCounted":"1950-01-01T00:00:00-06:00","countedBy":""}
```
**This can't happen from the app.** Every path that writes `lastCounted` checks the value first:
- in v1/v2, `saveCount` writes `localIsoDate()`;
- add-item writes today;
- the CSV reader and `validateItem` check `isIsoDate`, which refuses both values.

Other odd shapes are left alone, which is the safe choice (P1, P6):
- `null`, a number or a missing field: left as is;
- a value that is already a date-time with `countedBy: 'Maya'`: left exactly as it was;
- `countedBy: null`: kept (only `undefined` becomes `''`);
- blank: stays blank.

No change needed. If it's touched again, `isCountStamp(v) && v.length === 10` would make the step refuse to invent a date.

### 4. Note: the real-tablet test converts no dates

The test reports `0 counted`, so its new loop (`tests/tablet-backup.test.ts:58-64`) compares 129 blanks. Its expectation also calls `midnightLocalIso`, the function under test. The builder says this openly. The conversion is still well covered elsewhere:
- `schema-upgrade.test.ts` checks a hand-written `EXPECTED` table on both sides of both 2026 DST changes, v1→v3 and v2→v3;
- `m16a-upgrade-check.mjs` works midnight out inside the page without the app's code, over a real Chrome IndexedDB.

What it means for the tablet: the Tab S8 holds only test data (§18.7), so the real upgrade will mostly add `countedBy: ''`. That matches what was tested.

### 5. Note: where DST starts at midnight, "local midnight" is 01:00

**P2** ran every day from 2025 to 2027 in 17 zones, including half-hour, 45-minute and +14:00 zones, Lord Howe's 30-minute DST, and St John's. The test changed `process.env.TZ` inside the probe (confirmed by the January offsets printed below). For each day it checked that the converted value:
- is a valid stored stamp;
- keeps the same date (`countedDate`);
- reads back unchanged through `readCountStamp`;
- names the same instant as local midnight.

The result was **0 problems in 12 zones**. In 5 zones (Santiago, Asunción, Havana, Beirut, Cairo), one day a year has no midnight, and the value is 01:00 that day:
```
America/Santiago jan-offset=-180 … issues=3 2026-09-06:notmidnight:2026-09-06T01:00:00-03:00
America/Havana   jan-offset=-300 … issues=3 2026-03-08:notmidnight:2026-03-08T01:00:00-04:00
```
That's the first moment of the day, the date is unchanged, and count rounds compare dates, so it's correct. Chicago changes at 2 a.m., so it doesn't apply to the team. The other checks showed:
- the "now" stamps in every zone are valid (`+05:45`, `+13:45`, `-09:30`, `-02:30` included);
- `-00:00` and `+00:00` are accepted.

### 6. Note: small things

- `buildKit(db, id, photos, now)` takes `now` but writes `created_at` from a second `nowLocalIso()` call (`src/data/helpers.ts:82`), while the file name uses `now`. They're a few ms apart in real use. Only tests notice, and they use fake timers.
- Spreadsheet-style date-times are refused as row problems, and a row problem stops the whole restore (F18). P3: `"2026-10-24 18:42"`, `"10/24/2026 18:42"`, `"…:07.123-05:00"` and `"…-0500"` all give `null`. The app never writes these forms. If someone opens a v0.8 backup CSV in Excel or Sheets and saves it, these forms could appear, but only if the program reformats the text. I couldn't test that here (no Excel). Worth one try on a real file before the first count. Date-only and `M/D/YYYY` values are accepted exactly as before (P3), so **v0.4–v0.7 backups aren't affected**.
- Helpers aren't cleared by "Set up the shop tablet" (`src/data/setup.ts:25` doesn't list `db.helpers`). Setup only runs on a fresh install or after the data is cleared, so this doesn't matter today.

## Checked and sound

**The v3 upgrade (`src/data/db.ts`)**
- Only two fields change: `lastCounted` (date-only to local midnight) and `countedBy` (added as `''` only when missing). No other item field, table or setting is touched.
- Confirmed three ways:
  - unit: v1→v3 and v2→v3 compare every row field by field;
  - P6: a row that was already v3-shaped (`2026-10-24T18:42:07-05:00`, `Maya`) comes through unchanged, and the `lastCounted` index still works;
  - the browser check: 129 real seed rows, 128 photos and every setting byte-equal.
- Rows from a restore: before the upgrade, a v1/v2 tablet could only hold validated `YYYY-MM-DD` or blank values (finding 3).
- Dexie upgrade v1 → v3 in one step runs v2 (no data step) and then v3; tested.

**Schema guard and blocked upgrade**
- `checkSchema` is unchanged. `main` already has it, so a rolled-back deploy shows "out of date" over v3 and writes nothing. I saw this in the real browser check, not just in the builder's report.
- The blocked path ("Close other tabs of this app", Try again, never "Set up again") works with v3 and was re-run in Chrome.
- A v0.8 backup restored into the v0.7/v2 build is refused, not half-loaded: main's CSV reader sends `last_counted` through `isIsoDate`, which rejects date-times. §18.7 says not to do this anyway.

**Dates (`src/domain/dates.ts`, `validate.ts`, `inventory-csv.ts`)**
- `localIsoDateTime` writes local time with the offset in force at that moment, never `Z`. It's correct on both sides of both DST changes (unit tests, P2).
- `readCountStamp` does the following:
  - a stamp with any offset is kept as written;
  - a date only, or `M/D/YYYY`, becomes local midnight;
  - `Z` becomes local time with the right offset for that instant (P3: `2026-11-01T06:30Z → 01:30-05:00`, `07:30Z → 01:30-06:00`);
  - invalid values are refused.
- The set of `last_counted` values a file may hold is a superset of what v0.7 accepted, so no old backup that restored before fails now (P3, and the unit test of a v0.7-shaped row).
- Round-trip: export → restore keeps date-times and `counted_by` exactly (unit tests; m5 in the browser with `Tablet 2 · Alex & Jordan`).

**Anything still assuming a date-only `last_counted`?** I searched every use in `src/`:
- `isCounted` uses `countedDate`;
- the detail chip and count-in line format `countedDate(...)`;
- `stale.ts` and `inventory-view.ts` only test for `''`;
- `item-form.ts` keeps the base value on edit and writes `countedAt` on add;
- the price import spreads items, so `countedBy` survives;
- the `lastCounted` Dexie index isn't queried anywhere.

None of them still assumes a date-only value.

**Count kit (`src/io/count-kit.ts`)**
- `withoutPrices` blanks only `packPriceCents` and `priceChecked`, which is exactly §18.2. Supplier, part number, URL and pack size stay. The browser check opened a real kit: every price blank, 129 items, 128 photos or none.
- No `order-lists.csv` and no `manifest.json`.
- `photo_file` lists only photos actually in the kit.
- The ZIP is refused by Restore, including when it's re-zipped inside a folder (P4). The loose-CSV case is finding 1.

**Helpers (`src/domain/helpers.ts`, `src/data/helpers.ts`, `src/data/lists.ts`)**
- Names are unique ignoring capitals, both in the rules and through the `&key` index.
- The name is locked after a kit is sent, in both the rules and the data layer.
- Each helper's groups are one kind, in list order.
- The shared-group warning is asked only for groups an edit adds.
- A kit is recorded only after the share sheet or download succeeds, not when the user cancels.
- `followRename` runs inside the same transaction as `renameCategory` and `updateLocation`. **P5:** after `Motors → MOTORS` and `Bin 1 → Shelf A`, the groups were `["Loc",["Shelf A","No location"]]` and `["Cat",["MOTORS","Tools"]]`.
- Removing a category or location doesn't follow, by design. The card flags it and Send refuses (but see finding 2).
- Helpers aren't in backups, and restore doesn't touch the table, which matches §3/§7.

**Screens**
- The Count start screen card and the per-group "Helper: …" work in category and location mode. Scan mode uses category assignments.
- The Helper devices screen has no PIN, and Remove uses the destructive style (§17).
- Touch targets are ≥ 48 px in landscape and portrait, and nothing is wider than the screen (m16a check).

## Test changes (did any get weaker?)

| File | Change | Verdict |
|---|---|---|
| `tests/schema-upgrade.test.ts` | v1→v2 test replaced by v1→v3 and v2→v3 (`describe.each`); rows on both sides of both DST changes; hand-written `EXPECTED`; every other table byte-equal; same round progress before/after; guard now uses a v4 database; blocked test holds v2 | **Stronger.** The v1→v2-only test is gone, but the v2 data step is empty and v1→v3 goes through it |
| `tests/count-times.test.ts` (new) | Writing, reading, refusing, `countedDate`, §19 round cases, CSV in/out, `saveCount` with fake time | Good. Its "same as the old dates" test compares against sliced dates under the *new* `isCounted`, not the old function. That's fine because the old rule was the same text comparison |
| `tests/count-db.test.ts`, `item-form.test.ts`, `inventory-csv.test.ts`, `backup-restore.test.ts`, `helpers.ts` | Date values switched to date-times; `counted_by` added to fixtures and the column list; US date now expects midnight | Same behavior; the round-trip fixtures now also carry a tricky `counted_by` |
| `tests/tablet-backup.test.ts` | v1 rows built date-only without `countedBy`; checks every conversion | Fine, but vacuous on this backup (finding 4) |
| `tests/helper-devices.test.ts` (new) | Rules, data layer, kit contents, Restore refusal, file names | Good. Doesn't cover the stale-group edit (finding 2) or the loose CSV (finding 1) |
| `scripts/m3` | New item: `lastCounted === today` → starts with `today + 'T'`, matches `…[+-]hh:mm`, `countedBy === ''` | Same strength or stronger |
| `scripts/m5` | Fixture writes a date-time + `countedBy` instead of date-only straight into IndexedDB | Correct: v3 never holds date-only. Date-only restore is covered by unit tests |
| `scripts/m9` | Two save checks: `=== today` → starts with `today + 'T'` (one also checks `countedBy === ''`) | Slightly looser on format (no offset regex), but m16a-ui-check checks the full format of a count-in save |
| `scripts/m15` | Schema numbers 20/2 → 30/3; guard set to 4 instead of 3; "back to" 3 | Same behavior at the new version |

I didn't run mutation tests: the rules forbid changing `src/`. The builder reports 27 of 28 compiled mutants caught. From reading the tests, an off-by-one-day or wrong-offset midnight would fail `EXPECTED`, and touching any other field would fail the field-by-field comparison.

## Verdict

**Merge after fixes, or merge with findings 1 and 2 as a follow-up before M16c.** The data-safety core holds:
- the upgrade changes only the two planned fields;
- it's correct across DST and in other zones;
- old backups still restore;
- the guard and the blocked path work in a real browser against a verified build of `main`;
- the kit really has no prices.

Neither finding affects the upgrade or existing data.
- Finding 1 is a small guard against a deliberate-looking but plausible mistake. It's the same harm the builder already blocked for the ZIP.
- Finding 2 is a usability trap that will come up when categories get tidied during the first count.

Both are a few lines. Findings 3–6 need no action. One item to try once on a real machine: open a v0.8 backup CSV in Excel or Sheets, save it, and restore it (finding 6).

**Not checked:**
- the share sheet and a 6 MB kit on the Tab S8 (plan §5);
- Excel or Sheets re-saving a v0.8 CSV;
- a real backup with counted items (none exists);
- mutation testing (not allowed to change `src/`).
