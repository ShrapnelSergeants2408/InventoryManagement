# SPEC v0.5 — Questions from the Stage 4 review

**Reviewed:** `docs/SPEC.md` v0.5, end to end, as an independent reviewer, cross-checked against `stage3-design-notes.md`, `stage3-verification.md`, the mockup sources and the seed ZIP.
**Date:** 2026-10-17, CDT · **Status:** **Approved 2026-10-17 16:17 CDT — Dan: "defaults OK"** for Q1–Q10 and D1–D8; UI library: Preact. SPEC.md has **not** been edited; Q3 (`categories.csv`) and Q8 (`manifest.json`) add files to §7 and should be written into the next spec version (v0.6) by Dan. **Update 2026-10-18:** written into SPEC v0.7 (§3 Category list, §7) at Dan's request.

Seed check (scripted, Python, against `seed/frc2408-starter-catalog-2026-10-17.zip`): 129 items, 168 vendor options, 128 photos (st-0099 SystemCore has none), 9 suppliers, every supplier name in `suppliers.csv`, preferred vendor = 1 for all items, order list at on_hand 0 = **124 lines, all priced, $8,413.66**, 5 items with desired 0, 10 barcodes, all prices dated 2026-10-17, all counts whole numbers, category/subcategory set matches §11 exactly. No contradictions between the seed and the spec.

Each question has a **proposed default**. If you reply "defaults OK", I build with them and you can approve the matching spec wording later.

---

## Q1. Full backup can't open the share sheet as a ZIP — F15, §7 · **blocks F15**

Chrome's Web Share API only shares an allow-listed set of file types. `.csv` is on it; **`.zip` is not** (MDN, "Shareable file types"; Chrome checks the same list on Android). So **Data only (CSV)** can open Android's share sheet as F15 says, but **Full backup (ZIP)** almost certainly can't.

**Proposed default:** Full backup tries `navigator.canShare()` first; if the ZIP isn't shareable, it **saves the ZIP to Downloads** and shows "Saved to Downloads — open Files to share it by Quick Share, Bluetooth or Drive." Saving it counts as a backup for the F16 clock. Verified on the Tab S8 in Stage 5. (Not proposed: disguising the ZIP as another file type — fragile and confusing on the receiving end.)

## Q2. Recovering a wiped or new tablet — §2, §6, §7, F17, F22 · **blocks the disaster path**

The PIN and settings are deliberately not in backups (§7), and they live in the same IndexedDB as the inventory. If storage is cleared, the storage-error screen "leads a mentor to Restore", but Restore needs the PIN, which is gone, and the first-launch flow (9f–9j) only offers the starter catalog.

**Proposed default:** a wiped or new tablet always goes through first-launch setup (set PIN → recovery code). Step 3 offers **two** choices: "Load the starter catalog" or **"Restore from a backup file"**. The storage-error screen explains this and offers "Set up again" with that path, plus "Try again" (for a temporarily blocked database).

## Q3. Categories have no data model or backup format — §3, §7, F1, F9, F24 · **affects the round-trip guarantee**

F9 lets you add categories and subcategories (which can be empty) and reorder them; F1 and F24 follow "list order". But §3 has no Category entity and §7 has no category file, so after export → restore, **empty categories, empty subcategories and the custom order are lost**. That conflicts with "round-trip with no data loss" (§7).

**Proposed default:** store categories as a list (name, order, ordered subcategories). Add **`categories.csv`** (`category, subcategory, order`) to the full backup, same pattern as `locations.csv`. If it's missing (data-only CSV, the seed), categories are rebuilt from `inventory.csv` in first-appearance order (which matches §11 for the seed). *This is a spec change: adds a file to §7.*

## Q4. Price-update CSV format isn't defined — F18, §10 · **blocks F18**

F18 says the import updates "price, pack size, URL, price_checked" and rejects an "unknown column", but doesn't say:
- (a) which columns are allowed. Supplier and part # aren't in the list, yet F18 also says unknown supplier names get added, which implies a supplier column.
- (b) whether a full data-only backup (which has on_hand, name, etc.) is acceptable as the input file. §10 step 3 suggests Claude edits that export.
- (c) whether a blank cell means "clear" or "leave unchanged".
- (d) whether the file can add a new v2/v3 option or change preferred_vendor.

**Proposed default:** required `id`. Allowed: `v1_…v3_` × {`supplier`, `part_no`, `url`, `pack_size`, `pack_price`, `price_checked`}. Columns from the inventory CSV (`name`, `on_hand`, …) are **recognized and ignored** (listed in the summary as "ignored columns"), so a full data-only export works as the input. Anything else is an "unknown column" error. **Blank = leave unchanged.** A row may fill an empty vendor slot (needs supplier + pack size), but it can't remove a slot or change preferred_vendor. Rows whose id isn't found are listed in the summary and aren't errors. Any error means nothing is saved.

## Q5. What a restore replaces — F17, §7

"Replaces all inventory" is clear for items and photos. It isn't clear for the **Supplier and Location lists** (and categories, Q3) on a full-ZIP restore: are they replaced by the backup's lists, or merged with the tablet's? Merging keeps suppliers the backup never had, along with their notes and website.

**Proposed default:** a **full ZIP** restore replaces items, photos, suppliers, locations and categories with the backup's (`other` is always re-added). A **CSV-only** restore replaces items. It keeps the tablet's lists, adds missing names (§7), and keeps photos for matching ids. Photos for ids that no longer exist are deleted. PIN and settings are never touched.

## Q6. Whole numbers and money precision — §3, §4, F18

§4 requires pack_size to be a whole number ≥ 1 but says nothing about on_hand, desired and spares. Units include ft and m, so 2.5 ft is plausible. Price precision isn't stated either.

**Proposed default:** on_hand, desired and spares are **whole numbers ≥ 0** (the seed is all whole numbers; ±1 steppers and the keypad assume it). Prices are stored as **integer cents**, so totals are exact: $8,413.66 is computed in cents, not floating point. A price with more than 2 decimal places is a validation error (in the editor and in F18).

## Q7. Does a quick adjust count as a count? — F3, F12, F24, §3

`last_counted` is set only by count-in and when adding an item. If a student uses the list stepper or Scan to set an uncounted starter item to 5, it stays "not counted". The F12 banner then says uncounted items are "treated as 0 on hand", but this one is actually 5.

**Proposed default:** keep the spec. Quick adjust (±/typed) does **not** set `last_counted`, because a ±1 is a change, not a confirmed count. Reword the F12 banner to "n items not counted yet — their on-hand numbers may be wrong (starter items begin at 0)". Alternative: a typed number (not ±) on the detail/scan screen sets `last_counted`. Your call.

## Q8. "Last change / saved date" in the restore comparison — F17, §7

The restore dialog compares the tablet's and the backup's "last change / saved date". Neither file in a backup carries a date. The filename does, but Android's share/receive path often renames files.

**Proposed default:** the full ZIP gets a small **`manifest.json`** (app version, saved-at timestamp, item/photo counts). Restore never requires it, so older ZIPs and the seed still work: when it's missing, the dialog falls back to the filename timestamp, then the ZIP entry dates, then "unknown". A CSV-only restore uses the filename or "unknown". The tablet tracks its own last-change time. *Adds a file to §7.*

## Q9. Stale prices when the date is blank, and setting the date — F14, §3

(a) A team-added vendor option with a price but no `price_checked`: stale or not? (b) When a mentor edits a price in the editor, is `price_checked` set to today?

**Proposed default:** (a) a blank date with a price counts as stale and is labeled "Price date unknown". (b) Changing pack_price or pack_size in the editor fills `price_checked` with today; the mentor can change it before saving.

## Q10. "Later" lasts "until the next app launch" — F16

An installed PWA on Android may stay in memory for days, so "next launch" may effectively never come.

**Proposed default:** "Later" hides the banner until the app is reloaded **or** for 12 hours, whichever comes first.

---

## Smaller decisions I'll make unless you object (no spec change needed)

| # | Area | Decision |
|---|---|---|
| D1 | §3 ids | Team-added ids are `tm-` + 5 random characters from an unambiguous set (no 0/O/1/I/L), e.g. `tm-7K3QX`. They're random, not sequential, so a deleted item's printed label can never point to a new item, even after a restore. Short enough to type (F21). |
| D2 | F4 | Search covers part #s and suppliers of **all** vendor options, not just the preferred one. Matching is case- and accent-insensitive. |
| D3 | F9 / F23 / F25 | Renaming to an existing name (case-insensitive) is rejected, which also means no "merge by rename". Subcategory names are unique within their category. |
| D4 | F13 | Order CSV: plain numbers with 2 decimals (no `$`). The subtotal row reads `"<Supplier> subtotal"` in Supplier, with the amount in Line total. The final row reads `"Grand total"`. "No price" lines show `NO PRICE` in Pack price, and a `"n items without prices"` line follows the grand total. |
| D5 | §9 | Fill order and start position count **left to right, top to bottom** for every layout, matching how a used sheet is peeled. The mockup filled 22805 and plain grid by columns; tell me if you prefer that. All geometry is data marked "verify against package" (§15 Q2). |
| D6 | §6 | PIN hashed with PBKDF2-SHA256 (Web Crypto), random salt. Recovery code: 10 characters, stored hashed. Using it lets you set a new PIN and shows a **new** recovery code. After 5 wrong PINs there's a 30-second wait (accident prevention, not security). The unlock lives in memory only, so reloading the app locks it. |
| D7 | F16 | The reminder clock starts when first-launch setup finishes, so there's no banner on day 1. |
| D8 | F24 | "Overall progress" counts all items; "skip items with desired 0" removes them from the walk, not from the total. |

---

## Later decisions

| When (CDT) | Topic | Decision |
|---|---|---|
| 2026-10-17 ~17:55 | Vendor photos on the public site (SPEC §8) | **Dan: "accept it".** The repo and the Pages site are public, so the hosted starter-catalog ZIP (and its vendor product photos) can be downloaded by anyone with the URL. Accepted as-is. The site carries `noindex, nofollow` so it isn't listed by search engines. No change to the seed or to SPEC §8. |
