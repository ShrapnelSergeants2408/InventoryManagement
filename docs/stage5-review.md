# Stage 5 review: FRC 2408 Inventory Management

**Reviewer:** a fresh Claude Code session (Claude Opus 5.5) that took no part in the build · **Date:** 2026-10-21 (America/Chicago)
**Source reviewed:** branch `fix-t01-persistent-storage` at `34cf04b` ("T-01: ask for persistent storage on every launch until granted, and after install"), one commit ahead of `main` (`ec84bcf`). No code was changed in this session.

**Earlier review replaced.** This file was untracked and held an earlier Stage 5 review (2026-10-19, of `7e6f0cc`). This review was done independently and replaces it. A copy of the earlier file was saved outside the repo before it was overwritten. Where this review agrees with it, the agreement was re-checked, not copied. Where it disagrees (finding 1), the reason is given.

**Spec version.** I was asked to review against SPEC v0.5, but `docs/SPEC.md` is now **v0.7**. v0.6 added count rounds (F24). v0.7 added `categories.csv` and `manifest.json` (§3, §7). Both are Dan-approved additions to v0.5, so the code is checked against v0.7 as written, and rows that only exist after v0.5 say so.

**Method.** I read SPEC.md end to end, then the data, I/O, domain and security code, plus the UI code that applies PIN gates and handles restore, delete and storage errors. I traced every `gate()` call. I ran the full unit suite and the production build. Five throwaway probe tests ran from the session scratchpad against the repo's code (see "Probes"); nothing was added to the repo. I did **not** re-run the headless-Chrome checks (`scripts/m*-ui-check.mjs`), so UI behaviour is cited from code. **NOT TESTABLE IN CODE** marks anything that needs the Galaxy Tab S8, a real printer or real label sheets.

## Results of the runs

| Command | Result |
|---|---|
| `npx vitest run` | **33 files, 510 tests, all pass** (4.2 s). That is 6 more than at `7e6f0cc`, all from the T-01 tests in `tests/setup.test.ts:141-195` |
| `npm run build` (`tsc --noEmit && vite build`) | **Clean.** 126 modules. Service worker generated with 16 precache entries (7,460 KiB, including the 5.4 MB starter ZIP and the 1.1 MB zxing `.wasm`) |
| Probe tests P1–P5 (scratchpad, own vitest config pointing at the repo) | 5 run. Confirmed findings 2, 4 and 5. P4 **disproved** the version-rollback scenario in the earlier review (finding 1) |
| `git status --short` after every run | Only `?? docs/stage5-review.md` |

## Findings (most serious first)

No **blockers**. Order math, backup round trip, price import, delete and the PIN gate all behave as the spec says. The T-01 commit fixes the earlier review's top finding (persistent storage was requested only once), but only on this branch until it is merged.

### 1. Major: "Set up again" on the storage-error screen deletes the whole database with no PIN

**Where:** `src/ui/App.tsx:108-113` always passes `canReset`. `src/ui/screens/StorageError.tsx:73-77` runs `Dexie.delete(...)` after one confirmation dialog.

Whenever `db.open()` rejects, for any reason, the screen offers **Set up again… › Delete and set up again**. That deletes the inventory, photos, PIN, recovery code and settings. No PIN can be asked, because the PIN is stored in the database being deleted. Some open failures leave the data intact, and waiting or reloading would recover it:
- **Blocked:** another tab or window holds the database while a schema upgrade is waiting (relevant from the first `version(2)` on).
- **Transient errors:** a low-disk `QuotaExceededError` or `UnknownError`, or a browser that is still restoring the profile.

One student with the tablet can lose everything since the last backup in two taps.

**Correction to the earlier review.** That review gave a schema rollback (`VersionError`) as the main trigger. Probe P4 shows Dexie 4.4.6 does **not** fail in that case: a `version(1)` build opened a database left at a newer version without an error, and the rows were still there. So rollback doesn't lead to this screen. It leads to finding 6 instead. This was checked with `fake-indexeddb`, not Chrome, so confirm it on the tablet.

**Steps to reproduce (in code):**
1. Make `db.open()` reject. For example, on desktop Chrome open the app, then in DevTools › Application make the open fail (fill the storage quota, or keep a second connection blocking an upgrade in a test build).
2. The app shows "Can't open the inventory on this tablet" with **Try again** and **Set up again…**.
3. Tap **Set up again…**, then **Delete and set up again**. The database is deleted and first-launch setup starts. Nobody was asked for a PIN, a typed confirmation or a backup.

**Suggested fix:** show **Set up again** only after **Try again** has failed at least once, and only for errors that mean the storage really is unusable. Ask the user to type a word such as `DELETE`. Say plainly that the PIN can't protect this step.

### 2. Major: names whose capitals don't match the lists bypass the F9 "remove only when empty" rule and block edits

§7 says hand-edited CSVs must load. Restore matches category, subcategory and location names to the lists ignoring capitals (`completeCategories` and `completeLocations`, `src/io/lists-csv.ts:167-201`). That's why a row with `motors` is accepted while the list has `Motors`. The item keeps the spelling `motors`, though, and the category code compares names exactly (`itemsIn`, `src/domain/lists.ts:127-129`; `fitToLists`, `src/data/items.ts:28-31`). Probe P1 showed:
- **F9 guard bypassed:** a mentor renames **Motors**, and the item doesn't follow (it stays `motors`). The mentor then removes the category: `removeCategory` finds 0 items (`src/data/lists.ts:208`) and removes it without asking where to move them. The item is left in a category that no longer exists.
- **Edits refused:** saving any edit, even notes, fails with `category "motors" isn't in the category list` (`src/data/items.ts:29`) until someone picks the category again.
- **Duplicate subcategories:** the editor keeps the imported `brushless` as an option (`src/ui/screens/item/Editor.tsx:131`). Saving it adds `brushless` to a category that already has `Brushless` (`src/data/items.ts:30-31`, exact `includes`), which breaks the §3 rule that subcategory names are unique ignoring capitals.
- **Walk orders disagree:** labels by location put `bin f3` under "No location" (`src/domain/labels.ts:212-214`, exact match), while count-in by location puts it under "Bin F3" (`src/domain/count.ts:55`, ignoring capitals).

Suppliers and locations are rewritten case-insensitively on rename and remove (`reassignSupplier` and `reassignLocation`, `src/domain/lists.ts:73-108`), so this affects categories and subcategories only, plus the label grouping.

**Steps to reproduce:**
1. More › Backup › Data only.
2. In Excel, change one item's category from `Motors` to `motors`, its subcategory to a lower-case form, and its location from `Bin F3` to `bin f3`.
3. Restore that CSV.
4. The Inventory list shows a separate `motors` header (`src/domain/inventory-view.ts:96-103` appends unlisted names). Editing the item's notes fails. More › Categories › rename **Motors**: the item stays `motors`. Remove **Motors**: no "move items first" step, and it's gone.

**Suggested fix:** when reading a file, rewrite each item's category, subcategory and location to the list's spelling, as F18 already does for suppliers (`src/io/price-import.ts:198-200`). Make `itemsIn` and the subcategory check compare with `nameKey`.

### 3. Minor: storage that was cleared looks like a first launch, not a storage error

§2 asks for a storage-error screen when the database "can't be opened (storage cleared or blocked)". When Chrome evicts the site's data, `db.open()` succeeds on a new, empty database, and the app goes to first-launch setup (`src/ui/App.tsx:45-48`, `128-133`). Setup offers "Restore a backup file", so there is a way back. But nothing tells the team their inventory was lost, and whoever holds the tablet sets a new mentor PIN.

**Steps to reproduce:**
1. Set up the app.
2. Chrome › Site settings › Clear data for the site.
3. Reopen the app: it shows the first-launch PIN step with no warning.

**Suggested fix:** add a line to the first setup step: "If this tablet had inventory before, its storage was cleared. Set a PIN, then choose Restore a backup file."

### 4. Minor: a full backup with no items can't be restored

`planRestore` refuses any backup with 0 items (`src/io/restore.ts:53-56`), even a full ZIP with suppliers, locations and categories. Probe P2 got "the backup has no items, so restoring it would empty the tablet".

**Steps to reproduce:**
1. First launch › Start empty.
2. Add a location.
3. Make a full backup.
4. Restore it: refused.

**Suggested fix:** allow the restore when the ZIP has list files, behind the same confirmation.

### 5. Minor: a ZIP with missing photo files restores, and those photos are deleted

If `inventory.csv` names `photos/<id>.jpg` and the file isn't in the ZIP, the restore still goes ahead (`src/io/bundle.ts:141-152`). The only sign is one line among the notes: "Photos named in inventory.csv but not in the ZIP: …". A full restore clears every photo first (`src/data/inventory.ts:56`), so the tablet's copies of those photos are deleted too. Probe P3 had 1 photo before and 0 after.

**Steps to reproduce:**
1. Make a full backup.
2. Delete one file from `photos/` inside the ZIP.
3. Restore it. The Photos row shows one fewer, and the item's photo is gone afterwards.

**Suggested fix:** show this warning in the amber attention style next to the Photos row ("127, 1 missing"), or keep the tablet's photo for those ids.

### 6. Minor: no schema migration path, and an older build opens a newer database without a warning

The schema is `version(1)` only (`src/data/db.ts:49-56`), and nothing tests an upgrade. Probe P4 shows that with Dexie 4 an older build opens a database left at a newer version without an error. If a later release changes how rows are stored and the Pages deploy is then rolled back, or a stale service-worker copy runs, the old code reads and writes the new rows with no warning. Today there is only one version, so this is a risk for the first schema change, not a present bug.

**Steps to reproduce:** probe P4. Create the database at `version(2)` with a row, then open it with `new InventoryDb(name)`: it opens (`verno` 1), and the row is still there.

**Suggested fix:** before the first `version(2)`, store a `schemaVersion` setting and have the app refuse to write (with a "please update" screen) when it is newer than the code. Add an upgrade test with real rows.

### 7. Minor: a backup saved to the tablet's own Downloads resets the reminder

`exportBackup` resets the F16 clock for any result except a cancelled share sheet (`src/ui/screens/more/export-backup.ts:14`), and that includes the fallback download. This matches F16 as written ("exporting either kind of backup resets the clock"). But that file is lost along with the tablet, so the reminder goes quiet while nothing is safe off the device.

**Steps to reproduce:**
1. Use a browser where `navigator.canShare({ files })` is false.
2. Back up. The toast reads "Saved … to Downloads", and the banner is cleared for the reminder period.

**Suggested fix:** keep the behaviour, but have the banner and toast say the file is still only on the tablet. Or reset the clock only after a share.

### 8. Minor: the spec text and the code disagree in approved places

These were approved in `docs/spec-questions.md` but never written into SPEC.md:
- **F16:** "Later" lasts 12 hours *or* until the next launch (`SNOOZE_MS`, `src/domain/backup-reminder.ts:6`). F16 says "until the next app launch".
- **F22:** first launch offers *starter catalog / restore a backup / start empty* (`src/data/setup.ts:13`). F22 says first launch loads the starter catalog.
- **§9:** "Additional layouts can be added later as data, without code changes." The layouts are a TypeScript constant (`SHEET_LAYOUTS`, `src/domain/labels.ts:41-45`), so adding one means a rebuild and a deploy. The file's header comment (`labels.ts:1-2`) claims otherwise.

### 9. Minor: T-01 isn't on `main` yet, and its boot call isn't covered by a test

The fix (`ensurePersistentStorage`, `src/data/setup.ts:57-68`, called from `src/ui/App.tsx:100-106` on boot and on `appinstalled`) is correct, and its helper is well tested (`tests/setup.test.ts:141-195`). Until it's merged, the deployed app still asks only once. No unit or browser check confirms that `App` makes the call. Also, the Backup screen reads `persisted()` once when it mounts (`src/ui/data-hooks.ts:96-101`), so on a launch where Chrome grants the request it can still show "not granted" until the screen is opened again.

### 10. Carried forward from earlier reviews (each pinned by a test; re-confirmed, not re-investigated)

- An `inventory.csv` inside a ZIP is read only as UTF-8, so a Windows-1252 file comes in garbled (`tests/review-m5.test.ts:150`).
- Restore accepts a vendor URL like `javascript:…`. It can't run, because `safeHref` guards every link (`tests/url.test.ts:25`), but the editor then refuses to save that item (`tests/review-m5.test.ts:143`).
- A blank first CSV line is reported as "Row 1: missing column" (`tests/review-m5.test.ts:125`).
- A backup stamped in the future keeps the reminder off (`tests/review-m5.test.ts:161`).
- The wrong-PIN wait lives in memory only, and the settings limits are checked only on screen (`tests/m6-review.test.ts:44-81`).

## Requirement table

| ID | Requirement | Result | Evidence | Notes |
|---|---|---|---|---|
| F1 | Collapsible category → subcategory; state remembered; headers show red/yellow counts | PASS | `tests/inventory-view.test.ts:44-92` (header counts :67); `tests/prefs.test.ts:20` (expanded groups round-trip) | Mismatched capitals make an extra header (finding 2) |
| F2 | Row: thumbnail, name, on hand, desired, spares, order qty, preferred supplier, pack price, location; note icon; highlight | PASS | `src/ui/screens/inventory/ItemRow.tsx:13-72` (every field, note icon :41); `tests/photos.test.ts:18-41` (thumbnails) | Looks on the tablet not checked |
| F3 | Large +/− and direct entry for on_hand, labeled "On hand" | PASS (code) | `tests/db.test.ts:62-100` (never below 0, fast taps not lost, Q7); `src/ui/components/OnHandStepper.tsx` | Size and use with gloves: NOT TESTABLE IN CODE |
| F4 | Search name, part #, supplier, location, notes; updates as you type | PASS | `tests/search.test.ts:13-53` | |
| F5 | Filters: needs order, red, yellow, category, supplier, location | PASS | `tests/filters.test.ts:15-59`; `tests/inventory-view.test.ts:99-129` | |
| F6 | Anyone adds; new subcategories; vendor option 1 without the PIN; locked once saved | PASS | `tests/item-form.test.ts:36-72, 184-191`; `tests/edits-db.test.ts:75-93`; gates at `Editor.tsx:143, 149, 181` | |
| F7 | Students edit counts, location, desired, spares, notes, photo, category, barcode; vendor/price need the PIN | PASS | `tests/item-form.test.ts:151-203`; `tests/edits-db.test.ts:105`; `tests/labels-db.test.ts:53-80` (barcode, no PIN) | Finding 2 blocks edits of case-mismatched imports |
| F8 | Delete any item; PIN; confirmation shows name and on hand; no undo | PASS | `src/ui/screens/item/DeleteItem.tsx:21-29, 59-66` (PIN to open and again at Delete; closes on relock); `tests/edits-db.test.ts:123` | The photo goes with the item; only a full backup brings it back |
| F9 | Add, rename, ▲/▼ reorder categories and subcategories; remove only when empty or moved; PIN for rename/remove | PARTIAL | `tests/edits-db.test.ts:239-310`; `tests/lists.test.ts:110-167`; gate `Categories.tsx:70-71` | Holds for names typed in the app. A case-mismatched import is removed without a move step (finding 2, P1). Drag (optional) not built |
| F10 | Detail card: full notes, photo (tap to enlarge), all vendor options with links, +/− | PASS (code) | `src/ui/screens/item/Detail.tsx:76, 120, 205, 244, 292` | Read in code only |
| F11 | One-tap supplier link | PASS | `tests/url.test.ts:6-30` (`safeHref` http/https only); `Detail.tsx:205` | |
| F12 | Order list: qty > 0, grouped by preferred supplier, subtotals, grand total; CSV; count-in banner | PASS | `tests/order.test.ts:31-77`; `tests/order-list.test.ts:12-29, 78` | |
| F13 | Order CSV columns, subtotal rows, grand total | PASS | `tests/order-list.test.ts:94-136`; starter catalog recomputed at :141-196 ($8,413.66) | |
| F14 | "Price n days old"; summary banner when more than half are stale | PASS | `tests/order-list.test.ts:34-76` | A price with no date counts as stale (Q9a) |
| F15 | Full ZIP or data-only CSV; Android share sheet | PASS (code) / share sheet NOT TESTABLE IN CODE | `tests/backup-restore.test.ts:108, 193`; `tests/order-list.test.ts:201-220` (share, cancel, download) | Finding 7 |
| F16 | Banner on Inventory and Backup after the period; "Later" until next launch; either export resets | PARTIAL | `tests/backup-reminder.test.ts:8-40`; `src/ui/shell/BackupBanner.tsx` | "Later" also ends after 12 h (finding 8). A Downloads save resets the clock (finding 7) |
| F17 | Restore ZIP or CSV; PIN; compare; back up first; "I understand" tick; CSV keeps photos; missing names added | PASS | `tests/backup-restore.test.ts:204-325`; `src/ui/screens/more/RestoreDialog.tsx:52-64` (PIN at Replace), `:66-71` (comparison), `:119, 127` (back up first; disabled until ticked) | Findings 4 and 5 |
| F18 | Price import: vendor fields only, whole file checked first, errors by row, summary, new suppliers added, PIN | PASS | `tests/price-import.test.ts:55-190`; `tests/review-m5.test.ts:62-132`; `src/data/price-import.ts:9-35` (items re-read inside the transaction); gate `Backup.tsx:148` | Preview shown before the PIN |
| F19 | Part photos (§8): optional, camera or gallery, ~1024 px JPEG, replace or remove without the PIN | PASS (code) / camera NOT TESTABLE IN CODE | `tests/photos.test.ts:79-190`; `tests/image-size.test.ts:5-45` | |
| F20 | QR labels (§9) | PASS (code) / real print NOT TESTABLE IN CODE | See the §9 rows | |
| F21 | Scan QR or barcode → item with +/−; typed id; unknown → attach (no PIN) or add | PASS (code) | `tests/scan.test.ts:22-110`; `tests/labels-db.test.ts:53-80` | Native BarcodeDetector on the tablet: NOT TESTABLE IN CODE |
| F22 | First launch loads the starter catalog (on hand 0, spares 0, photos), then offers count-in | PASS | `tests/setup.test.ts:29-87`; `tests/seed.test.ts:21-70` | Also offers restore and start empty (finding 8) |
| F23 | Suppliers: add, rename everywhere, remove with replacement (default `other`), `other` kept, no duplicates, A–Z with `other` last, PIN | PASS | `tests/edits-db.test.ts:134-188, 316`; `tests/lists.test.ts:50-87`; gates `Suppliers.tsx:43-44, 57` | |
| F24 | Count-in: modes, start screen, keypad, preview, location, save and resume, summary, count rounds, no PIN | PASS (code) | `tests/count.test.ts:42-229`; `tests/count-db.test.ts:39-180` | Count rounds are v0.6. Keypad size: NOT TESTABLE IN CODE |
| F25 | Locations: add anywhere and ▲/▼ (no PIN), rename/remove (PIN) with replacement, no duplicates, walk-order pickers with recent picks | PASS | `tests/edits-db.test.ts:191-236`; `tests/lists.test.ts:90-107`; gate `Locations.tsx:52-53` | Labels and count-in disagree on case-mismatched names (finding 2) |
| §2a | Fully usable offline after install | PASS (code) / install on the Tab S8 NOT TESTABLE IN CODE | `vite.config.ts` (precaches html, js, css, woff2, png, svg, wasm, zip; `navigateFallback`); build: 16 precache entries | Headless offline check not re-run this session |
| §2b | Request persistent storage | PASS on this branch / PARTIAL on `main` | `src/data/setup.ts:57-68`; `src/ui/App.tsx:100-106`; `tests/setup.test.ts:156-195` | Finding 9 |
| §2c | Persistent-storage status and space used, on the Backup screen and in About | PASS | `src/ui/screens/more/Backup.tsx:292-312`; `src/ui/screens/more/More.tsx:60`; `src/ui/data-hooks.ts:94-101` | |
| §2d | Storage-error screen when the database can't be opened, leading to Restore | PARTIAL | `src/ui/App.tsx:108-113`; `src/ui/screens/StorageError.tsx:31-67` | Cleared storage goes to first launch instead (finding 3). Risky reset (finding 1) |
| §4a | Order quantity, including the four worked examples | PASS | `tests/order.test.ts:5-30` (`it.each` of all four rows; line total :26) | |
| §4b | pack_size a whole number ≥ 1; no negative quantities | PASS | `tests/order.test.ts:21`; `tests/validate.test.ts:31-40`; `tests/item-form.test.ts:73-95` | |
| §4c | Preferred vendor must exist, or the editor won't save | PASS | `tests/validate.test.ts:27`; `src/domain/validate.ts:71-73` | |
| §4d | No price: listed, marked, left out of totals, with a count | PASS | `tests/order.test.ts:52-72`; `tests/order-list.test.ts:120` | |
| §4e | Red / yellow / none thresholds; never color alone | PASS | `tests/status.test.ts:6-31` (boundaries and "SHORT n" / "LOW SPARES" / "OK") | Icons on screen not checked |
| §6a | 4–6 digit PIN, set at first launch, stored hashed | PASS | `tests/pin.test.ts:33-67, 154` (PBKDF2-SHA256, 100k iterations, random salt) | |
| §6b | PIN required: delete, category remove/rename, vendor/price and preferred vendor, suppliers, location rename/remove, restore, price import, settings, change PIN | PASS | `gate()` calls: `DeleteItem.tsx:25, 29` · `Editor.tsx:143, 149, 181` · `Categories.tsx:71` · `Locations.tsx:53` · `Suppliers.tsx:44` · `RestoreDialog.tsx:53` · `Backup.tsx:148` · `Settings.tsx:44` · `More.tsx:90`; `tests/item-form.test.ts:184-203` | Gated dialogs close on relock (`useCloseOnRelock`). The one destructive action with no PIN is finding 1 |
| §6c | PIN not required: add item, counts, count-in, desired/spares/location/notes/photos/barcode, add/reorder categories and locations | PASS | No `gate()` on those paths (grep of `src/ui`); `setBarcode` has no gate (`src/data/items.ts:97`) | |
| §6d | Unlock length, relock, lock button on every screen showing the time | PASS | `tests/pin.test.ts:91-150`; `tests/m6-review.test.ts:91-106`; `src/ui/shell/LockPill.tsx` | |
| §6e | One-time recovery code | PASS | `tests/pin.test.ts:70-87, 209-230` | Lose both the PIN and the code, and the only way out is clearing the site's data |
| §6f | The PIN and settings are not in backups | PASS | `tests/pin.test.ts:237`; `tests/backup-restore.test.ts:315` | |
| §7a | CSV column order, including `photo_file` and `last_counted` | PASS | `tests/inventory-csv.test.ts:9` | |
| §7b | Columns matched by header name; older files without `last_counted` load | PASS | `tests/inventory-csv.test.ts:19, 30, 40, 46` | |
| §7c | Notes with commas and line breaks quoted correctly | PASS | `tests/inventory-csv.test.ts:68`; `tests/backup-restore.test.ts:125` | Leading and trailing spaces are trimmed (`inventory-csv.ts:145`); the editor trims too |
| §7d | ZIP: inventory, suppliers, locations, categories, manifest, photos | PASS | `tests/backup-restore.test.ts:108`; `src/io/backup.ts:50-75` | `categories.csv` and `manifest.json` are v0.7 |
| §7e | `categories.csv` keeps order and empty categories; rebuilt when missing | PASS | `tests/lists-csv.test.ts:51, 79`; `tests/seed.test.ts:44` | |
| §7f | Saved date: manifest, else file name, else ZIP dates, else unknown | PASS | `src/io/restore.ts:36-43`; `tests/backup-restore.test.ts:96` | |
| §7g | Timestamped file names | PASS | `tests/backup-restore.test.ts:91` | |
| §7h | CSV-only restore rebuilds missing supplier and location names (locations appended) | PASS | `tests/backup-restore.test.ts:233`; `tests/lists-csv.test.ts:70-78` | |
| §7i | Export → restore round-trips with no data loss (tested) | PASS | `tests/backup-restore.test.ts:125` (items, vendors, notes, lists, order, photos byte for byte), `:156`, `:173`, `:204`; `tests/review-m5.test.ts:33` | For files the app writes. Hand-edited files: finding 2 |
| §9a | QR encodes `2408:<item id>` | PASS | `tests/scan.test.ts:22, 96` (decoded back from generated QR) | |
| §9b | Four layouts: sizes, counts per sheet, content | PASS (code) | `src/domain/labels.ts:41-45, 50-80`; `tests/labels.test.ts:27-85, 167-176` | My check: 5160 (3 × 10, 2⅝ × 1 in, margins 3/16 and ½ in) and 5163 (2 × 5, 4 × 2 in, margins 5/32 and ½ in) match the published Avery templates. The 22805 grid is centred and unverified |
| §9c | Start position; 0.5 mm nudge saved per layout; test print; 100% reminder | PASS (code) | `tests/labels.test.ts:93-157`; `tests/labels-db.test.ts:33-50` | |
| §9d | Locations offered in walk order | PASS | `tests/labels.test.ts:206` | Exact-match grouping (finding 2) |
| §9e | Layouts checked against the actual package | NOT TESTABLE IN CODE | SPEC §15 Q2: sheets not bought yet | |
| §9f | More layouts can be added as data, without code changes | PARTIAL | `src/domain/labels.ts:41` | Finding 8 |

## Code the spec doesn't ask for

None of this is harmful, and most of it is approved in `docs/spec-questions.md`. It's listed so the spec can catch up.

- **First launch** offers *restore a backup* and *start empty* as well as the starter catalog (Q2, `src/data/setup.ts:13`).
- **"Set up again"** on the storage-error screen deletes the database (finding 1). The spec only asks for a path to Restore.
- **Price-import preview** with before → after values and flagged non-price changes, shown before the PIN (`src/io/price-import.ts:10-13`).
- **Wrong-PIN wait:** every 5th wrong PIN or recovery code in a row starts a 30-second wait (`src/data/pin.ts:12-13, 62`).
- **"Later" snooze** capped at 12 hours (Q10).
- **New-version banner** (Reload / Later) after a service-worker update (`src/ui/shell/UpdateBanner.tsx`).
- **Desired and spares steppers** on the detail card (`src/data/inventory.ts:70-107`).
- **Count-in pause point** remembered in localStorage (`tests/count-db.test.ts:169`).
- **Barcode rules:** EAN-13 and UPC-A treated as the same code, and a barcode already on another item is refused (`src/data/items.ts:97-111`).
- **Spreadsheet guards:** formula-looking order-CSV cells get a leading apostrophe; US dates, Windows-1252 CSVs and "$1,234.50" prices are accepted; barcodes in Excel scientific notation are refused (`src/io/inventory-csv.ts:42, 101-104`).
- **Price checked** set to today when a price or pack size is edited (Q9b).
- **Under a strict v0.5 reading:** `categories.csv`, `manifest.json` and count rounds (v0.6/v0.7).

## The spec asks for it, but the code is missing or short

- Storage-error screen for *cleared* storage (finding 3).
- Layouts as data (finding 8).
- F9's "remove only when empty" for case-mismatched imports (finding 2).
- Persistent storage asked again after setup: done on this branch, not yet on `main` (finding 9).
- Drag to reorder (F9, "optional"): not built, which the spec allows.
- Everything marked NOT TESTABLE IN CODE still needs the hands-on Tab S8 session: install, share sheet, camera, native scanning, a real print at 100% on each sheet type, use with gloves.

## Data-loss review

| Area | What protects the data | Risk left |
|---|---|---|
| **Backup** | Full ZIP built from one read transaction (`src/data/backup.ts`); `photo_file` follows the photos actually written (`src/io/backup.ts:53-59`); round trip tested byte for byte | A Downloads save counts as a backup (finding 7) |
| **Restore** | Whole file checked first; `replaceAll` validates every item, then replaces everything in one transaction (`src/data/inventory.ts:42-68`; rollback tested at `tests/db.test.ts:33-50` and `tests/backup-restore.test.ts:301`); PIN asked again at Replace; "I understand" tick; Back up first; CSV keeps photos | Missing photo files dropped with only a note (finding 5). Empty-item backup can't be restored (finding 4). Hand-edited capitals (finding 2) |
| **Price import** | All or nothing; preview before the PIN; each item re-read inside the transaction, and only its vendor slots written, so counts are never touched (`src/data/price-import.ts:9-35`; `tests/price-import.test.ts:153-190`) | An old export can still revert vendor edits if the mentor accepts the flagged preview. That is by design and warned about |
| **Delete** | PIN to open the confirmation and again at Delete; closes on relock; name, photo and on hand shown (`DeleteItem.tsx`) | No undo (spec). Its photo goes with it |
| **PIN handling** | PBKDF2-SHA256, random salt; never in backups; restore and setup never touch it (`tests/backup-restore.test.ts:315`) | "Set up again" deletes everything with no PIN (finding 1). Lose both the PIN and the recovery code, and the only way out is clearing site data (that loses the inventory too, so a current backup matters) |
| **IndexedDB schema** | One `version(1)` schema; every multi-table write in a transaction; derived fields (`supplierKeys`, `updatedAt`) removed on read (`src/data/db.ts:60-69`) | No migration path or upgrade test. An older build opens a newer database silently (finding 6, P4). Item ids are case-sensitive keys while CSV import compares them ignoring capitals; I found no way to make this cause a problem from the app |

## Probes (scratchpad only, not committed)

These were run with a separate vitest config that resolves `@repo/...` to this repository. The repo's `git status` was unchanged afterwards.

| # | What | Result |
|---|---|---|
| P1 | CSV restore with `motors` / `brushless` / `bin f3` against lists `Motors` / `Brushless` / `Bin F3`; then edit, rename, remove | Item kept lower-case names. Labels by location → "No location"; count-in → "Bin F3". Editing notes refused: `category "motors" isn't in the category list`. Renaming Motors → item stays `motors`. `removeCategory` held = 0, so the category was removed while the item still used it. `removeLocation('Bin F3')` did move the item (location matching ignores capitals) |
| P2 | Full backup of a tablet with lists but no items, then restore | Refused: "the backup has no items…" |
| P3 | Full backup with its one photo file removed from the ZIP, then restore | Plan OK with 0 photos and a warning; after restore the tablet has 0 photos (was 1) |
| P4 | Database created at Dexie `version(2)` with one row, then opened by `InventoryDb` (`version(1)`) | Opened with no error (Dexie logged "SchemaDiff… will add missing parts"); the row was still there. No `VersionError` |
| P5 | `categories.csv` with both `Motors` and `motors` rows | Merged into one `Motors` (list files are case-safe; only item fields are not) |

## Log (America/Chicago)

| Time (CDT) | Step |
|---|---|
| 2026-10-21 13:12 | Session start. Branch `fix-t01-persistent-storage` @ `34cf04b`; only untracked file `docs/stage5-review.md` (earlier review of 2026-10-19). SPEC.md is v0.7 (asked for v0.5); reviewing against v0.7 |
| 13:12 | Read SPEC.md end to end. Read the earlier review for context and copied it to the session scratchpad before it was replaced |
| 13:13 | `npx vitest run`: 33 files, 510 tests pass |
| 13:13 | `npm run build`: clean, 126 modules, 16 precache entries |
| 13:13–13:15 | Read data layer (`db`, `inventory`, `items`, `lists`, `setup`, `pin`, `price-import`), I/O (`restore`, `bundle`, `backup`, `inventory-csv`, `lists-csv`, `csv`, `price-import`), domain (`order`, `status`, `validate`, `lists`, `labels`), security, and the UI for boot, the storage error screen, restore, delete and the editor gates; traced every `gate()` call |
| 13:15–13:16 | Probe tests P1–P5 in the scratchpad (first two runs fixed the probe config; P4's first assertion was wrong about Dexie 4 and was changed to report what happens) |
| 13:16 | Collected test names and line numbers for evidence |
| 13:19 | Report written to `docs/stage5-review.md`. No code changed; `git status` shows only this file. Headless-Chrome checks not re-run. Session stopped |
