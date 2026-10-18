# M5 independent review — Backup, restore, share, price import

**Reviewed:** M5 as merged (`fc2057d`, `e5ae0f2`, `1f0f4c6`; diff `48e6a33..cf9b665`) and the current code on `m6-pin-settings`. Written in a fresh session, as the earlier [M5 review](M5.md) and stage4-plan §4 recommended. The earlier review was not trusted. Requirements: SPEC v0.5 F15–F18, §2, §7 and §10, plus spec-questions Q1, Q3, Q4, Q5, Q8, Q10 and D7.
**Date:** 2026-10-18, 10:33–11:55 CDT · **Risk: High** (a restore or price import can wipe or corrupt weeks of counts).

## How it was done

| What | Result |
|---|---|
| `npm test` before any change | 25 files, 339 tests, all pass |
| `npm run build` | Clean |
| `scripts/m5-ui-check.mjs` before any change | 37/37, twice, with no console errors |
| A separate senior reviewer read the code against the SPEC in its own git worktree, and wrote tests to prove each finding | 8 tests (`tests/review-m5.test.ts`); 6 findings confirmed, 5 plausible |
| The Director re-ran the reviewer's tests on the main checkout and read the code for each finding | Each confirmed finding reproduced |

## Findings

| # | Severity | Finding | Outcome |
|---|---|---|---|
| 1 | **Medium-high** | **Re-importing an old data-only export undoes vendor edits.** §10's workflow gives Claude the whole data-only export. That file has every vendor cell filled, so "blank = leave unchanged" never applies. A part number fixed after the export is put back, and a vendor option deleted since is re-created. Counts were safe, but nothing showed the vendor changes before they were written. | **Fixed.** A preview opens before the PIN and lists every field that will change, item by item, as "before → after". Anything other than a pack price or price-checked date is marked "!", and so is a new vendor option. A red note explains that an older export may undo vendor edits. Cancel changes nothing and asks no PIN; "Import changes" asks the PIN and applies exactly what was listed. |
| 2 | Low-medium | **A `v01_pack_price` header** was accepted, then its values were silently dropped: `Number("01")` is 1, but the cells were looked up as `v1_…`. F18 says an unknown column is an error. | **Fixed.** A slot number must be written exactly `1`, `2` or `3`, otherwise "column … isn't recognized". |
| 3 | Low | A **`.csv` inside a ZIP** is decoded as UTF-8 only. The Windows-1252 fallback (M5 finding 5) covers loose CSV files. | Open. Test `open: Windows-1252 inventory.csv inside a ZIP…` records the behaviour. |
| 4 | Low | **Restore doesn't normalize URLs**; it accepts `javascript:alert(1)`. Not exploitable, because `safeHref` guards both places a link is shown. But the editor then refuses to save that item until the link is fixed. | Open. Test `open: restore accepts a vendor url…`. |
| 5 | Low | A **blank first line** in a CSV gives "Row 1: missing column: id", though the header is on row 2. | Open. Test `open: a blank first line…`. |
| 6 | Low | A **backup stamped in the future** (clock ahead, then corrected) keeps the reminder off until the clock catches up. A future snooze time does the same. | Open. Test `open: clock moved backwards…`. |

**Plausible, not demonstrated (open):**
- No size limit on a restore file. Photos are accepted by file extension only, not by content.
- No formula escaping (`=`, `+`, `-`, `@`) in exported CSVs. Adding it would change round-trip values.
- `lastChangeAt` is set to the restore time.
- If a vendor slot is replaced between the file check and the write (only while the PIN pad is open), the change lands on the new vendor in that slot.
- A CSV without a `source` column restores starter items as `team`.

**Checked and sound:**
- Restore is one `rw` transaction, and the PIN and settings are untouched.
- Every PIN check sits after the file check and before the write.
- Duplicate ids, missing columns and path-traversal ZIP names are handled.
- Error row numbers are correct with quoted multi-line cells.
- Price import can't change on hand, desired, spares, last counted or the preferred vendor, and can't remove a vendor option.
- Odd ids, 50,000-character notes, a lone CR, a tab, a leading `=`, a part number `0012` and a price of 0 versus no price all round-trip exactly.
- The starter catalog, exported data-only and re-imported unchanged, gives zero changes.

## Fixes and their evidence

| Fix | Unit tests | Browser (`scripts/m5-ui-check.mjs`) |
|---|---|---|
| Price preview (finding 1) | `finding 1: an OLD data-only export…`: the preview lists `part # NEW-1 → OLD-1`, `pack price $10.00 → $12.00` and option 2 as new, with `detailChanges` 2. `finding 1: a price-only file shows no detail changes` | **price preview before the PIN**: two items listed, the supplier change flagged, no PIN yet. **preview Cancel**: nothing changed, no PIN asked. The existing summary checks then run through "Import changes" |
| `v01_` headers (finding 2) | `finding 2: a zero-padded slot header…` (`v01_`, `v001_`, `v03_`) | — |

The M6 browser check's gate matrix now reaches the price-import PIN through the preview ("Import changes").

Screenshot `05a-price-preview` was checked: the warning, the "!" flags and the PIN mark on "Import changes" all show.

## Mutation check of the fixes

A third agent, separate from the one that wrote the fixes, undid each fix in turn. After each one it ran the tests and the browser check, then restored the file from a saved copy.

| Mutant | Caught? |
|---|---|
| Backup imports straight after the PIN, without the preview | ✅ m5 browser check ("no dialog Check the price update") |
| `detailChanges` always 0 | ✅ unit (`finding 1`) and m5 browser check (warning missing) |
| `v01_` check removed | ✅ unit (`finding 2`) |

The verifier's code review found no bugs in the fixes. The preview and the import are built from the same `updates` and `applySlot`, and `fieldChanges` compares the same six fields as `sameVendor`. So the preview lists exactly what the import writes. A new supplier is listed only when an applied update uses it. "Import changes" can't run twice: an `importing` flag guards it, and the button is disabled while busy.

## Remaining uncertainty

- **Open, low:** findings 3–6 and the plausible items above.
- **By design:** the preview warns but doesn't block. A mentor who wants to restore the old vendor details can still import them. The most reliable protection is still to use a fresh data-only export for each price refresh (§10).
- **Stage 5:** the preview's length on the Tab S8. The list scrolls after about 340 px and shows up to 40 items, then "… and n more items".
