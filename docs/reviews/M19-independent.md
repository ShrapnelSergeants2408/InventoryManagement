# M19 independent review: placed orders, receiving, on order, schema v4

**Reviewed:** branch `m19-details-confirmed` at `b5ca7eb` (PR #31). Diff `30cff18...m19-details-confirmed`: the M19 code (`ee0b59c`, `d627152`, merged as PR #30) plus the follow-up that gives typed lines their own pack size and unit (`b5ca7eb`). Written in a fresh session by a reviewer who took no part in the build. I didn't rely on the builder's [M19 review](M19.md) and re-checked its claims.
Requirements: SPEC v0.14 §3 (Placed order, Order line), §4 on order, F2, F12, F27, F30, F31, §6, §21.1–§21.4, §21.6, §22; `docs/history/stage6-plan.md` M19 and §3.
**Date:** 2026-10-29, 07:58–08:20 CDT · **Risk: High** (receiving changes real on-hand counts; a schema upgrade on the team's real tablet; money).

## How it was done

| What | Result |
|---|---|
| `npx vitest run` | 45 files pass, 1 skipped. **854 tests pass, 1 skipped** (the builder's 853 plus the 1 added in `b5ca7eb`) |
| `npx tsc --noEmit` | Clean |
| `npm run build` | Clean. 16 precache entries, 7,677.65 KiB |
| `TABLET_BACKUP="D:\backups\inventory-backup-2026-10-23-1323.zip" npx vitest run tests/tablet-backup.test.ts` | Passes (1 test) |
| Old build for the upgrade check | `git archive 30cff18` into my scratchpad, its own `npm ci`, `npx vite build`. No worktree, no junction. The repo's `node_modules` wasn't touched |
| `node scripts/m19-upgrade-check.mjs <chrome> … <30cff18 dist> <this dist> <tablet backup.zip>` | **22/22 pass**, no console errors or warnings. The tablet backup restored on 30cff18 (v3, version 30). Blocked while another tab holds the database ("Close other tabs of this app", Try again, never "Set up again"). Then version 40 with empty orders and receipts stores and schemaVersion 4. All 129 items, 9 suppliers, 3 locations, 12 categories, the order list and 127 photos byte-equal; settings unchanged apart from schemaVersion; order total $6,949.47 unchanged. Rolled back to 30cff18: "This app is out of date" with Reload, nothing written (two snapshots 3 s apart). Forward again: the order saved on v4 is there |
| `node scripts/m19-ui-check.mjs <chrome> <dir>` | **37/37 pass**, no console errors or warnings |
| Regression: `m5`, `m15`, `m15b`, `m3` | M5 **39**, M15b **26**, M3 **50**: all pass, clean consoles. M15 **37 pass, then `ERROR timeout`**: its schema-guard section never ran (finding 4) |
| Screenshots read | The order form (landscape and portrait), the automatic list after recording, the order page (landscape and portrait), the receive confirmation |
| Throwaway probe tests (`tests/zz-probe-review.test.ts`, 9 tests, deleted afterwards) | Output quoted as P1–P9 below |
| Read every changed source file, test and check script | See "Checked and sound" and "Test changes" |

I changed no file under `src/`, `tests/`, `scripts/`, `seed/` or `docs/SPEC.md`. My probe file is deleted, and `git status` is clean apart from this review.

## Findings

| # | Severity | Finding |
|---|---|---|
| 1 | **Minor** | The Receive confirmation counts lines for **deleted items** as "added to on hand". The save is right; the message isn't |
| 2 | **Minor** | If saving a receipt fails after the order is recorded, the form stays open, and tapping Record again makes a **second order** |
| 3 | **Minor** | **Undo this import** after a receive silently takes the received units back off on hand |
| 4 | **Minor** | The `m15` browser check stops early (its schema-guard test still uses 4 as "newer"). The builder's "M15 37, all pass" hides this |
| 5 | Minor | The Cancel and Remove-receipt confirmations stay usable after mentor tools relock |
| 6 | Minor | A backup whose `orders.csv` names the same receipt twice passes the check but fails at **Replace everything** with a raw database error |
| 7 | Note | Portrait order page: the line numbers have no labels |
| 8 | Note | Small things: future dates, a $0 line price offered to the catalog, the `line` column, >5 receipts, PDF viewing on Android, no v4 row in stage6-plan §3, the helper upgrade tested only in fake IndexedDB |

None of these puts the v3 → v4 upgrade or existing data at risk. Findings 1–3 are about receiving and on-hand numbers, so I'd fix 1 and 2 before the first real order.

### 1. Minor: the Receive confirmation counts deleted items as added

`src/ui/screens/order/Placed.tsx:362-363` builds the confirmation from every line with an item id:
```ts
const toStock = order.lines.filter((l, i) => l.itemId !== '' && amounts[i]! > 0);
const units = toStock.reduce((n, l) => n + amounts[order.lines.indexOf(l)]!, 0);
```
A line whose item was deleted still has its item id. So the heading (line 379), the bullet (line 384, "+25 each on hand") and the button ("Add 25 to on hand") all count it. The data layer is right: `receiveOrder` skips items that are gone (`src/data/placed-orders.ts:150-151`). **P3** shows it: with item `b` deleted, receiving 10 of `b` added nothing, and the result was `items 1, units 3` (only item `a`).

The order page already knows which items are gone (`gone`, `Placed.tsx:261`). The dialog doesn't use it.

**Failure scenario:** someone deletes "Bolt" (it's on an open order). The parts arrive. Receive says "Add 25 to on hand for 1 item?". They confirm, and the toast says "Marked as received." A student may then think the 25 went somewhere, or add them by hand to the wrong item. F31 says these lines are "marked received without changing inventory", and the confirmation should say exactly that.

**Suggested fix:** pass the set of item ids that still exist to `ReceiveDialog`, and treat a line whose item is gone like a typed line ("25 received (item deleted, no inventory change)"). About five lines.

### 2. Minor: a failed receipt save, then Record again, makes a second order

`save()` in `src/ui/screens/order/OrderForm.tsx:156-158` records the order (one transaction), then adds each receipt in **its own** transaction. If a receipt write fails, the `catch` (line 163) shows the error and leaves the form open on the same data. The **Record order** button is enabled again. Tapping it runs `recordOrder` again.

**P9** (a receipt write made to fail with `QuotaExceededError`, then Record again):
```
P9 addReceipt threw QuotaExceededError
P9 orders after retry 2 on order a 2
```
Two orders for one purchase. On order is doubled, so the Automatic list under-orders that item. The spending total (M20) would count the money twice. A named list also loses its lines on the first save, so the second save can't put them back.

**How likely:** low. A receipt write fails only when storage is full or the browser drops the database. The tablet has plenty of space. But the cost is silent and only shows up later as wrong numbers.

**Suggested fix (either):**
- once `recordOrder` has succeeded, never return to the form: move on to the price step and show "The order is saved, but a receipt couldn't be: add it on the order page";
- or add the receipts inside the same transaction as the order.

### 3. Minor: Undo this import after a receive takes the received units away

`undoImport` (`src/data/import-counts.ts:145-149`) writes back each changed item's **old on hand**, whatever happened since. Receiving now changes on hand too.

**P5:** an import set item `a` from 1 to 5. Then 4 arrived and were received (on hand 9). Then **Undo this import**:
```
P5 a onHand after import 5, receive +4 = 9 ; after Undo this import = 1 ; order says received 4
```
The 4 received units are gone from on hand, but the order says they were received, so they also no longer count as on order. Nothing on screen says so.

This isn't new in M19. Undo already overwrote a manual +/− made after an import (§18.5 says it "puts them all back"). M19 makes it more likely, because Undo stays available until the next import or restore, and receiving is a normal step a few days after a count.

**Suggested fix:** in the Undo confirmation, list items whose on hand changed since the import ("3 items were changed after the import, e.g. by receiving; Undo sets them back to before the import"). Or skip those items. This needs Dan to choose, so I'd note it for M20 rather than block on it.

### 4. Minor: the m15 browser check stops early, and the builder's count hides it

`scripts/m15-ui-check.mjs:256-258` tests the schema guard by writing `schemaVersion: 4` and waiting for the "out of date" screen. Since M19, 4 **is** the current version, so that screen never comes:
```
PASS  portrait inventory row: ⋮ ≥ 48 px, nothing wider than the screen: [[],true]
ERROR timeout waiting for document.querySelector('.state h2')
No console errors or warnings
```
The script then exits with code 0 (line 276), so it looks like a pass. M15 had **40** checks at M16a (M16a independent review). It now shows **37**: the three guard checks are lost. The builder's review lists "M15 37 … all pass" and updated the version numbers at the top of this same script (line 113) but not this section.

**What it means for the tablet:** the guard itself still works. I saw it in the real browser: the M19 upgrade check's rollback step ("This app is out of date — reload to update", nothing written). `schema-upgrade.test.ts` also checks it with version 5. So this is a gap in the evidence, not in the app.

**Suggested fix:** use `SCHEMA_VERSION + 1` (5) and back to 4 at lines 256 and 263. Better, make every check script exit non-zero when it records an `ERROR`, so a broken check can't read as a pass.

### 5. Minor: Cancel and Remove receipt don't follow a relock

The order page asks for the PIN, then opens the Cancel or Remove-receipt confirmation (`Placed.tsx:238`, `:333`). The confirm buttons (`:464`, `:544`) save without checking the lock again, and neither dialog closes on relock. Other PIN dialogs do close (`useCloseOnRelock` in `DeleteItem.tsx`, `Suppliers.tsx`, `Categories.tsx`, `Locations.tsx`). In this milestone, **Delete order** re-asks (`:506`) and so does the order form's Save.

**Failure scenario:** a mentor opens "Remove receipt 2?" and walks away. Five minutes later mentor tools relock. A student taps **Remove**, and the receipt is deleted with no PIN. A cancel can be undone, but a removed receipt can't (only from a backup).

**Suggested fix:** `useCloseOnRelock(true, onClose)` in `CancelDialog` and `RemoveReceiptDialog`, as the other PIN dialogs do.

### 6. Minor: a duplicate receipt name passes the check and then fails at restore

`parseOrdersCsv` (`src/io/orders-csv.ts:158-168`) doesn't check that a receipt name is used once. Two orders naming `receipts/x.jpg` read without a problem. Then `replaceOrders` does `bulkAdd` with the same id twice.

**P6:**
```
P6 dup receipt parse problems [] receipts [["x"],["x"],["a","b","c","d","e","f"]]
P6 restore read ok true
P6 restore threw: BulkError receipts.bulkAdd(): 1 of 8 operations failed. Errors: ConstraintError: …
P6 tablet after failed restore: orders kept?
```
The good part: the transaction rolls back, and the tablet keeps its own orders ("kept?" is the tablet's order). The bad part: the confirmation already said the restore was fine, and the user sees a raw database message after ticking "I understand" and tapping **Replace everything**.

The app never writes such a file (ids are `<order>-<n>`), so this needs a hand-edited or damaged backup. P6 also shows 6 receipts on one order are accepted (the limit is 5). That's harmless: adding a 7th is refused.

**Suggested fix:** in `parseOrdersCsv`, report "receipt x is named by two orders" as a row problem, like a duplicate order id.

### 7. Note: in portrait, the order page's numbers have no labels

Screenshot `10-order-portrait.png`: the column header row is hidden in portrait. Each line shows "2 each", then "$12.34 $24.68", then "1 of 2", with nothing saying which is the pack price, the line total or the amount received. The order form in portrait does label its boxes (Packs, Pack size, Pack price). Adding the same small labels (`data-l`) to the page's cells would match. Everything fits the width, and touch targets and text size pass.

### 8. Note: small things

- **Future dates.** The date box has `max` = today (detail (b)). But `orderProblems` doesn't refuse a future date (**P2:** `2099-01-01` gives no problems), and Chrome lets you type past `max`. Low harm: it only affects which range the order shows in (M20).
- **A $0 line price is offered to the catalog.** **P8:** a line charged $0.00 is listed as a change ("$10.00 → $0.00"), ticked by default, and **Update prices** sets the catalog price to 0. This follows §21.3 as written. But a free or promo item would then show $0 on every order list. Worth unticking $0 lines by default.
- **The `line` column in `order-lines.csv` is ignored on restore.** Lines come back in file order (**P6:** swapping two rows swapped the lines). Nothing depends on the order today. If someone sorts the file in a spreadsheet, the lines are just in a different order.
- **Backup files have no formula guard.** `orders.csv` keeps `=HYPERLINK("x")`, `@SUM(A1)` exactly (**P6**), which is right for a restore file and matches `inventory.csv`. §21.5 asks for the guard only on the M20 history exports.
- **Large numbers.** Each amount must be a safe whole number, but their product isn't checked (P2: 2²⁶ packs × $2.7M gives an unsafe total). It can't happen with real orders.
- **PDF receipts** open with `window.open(blob URL)`. I couldn't check this on the Tab S8. Chrome on Android may download the PDF rather than show it. Worth one try on the tablet (detail (g)).
- **stage6-plan §3** has rows for v2 and v3 but **no v4 row**. SPEC §21.6 also says v4 "adds … the two settings (season start, school-year start)". Settings are rows in the existing `settings` table, so nothing is missing from the schema. Both docs should say so.
- **Helper devices** (database version 100) get the two new tables when they next open. That's tested only in fake IndexedDB (`schema-upgrade.test.ts`). It uses the same Dexie logic as a real browser, so I'm fairly confident, but no real-browser check covers an existing helper database.
- **Delete item with units on order:** the stage6-plan lists `m3` for this. `m3` wasn't changed, and no browser check covers the new paragraph in the confirmation. A unit test covers `openOrdersWithItem`.
- **Setup** (`Setup.tsx:167`) works out the "order total" after restoring a backup at first launch without on order. It's a one-time summary.

## Checked and sound

**Money (integer cents)**
- `percentOf` rounds half up to the cent (P1: `3333 × 7.5% = 250` (249.975), `1 × 50% = 1`, `3 × 50% = 2`, `199 × 25.5% = 51` (50.745)).
- Totals: 3 × $11.11, 10% off, tax $1.23, shipping $9.99, fees $0.01 → parts 3333, discount 333, **total 4123** (P1). A 100% discount gives $0.00.
- `parsePercent` takes up to two decimals and an optional `%`; refuses `7.555`, `.5`, `-5`, `1e1`; `100.01` reads as 10001 and is then refused as "a percent from 0 to 100".
- `parsePrice` refuses negative amounts and more than two decimals (P1).
- A dollar discount larger than the parts total is refused (P2), also after Edit lowers the parts.
- The browser check's total ($302.76) matches the hand sum on the order page screenshot.

**Status and on order (§3, §4)**
- Status follows the lines (placed, partly received, received); cancelled is a flag. Cancel is refused once anything is received, in the data layer and by hiding the button.
- `onOrderMap` counts only open orders, only item lines, and only what's still due (P3: `[["a",5],["b",50]]` for 2 + 1 × 3 of `a` and 2 × 25 of `b`).
- I searched every caller of `orderLineFor`, `buildOrderList`, `defaultQuantity`, `ruleQuantity`, `planAddMany` and `orderTotalCents`. All pass on order: the automatic list, filters, item rows, the detail card, the F27 default and quantity rules ("up to desired only" too), count-in totals and the counts-import totals. Stock highlighting doesn't, as §4 says. The only exception is the Setup summary (finding 8).
- `useOnOrder` shows nothing on order while loading or if the read fails. That only makes quantities look as they did before M19, never smaller.

**Receiving (F31)**
- One transaction: **P3** made the second item update throw. Afterwards `a onHand 1, b onHand 0, order received [0,0]`: nothing changed.
- Exact units: two lines of the same item add together (2 + 1 → +3); typed lines and deleted items change nothing; `lastCounted` unchanged (P3).
- More than is due is refused in the data layer (`Line 2: receive 0 to 2.`), and the steppers stop at what's due.
- No PIN, as §6 says.

**Edit, cancel, delete (§21.4)**
- Packs can't go below received (P4: `Received can be 0 to 1.`). Editing received never touches on hand.
- The data layer would let Edit drop a line that has received parts (P4), but the form disables that line's tick box (`OrderForm.tsx:202-211`). On hand isn't touched either way.
- Delete removes the order and its receipts in one transaction, and leaves on hand alone.
- Supplier rename follows by `supplierKey`, inside the rename's transaction. A category rename follows into lines. Removing either leaves orders alone.

**Recording and named lists (F30)**
- The order and the named-list change are in one transaction. If the list was deleted meanwhile, nothing is saved.
- Every ordered item leaves the named list, unticked lines stay (detail (e)). Received always starts at 0.
- Mark ordered uses the whole supplier group, even when a search shows only some lines.
- PIN: asked before the form opens and again on Save (detail (a)); again before **Update prices**; before Edit, Un-cancel, Delete (twice), and adding a receipt.

**Price copy (§21.3)**
- Only items with an option for this supplier are offered; an item on the order twice counts once. Pack price, pack size and `price_checked` = placed date are set; "unchanged" sets only `price_checked` (P8).
- Items deleted or moved to another supplier since are skipped.

**Typed lines with their own pack size and unit (`b5ca7eb`)**
- The form enables Pack size and adds a Unit box for typed lines; a blank unit is stored as "each" (P3: `"each"`, pack size 6).
- Received counts units: "3 × 2 = 6 shirt", Receive starts at 6 (browser check).
- CSV round trip keeps pack size and unit exactly, including `box, "big"` with a comma and quotes (P6). A blank unit reads back as "each".

**Backups and restore (§21.6)**
- Both files are always written, even when empty. A receipt whose file is missing on the tablet isn't named.
- An older ZIP without `orders.csv`, and a CSV-only restore, keep the tablet's orders. A ZIP with it replaces them. A receipt named but missing is reported and dropped.
- Malformed rows name the file and row (P7): a bad date, a percent over 100, `cancelled "maybe"`, a cancelled order with received parts, a blank supplier, received above the ordered units, a line for an unknown order, a missing `order-lines.csv`. Any problem stops the restore, as for the other backup files.
- The restore confirmation has a Placed orders row ("0 now, 1 in the backup"); the browser round trip brought the order and both receipts back exactly.
- Restoring at first launch now brings orders and named order lists.

**Schema v4**
- Two new stores, no data step, and the guard raised to 4. The unit test compares every v3 table byte for byte; the browser upgrade check does the same on the real backup (22/22: 129 items, 127 photos and every other row byte-equal).
- The blocked-upgrade path and the rollback guard both work in a real browser against a build of 30cff18 that I made myself (upgrade check, 22/22).

**Screens**
- Touch targets ≥ 48 px and text ≥ 15 px on the form and the order page; nothing wider than a portrait screen (m19 check). The landscape and portrait form screenshots look right: unticked lines are struck through with dashed boxes and "not ordered".

## Test changes (did any get weaker?)

| File | Change | Verdict |
|---|---|---|
| `tests/placed-orders.test.ts` (new, 38 tests) | Totals, status, on order, the form's lines, record, price copy, receive, edit/cancel/delete, receipts, CSV, backups | Good coverage of §22. Misses findings 1, 2, 3 and 6 |
| `tests/schema-upgrade.test.ts` | v1/v2 → v4; a new v3 → v4 byte-for-byte test; a v3 app's guard; the order indexes; a v100 helper database; "newer" is now 5 | Stronger |
| `tests/import-counts.test.ts` | Import totals subtract on order | Good |
| `tests/backup-restore.test.ts`, `helper-devices.test.ts` | Version and file-list numbers | Same behavior |
| `scripts/m15-ui-check.mjs` | v4 numbers, the Placed orders tab | **Weaker in effect:** the guard section now times out (finding 4) |
| `scripts/m16a`, `m17` | App version 0.6.0 | Same |
| `scripts/m19-ui-check.mjs`, `m19-upgrade-check.mjs` (new) | See above | Good. The UI check doesn't receive a deleted item's line (finding 1) |

I didn't run mutation tests: the rules forbid changing `src/`.

## Verdict

**Merge, with findings 1, 2 and 5 fixed first or straight after (each is a few lines), and finding 4's script fixed in the same PR.** The parts that matter most hold:
- the v3 → v4 upgrade adds two empty stores and changes nothing else, on the real tablet backup in a real browser;
- the guard and the blocked path work;
- receiving adds exactly the right units, in one transaction, and never to typed lines or deleted items;
- money is whole cents throughout and rounds as the spec says;
- orders and receipts round-trip through a full backup.

Finding 3 (Undo after a receive) needs a decision from Dan and can wait for M20. Back up the tablet before updating it, as the builder's tablet check says.

## Fixes after the review (builder, 2026-10-29)

Dan: "fix 1, fix 2, 3 undo skips items that have been received, fix 5, fix 7-8". Findings 4 and 6 weren't in the list and are still open.

| # | What was done | Evidence |
|---|---|---|
| 1 | `ReceiveDialog` gets the item ids that still exist; a line whose item is gone reads "n received (item deleted, no inventory change)" and isn't counted in the heading or button | `m19-ui-check`: "Add 5 to on hand for 1 item?" with the deleted item's line marked as above |
| 2 | Once `recordOrder` succeeds the form never comes back; each receipt is tried on its own, and one that fails is named in the "Recorded" toast ("A receipt couldn’t be saved (…): add it on the order page.") | `m19-ui-check` with receipt writes made to fail (`QuotaExceededError`): one order, no receipt, on to the price step, toast. Against the pre-fix build the same check fails (the form stays open) |
| 3 | Receiving notes each stocked item that the last import changed (`noteReceivedSinceImport`, inside the receive transaction). Undo skips those items; the confirmation and toast say how many were kept. Spec §18.5 (v0.14) | Unit: import → receive → Undo keeps A at 8 and puts the others back; a receive with no import writes no undo record |
| 5 | `useCloseOnRelock` in `CancelDialog` and `RemoveReceiptDialog` | `m19-ui-check`: both close on relock; the order isn't cancelled and the receipt stays |
| 7 | `data-l` labels on the order page's cells, shown in portrait | `m19-ui-check`: Ordered, Pack price, Line total, Received |
| 8 | Future placed date refused when recording or editing (not on restore); amounts too large to add up exactly refused; a $0 line starts unticked in the price copy; restore sorts lines by `line`; Setup's order total subtracts on order; stage6-plan §3 v4 row and SPEC §21.6 settings wording; tablet-check steps for viewing a PDF on Android and for a typed line | Unit: future date with and without today; 2²⁶ × 2²⁸ refused; lines from a reversed file and a blank number. `m19-ui-check`: $0 line unticked |

Not done from finding 8: a real-browser check of an existing helper database (v100) upgrading, and a browser check of the delete-item text. **Both done in M23** (2026-10-29): `scripts/m23-helper-upgrade-check.mjs` and `scripts/m23-ui-check.mjs`. The helper check found that the M19 build patched an old helper database in place (Dexie: "Schema was extended without increasing the number passed to db.version()"); M23 raises the helper's version with the inventory's (104). The formula-guard and `line` notes needed no change beyond the sort.

**Evidence:** type check and build clean. Unit **859 pass** (1 skipped), real tablet backup test passes. `m19-ui-check` **45/45** (8 new), clean console. Regression M3 50, M5 39, M15b 26, M16c 25, M18 14, all pass with clean consoles. M15 37, then the timeout from finding 4 (unchanged).

### Findings 4 and 6 (builder, 2026-10-29, later)

Dan: "fix 4 and 6 too".

| # | What was done | Evidence |
|---|---|---|
| 4 | `m15-ui-check` writes schemaVersion 5 (one above the app's 4) for the guard, and 4 to come back. Every browser check script (`scripts/*check.mjs`, 25 files) now exits 1 when any result is FAIL or ERROR, so a broken check can't read as a pass | M15 **40/40** again (the three guard checks run). Full regression below, every script exit 0 |
| 6 | `parseOrdersCsv` refuses a receipt file named twice ("receipt … is named twice (first on row n)") and more than 5 receipts on an order, as row problems before the confirmation | Unit test for both |
| — | **Found while fixing 6, and more serious:** `readCsv` let Papa Parse guess the separator. A cell with several semicolons made it pick `;`, and the whole file was refused ("missing columns"). An order with **4 or more receipts** made a full backup unrestorable. So did item **notes with about 5 semicolons** (e.g. "use: M3; M4; M5; M6; M8"), which has affected `inventory.csv` since Stage 4. The Oct 23 tablet backup isn't affected (its test passes). Fixed: `readCsv` always uses `,` | Probes before the fix: 5 receipts → 0 orders, notes "a; b; c; d; e; f" → 0 items; after: all read. Two unit tests, both failing without the fix |

**Evidence:** type check and build clean. Unit **862 pass** (1 skipped); real tablet backup test passes. Browser regression M2–M19, all exit 0, clean consoles: M2 28, M3 50, M4 25, M5 39, M6 54, M7 32, M8 61, M9 71, M10 42, M11 12, M12 16, M13 25, M14 20, M15 40, M15b 26, M16a 42, M17 34, M17b 7, M16b 36, M16c 25, M18 14, M19 45: **744, all pass.** The non-zero exit was checked by reading the code, not by forcing a failure.
