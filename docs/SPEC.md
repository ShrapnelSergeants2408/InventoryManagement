# FRC 2408 Inventory Management — Specification v0.8

**Team:** FRC 2408 · **Owner:** Dan · **Target device:** Samsung Galaxy Tab S8 (Android, Chrome, not school-managed), plus optional helper devices for counting (§18)
**Status:** Approved by Dan 2026-10-21 13:46 CDT · **v0.1:** 2026-10-17 10:35 CDT · **v0.2:** 2026-10-17 10:58 CDT · **v0.3:** 2026-10-17 11:45 CDT · **v0.4:** 2026-10-17 14:50 CDT · **v0.5:** 2026-10-17 15:40 CDT · **v0.6:** 2026-10-18 CDT · **v0.7:** 2026-10-18 CDT · **v0.8:** 2026-10-21 13:46 CDT

**Changes in v0.8:** The changes designed in the claude.ai project (2026-10-19 to 2026-10-21; written there as a "v0.6 draft" from v0.5, `docs/proposals/2026-10-21-claude-proposal.md`) merged into v0.7. Merge details: `docs/spec-merge-plan.md`.
- **Helper devices for counting** (F26, new §18), so several students can count at once (decided 2026-10-19 13:47–13:53):
  - The main tablet sends a **count kit** to helper devices (other tablets or students' phones). Students count their assigned groups and send back a **counts file**. The main tablet runs **Import counts**, which previews the import, settles conflicts and reviews new items before anything is saved.
  - Helpers can add items that aren't in the catalog. They arrive as **pending items** for review on the main tablet.
  - Import counts needs no PIN. The safety nets are the preview and **Undo this import** (§18.5).
  - `last_counted` becomes a date and time, and there's a new `counted_by` field (§3, §7). Full backups add `pending-items.csv`.
  - Helper mode must work on phones down to 360 CSS px wide (§2, §17).
  - F22 asks on first launch whether the device is the shop tablet or a helper. F24, F15, §1, §6, §13, §14 and §17 are updated to match. F24 keeps its count rounds (v0.6); imported counts join the current round.
  - The main tablet remains the only full copy of the inventory; live sync stays out of scope.
- **New categories** (§11): Electrical, Pneumatics, Mechanical, Fasteners, Power Transfer, Assemblies, Public Relations, Programming, Tools, Safety, Misc, with the team's own subcategories. More can still be added in the app (F9). The starter catalog is remapped (§12, `frc2408-starter-catalog-2026-10-21.zip`, which now includes `categories.csv`).
- **Bulk move** (F28): select several items and move them to another category or subcategory in one step.
- **Named order lists** (F27): build an order from chosen items, separate from the automatic list. Items are added from the item row, the detail card or a scan. Lists never change inventory; received parts are added to on-hand by hand. Full backups add `order-lists.csv`.
- **Order list search** (F12): filters the lines shown. Export still sends everything, and a second option exports only the lines shown.
- **Filter order** (F5): Supplier moves to the end.
- **Labels by PDF** (§9): with no printer on the tablet's network, labels are saved as a PDF and printed from another computer at actual size.
- **First launch** (F22) now also states the setup choices the app already offers (starter catalog, restore a backup, start empty; spec-questions Q2).
- **Upgrading the existing build** (§18.7) and must-have tests (§18.6, §19).
- Kept from v0.6/v0.7 where the proposal's text differed: count rounds (F24), `manifest.json` and the `categories.csv` layout (§7), the Category table (§3), and the closed §15 questions.

**Changes in v0.7:** Two Stage 4 decisions approved 2026-10-17 (spec-questions Q3, Q8) written in, and two hardware questions removed from §15:
- Categories are a list with their own order and subcategories (§3), saved as `categories.csv` in the full backup (§7).
- The full backup includes `manifest.json` (app version, saved-at time, item and photo counts), used by the restore comparison (F17, §7).
- §15: the NEO 2.0 / WCP-1011 test fit and the 2027 robot radio are robot questions, not app questions, and are closed here.

**Changes in v0.6:** Count rounds for count-in (F24): progress shows items counted since a chosen date, so a later recount shows its own progress. Approved by Dan 2026-10-18 after the M9 review.

**Changes in v0.5:** All remaining Stage 3 proposals (S2, S4–S11) approved and written in:
- Barcode field needs no PIN (F7, F21, §6).
- Backup banner placement and snooze (F16).
- QR label format `2408:<item id>` (§9, F21).
- Safer restore confirmation (F17).
- Price import is all-or-nothing (F18).
- Reorder mode with ▲/▼ buttons (F9, F25).
- Named PIN-protected settings (§6).
- Stale-price summary banner (F14).
- Storage status and a storage-error screen (§2).

Open question 5 is closed.

**Changes in v0.4:** Stage 3 (UI mockups) complete. Changes:
- Count-in mode added (F24), with a new `last_counted` item field.
- Locations are now a managed list (F25, `locations.csv` in the full backup).
- Vendor option 1 is editable without the PIN while adding a new item (F6, §6).
- Deleting an item keeps the confirmation step only, with no undo (F8).
- UI conventions recorded in §17: navigation, colors, status badges, black-with-red-outline destructive buttons.
- Open questions updated (§15): the remaining Stage 3 proposals await a decision.

---

## 1. Purpose and users

A shop inventory tool for the robotics team. Students use one shared tablet (the **main tablet**) to look up parts, add parts, adjust counts, and see what needs ordering. Mentors control deletions, pricing, suppliers, and restores with a PIN. The app produces an order list grouped by supplier. For big counts, extra tablets or students' phones can join temporarily as **helper devices**. They only count, and they send their counts back to the main tablet (§18).

## 2. Platform and stack

| Decision | Choice | Why |
|---|---|---|
| App type | Progressive Web App (PWA), installed from Chrome to the home screen (confirmed 2026-10-17) | No app store or Android Studio; works offline; Claude Code can build and test it |
| Language/build | HTML/CSS/TypeScript, built with Vite | Simple, readable, good tooling in VS Code |
| Live storage | IndexedDB in the browser (via Dexie.js) | Reliable structured storage for items and photos; CSV is too fragile as a live database |
| CSV | Papa Parse | Import/export/backup/order list |
| Backup with photos | ZIP (JSZip) containing the CSV plus a photos folder | CSV can't hold images |
| QR generation | A small JS QR library | Printable labels |
| Scanning | Browser BarcodeDetector API, with a JS library fallback | Camera scanning of QR and common barcodes |
| Hosting | GitHub Pages (HTTPS) | Required for camera access and offline install |
| Tests | Vitest | Order math, label layout math, and backup round-trip must be tested |

Additional requirements:
- Show persistent-storage status (granted or not, space used) on the Backup screen and in About. If the database can't be opened (storage cleared or blocked), show a storage-error screen that explains what happened and leads a mentor to Restore (F17).
- Fully usable offline after first install.
- Request persistent storage (`navigator.storage.persist()`) to reduce the chance of the browser clearing data.
- Layout designed for an 11-inch tablet in landscape; usable in portrait. Touch targets at least 48 px. See §17 for UI conventions.
- Helper mode (§18) also runs on phones: Android Chrome and iPhone Safari, portrait, from 360 CSS px wide. iPhone Safari has no BarcodeDetector, so the JS scanning fallback is required there. Helpers work in a browser tab and don't have to be installed.

## 3. Data model

### Item
| Field | Required | Notes |
|---|---|---|
| id | yes | Auto-generated, stable; encoded in QR labels. Starter items use `st-0001`…; team-added items get new ids, assigned only on the main tablet (helper additions get a real id when accepted, §18.5) |
| name | yes | e.g. "NEO 2.0 Brushless Motor" |
| category | yes | See §11 |
| subcategory | no | |
| location | no | One name from the Location list (F25), or blank. Optional by design |
| unit | yes | each, ft, m, kit, stick, etc. |
| on_hand | yes | Current inventory |
| desired | yes | Amount needed for current needs; adjusted as needs change |
| spares | yes | Extra buffer kept beyond desired (default 0) |
| barcode | no | Manufacturer barcode, if one exists, so it can be scanned |
| notes | no | Free text, multi-line (e.g. "use with Thrifty swerve," "ask mentor before cutting") |
| photo | no | One optional part photo (§8) |
| source | yes | `starter` (from starter catalog) or `team` (added by the team); informational only |
| last_counted | no | Date and time on_hand was last confirmed by a physical count (F24), ISO 8601 in the device's local time with its UTC offset (e.g. `2026-10-24T18:42-05:00`; never UTC `Z`). Blank for starter items until counted. Set when an item is saved in count-in, when a new item is added (the on-hand amount entered when adding counts as a count), and when a helper's count is imported (set to the time the helper counted, §18.5). Count rounds (F24) compare its local date with the "counting since" date |
| counted_by | no | Where the last count came from: blank = this tablet, otherwise the helper's name (e.g. "Tablet 2 · Alex & Jordan"). Set together with last_counted; used to settle conflicts (§18.5) |
| preferred_vendor | yes | Which of the vendor options (1–3) is used for ordering |
| vendors | 1–3 | See below |

### Vendor option (up to 3 per item)
| Field | Notes |
|---|---|
| supplier | One name from the Supplier list (below) |
| part_no | Supplier part number |
| url | Product page; opens with one tap |
| pack_size | Units per purchasable pack (1 if sold individually) |
| pack_price | Price per pack, USD |
| price_checked | Date the price was last verified |

### Supplier (managed list, F23)
| Field | Required | Notes |
|---|---|---|
| name | yes | Unique (case-insensitive). Shown in vendor options, filters, and order-list groups |
| website | no | Home page; opens with one tap |
| notes | no | e.g. account number location, "prices need login," shipping notes |

Default list on first launch: REV, AndyMark, CTRE, WCP, VEX, McMaster-Carr, Thrifty Bot, Amazon, other. `other` always exists and cannot be removed (it is the fallback when a supplier is removed).

### Location (managed list, F25)
| Field | Required | Notes |
|---|---|---|
| name | yes | Unique (case-insensitive), e.g. "Bin F3", "Shelf C1", "Pit cart" |
| notes | no | e.g. "blue tote under the workbench" |
| order | yes | Position in the list. This is the walk order for count-in by location (F24) and for labels by location (§9) |

Empty on first launch (the starter catalog has no locations). Items with no location are grouped as "No location" wherever locations are listed.

### Category (managed list, F9)
| Field | Required | Notes |
|---|---|---|
| name | yes | Unique (case-insensitive). The starter list is in §11 |
| order | yes | Position in the list. This is the Inventory list order (F1), the order for count-in by category (F24) and for labels by category (§9) |
| subcategories | no | An ordered list of names, unique within the category (case-insensitive) |

Categories and subcategories can be empty (added before any item uses them, or emptied by moving items). They're kept in `categories.csv` (§7). The default list on first launch comes from the starter catalog (§11, §12).

### Order list (F27)
| Field | Required | Notes |
|---|---|---|
| id | yes | Generated |
| name | yes | Unique (case-insensitive), e.g. "WCP order — Nov", "Competition spares" |
| notes | no | Free text |
| created / updated | yes | Date-time |
| lines | 0+ | Each line: item id and quantity wanted (in the item's unit). Pack rounding, prices and totals are worked out from the item's preferred vendor as in §4 |

Order lists are plans, not inventory: they never change on_hand, desired, spares or the automatic order list (F12).

### Helper (main tablet only, §18)
| Field | Required | Notes |
|---|---|---|
| id | yes | Generated when the helper is created; written into its count kits |
| name | yes | Unique (case-insensitive), e.g. "Tablet 2 · Alex & Jordan", "Maya's phone" |
| groups | yes | Assigned categories or locations (one kind per helper) |
| allow_new_items | yes | Whether this helper may add items not on the list (default on) |
| last_kit_at / last_import_at | no | Shown on the Helper devices screen |

Helpers are working records for one counting effort, not inventory: they aren't included in backups (§7), and a counts file from an unknown helper can still be imported after a warning (§18.5).

### Pending item (main tablet, §18.5)
A new item a helper added, waiting for a mentor or student to accept, match or discard it. It holds the fields the helper entered (§18.3), the count, counted_at, the helper's name and an optional photo. Pending items are **not** part of the inventory: they don't appear in the list, the order list, labels or search until accepted. They're kept until decided and are included in full backups (`pending-items.csv`, §7).

## 4. Calculations

### Order quantity
```
need       = desired + spares − on_hand
if need ≤ 0: order nothing
packs      = ceil(need ÷ pack_size)          (preferred vendor's pack size)
order_qty  = packs × pack_size
line_total = packs × pack_price
```

Worked examples:
| desired | spares | on_hand | pack_size | need | packs | order_qty |
|---|---|---|---|---|---|---|
| 4 | 2 | 1 | 1 | 5 | 5 | 5 |
| 12 | 4 | 5 | 50 | 11 | 1 | 50 |
| 10 | 2 | 12 | 25 | 0 | 0 | 0 (no order) |
| 10 | 2 | 11 | 25 | 1 | 1 | 25 |

Validation and edge cases:
- pack_size must be a whole number ≥ 1; quantities cannot be negative.
- Every item needs a preferred vendor that exists; the editor won't save otherwise.
- If the preferred vendor has no pack_price, the item still appears on the order list, marked "no price," and is excluded from totals with a count shown ("3 items without prices").

### Stock highlighting
- **Red:** on_hand < desired (short for current needs)
- **Yellow:** desired ≤ on_hand < desired + spares (short on spares only)
- **No highlight:** on_hand ≥ desired + spares

Highlighting never relies on color alone: each state also has its own icon and word (§17).

## 5. Features (v1)

| # | Feature | Acceptance criteria |
|---|---|---|
| F1 | Collapsible list by category → subcategory | Categories and subcategories expand/collapse; state remembered; each header shows count of red/yellow items inside |
| F2 | Item row shows | Thumbnail (if photo), name, on hand, desired, spares, order qty, preferred supplier, pack price, location; note icon when notes exist; red/yellow highlight |
| F3 | Quick adjust | Large +/− buttons and direct number entry for on_hand, without opening a full edit form. The control is labeled "On hand" wherever it appears |
| F4 | Search | Matches name, part number, supplier, location, notes; results update as you type |
| F5 | Filters | In this order: Needs order · Short only (red) · Low spares only (yellow) · by category · by location · by supplier. Supplier is last (Dan, 2026-10-21) |
| F6 | Add item | Anyone can add a new item to any category, including new subcategories; same form as edit. While adding, vendor option 1 (supplier, part #, link, pack size, optional price) can be filled in without the PIN, so a student can save the item; once saved, vendor fields lock behind the PIN like any other item (§6) |
| F7 | Edit item | Students can edit counts, location, desired, spares, notes, photo, category, and barcode (type it or scan it in); vendor/price fields need the PIN (§6) |
| F8 | Remove item | Delete any item, starter or team-added (PIN required; confirmation step shows item name and on-hand count). No undo: the confirmation step is the only safeguard, and recovery is by restoring a backup |
| F9 | Manage categories | Add, rename, and reorder categories and subcategories (Reorder mode with large ▲/▼ buttons, so it works with gloves; drag is optional); removing one requires it to be empty or its items moved first (PIN required for remove/rename). Items can be moved in bulk (F28). The category list, including empty categories and subcategories, is saved in backups (`categories.csv`, §7) |
| F10 | Item detail card | Full notes, photo (tap to enlarge), all vendor options with links, +/− buttons, **Add to order list** (F27) |
| F11 | One-tap supplier link | Opens the vendor product page in the browser |
| F12 | Order list | Lists every item with order_qty > 0, grouped by preferred supplier, with a subtotal per supplier and a grand total; view on screen and export CSV. While any item has never been counted (blank last_counted), a banner shows count-in progress and warns that uncounted items are treated as 0 on hand. **Search:** a search box filters the lines shown by item name, part #, supplier or notes as you type, with "Showing n of m lines" and the total of the lines shown; the grand total of the whole list stays visible. **Export:** **Export CSV** always exports every line (F13). **Export shown lines only** exports just the filtered lines, with "filtered" and the search text in the filename and a note in the file's first row |
| F13 | Order list CSV | Columns: Supplier, Part #, Item, Unit, Need, Pack size, Packs, Order qty, Pack price, Line total, Price checked, URL, Notes; a subtotal row after each supplier; grand total at the end |
| F14 | Stale price flag | Prices with price_checked older than the stale-price age (setting, default 90 days) are marked on each order-list line ("Price n days old"). When more than half of the priced lines are stale, a summary banner also appears at the top of the order list with the price-refresh steps (§10) |
| F15 | Backup export | Two choices: **Full backup** (ZIP: CSV + suppliers + locations + categories + order lists + pending items + manifest + photos, §7) or **Data only** (CSV). Opens Android's share sheet (Bluetooth, Quick Share, email, Drive) |
| F16 | Backup reminder | Banner appears on the Inventory (home) and Backup screens if no backup of either kind has been exported within the reminder period (setting, default 7 days). "Later" hides it until the next app launch. Exporting either kind of backup resets the clock |
| F17 | Restore | Accepts a full-backup ZIP or a CSV; replaces all inventory (PIN required; confirmation step). The confirmation compares "on this tablet now" with "in the backup" (item and photo counts, last change / saved date), offers **Back up this tablet first**, and enables **Replace everything** only after an "I understand this replaces everything" box is ticked. A CSV-only restore keeps existing photos for matching item ids. Supplier and location names in the restored data that aren't in their lists are added automatically. A full-backup restore also replaces the order lists and pending items with the backup's; a CSV-only restore keeps them and drops order-list lines whose items no longer exist. Either kind clears **Undo this import** (§18.5). Count kits and counts files are rejected (§7) |
| F18 | Price-update import | Imports a CSV that updates only vendor fields (price, pack size, URL, price_checked) for matching item ids; never touches counts. The whole file is validated before anything is saved: if any row fails (e.g. pack size not a whole number ≥ 1, unknown column), nothing changes and the errors are listed by row number; shows a summary of rows updated and ids not found (PIN required). Unknown supplier names are added to the Supplier list and listed in the summary |
| F19 | Part photos | Optional; see §8 |
| F20 | QR labels | See §9 |
| F21 | Scan | Camera button scans a QR label (`2408:<item id>`, §9) or stored manufacturer barcode and opens that item with +/− buttons. A bare item id or barcode can also be typed in (torn label, no camera). An unknown code offers to attach it to an existing item (no PIN) or add a new item with it. A found item also offers **Add to order list** (F27) |
| F22 | Starter catalog | First launch first asks what this device is: **Set up the shop tablet** (the main tablet) or **Join as a helper** (opens a count kit, §18.2; no PIN, no catalog). Setting up the shop tablet sets the PIN and shows the recovery code, then offers **Load the starter catalog**, **Restore from a backup file** (F17) or **Start empty**. Loading the starter catalog loads the categories (from `categories.csv`) and the items (§12) from its full-backup ZIP: on_hand = 0, recommended desired amounts, spares = 0, vendor product photos. Starter items can be edited or removed like any other item. After loading, the app offers to start count-in (F24) |
| F23 | Manage suppliers | Add a supplier (name, optional website and notes); rename a supplier (updates every vendor option and order-list group that uses it); remove a supplier: if any vendor options use it, show how many and require choosing a replacement supplier (default `other`) before removal; `other` can't be removed; duplicate names are rejected. Supplier pickers in the item editor list suppliers alphabetically with `other` last. PIN required for add, rename, and remove |
| F24 | Count-in mode | A guided walk-through for counting stock, built for the first inventory count and reusable for later recounts. **Modes:** by category (default; follows list order), by location (Location list order, then "No location"), or scan as you go (scanning a label or barcode opens the keypad for that item). **Start screen:** current order-list total, overall progress (counted of total), progress and Start/Continue/Recount per category or location, and two options: ask for a location while counting (on by default) and skip items with desired 0. **One item per screen:** photo, name, category, supplier and part #, desired and spares; large keypad with None (0), "= desired" and ±1; live preview of the resulting status (short / low spares / OK); optional location from the Location list, with "New location…" (F25); Back, Skip for now, and Save & next. **Saving** sets on_hand and last_counted immediately, so a count can stop and resume across meetings. **Group summary:** counted, short and skipped counts, order-list total before → after, and shortcuts to the next group, printing labels for that group, and backing up. **Count rounds:** progress, Start/Continue/Recount and the summary count an item as counted when the local date of its last_counted is on or after the "counting since" date. Blank (the default, for the first count) means counted at any time. **Start a new count** sets the date to today; it can be changed or cleared. Starting a round erases nothing: on_hand and last_counted stay as they are. The F12 banner still uses blank last_counted. **Helpers (main tablet):** the start screen also has **Helper devices** (§18.1), **Import counts** (§18.5) and, when any exist, **Pending from helpers (n)**. Counts imported from helpers count toward progress like counts made here (their last_counted is the helper's counted_at, so they follow the same round rule), and each group shows which helper it's assigned to. No PIN required |
| F25 | Manage locations | Add a location (name, optional notes) — anyone, from the Locations screen, the item editor, or count-in. Reorder (sets the walk order; same ▲/▼ Reorder mode as F9) — anyone. Rename (updates every item that uses it) and remove — PIN required. Removing a location that items use shows how many and requires choosing a replacement location or "No location" first. Duplicate names are rejected (case-insensitive). Location pickers list locations in walk order, with recently used locations as quick picks |
| F26 | Helper devices and count import | Several devices count at once without a server. The main tablet assigns groups to named helpers and sends each a count kit. Helpers (tablets or phones) run a count-only mode and send back a cumulative counts file. The main tablet imports it with a preview, conflict choices, review of new items and an undo. Full rules in §18. No PIN required |
| F27 | Named order lists | On the Order screen, **Automatic** (F12, every item that needs ordering) sits beside any number of **named lists**. **Create** a list (name, optional notes). **Add items** with "Add to order list" from an item row (row menu), the detail card (F10) or a scan result (F21): pick a list (or "+ New list…") and a quantity, defaulting to the item's suggested order quantity (§4) when it needs ordering, otherwise one pack. Adding an item already on the list updates its quantity, after asking. **Add many at once** (Dan, 2026-10-23): checkboxes on the Automatic list's lines (with "Select all shown", so a search such as "andymark" then Select all picks one supplier's lines), and **Add to order list…** in the Inventory Select mode (F28) beside Move to…. The dialog picks a list (or "+ New list…") and how quantities are worked out: **up to desired + spares** (the suggested order quantity), **up to desired only**, or **one pack each**, rounded up to whole packs as in §4. Items already at that target are skipped, and the dialog says how many. If some are already on the list, it asks once whether to replace their quantities or keep them. Quantities can then be changed per line. **A list** shows lines grouped by preferred supplier, with packs, order qty, pack price, line totals, supplier subtotals and a grand total worked out as in §4. It has the same "no price" and stale-price flags as F12, quantity +/− and remove per line, search (as F12), and Export CSV / Export shown lines only (F13 columns; the list name in the filename and the first row). **Rename, duplicate, delete** a list (delete asks to confirm). **Inventory is never changed by a list:** there's no "on order" status; when parts arrive, students add them to on-hand by hand (F3/F7). A deleted item is removed from every list (the delete confirmation says how many lists it was on). No PIN required. Order lists are kept in full backups (`order-lists.csv`, §7) |
| F28 | Bulk move | In the inventory list (and in search or filter results), **Select** turns on checkboxes on item rows and group headers, plus "Select all shown". **Move to…** picks a category and subcategory (or "+ New subcategory…", "+ New category…"). The confirmation shows how many items move and from where ("Move 12 items to Fasteners › Bolts?"). One step, saved together. No PIN required (students can already change an item's category, F7) |

## 6. Mentor PIN

- 4–6 digit PIN set by a mentor on first launch; stored hashed on the device.
- Required for: removing items (F8), removing/renaming categories (F9), editing vendor/price fields including changing the preferred vendor (except vendor option 1 while adding a new item, F6), managing suppliers (F23), renaming/removing locations (F25), restoring from backup, price-update import, changing settings (backup reminder period, default 7 days; stale-price age, default 90 days; unlock length, default 5 minutes) and changing the PIN.
- Not required for: adding items (including the first vendor option of a new item), adjusting counts, count-in (F24), editing desired/spares/location/notes/photos/barcode (including attaching a barcode from Scan), adding or reordering categories and locations, bulk moving items (F28), creating, editing and exporting order lists (F27), and everything in §18: setting up helpers, sending count kits, Import counts and Undo this import (Dan, 2026-10-19 13:53), and accepting, matching or discarding pending items.
- Helper devices have no PIN and can't unlock any PIN action. They can only do what §18.3 allows.
- Once entered, stays unlocked for the unlock length (default 5 minutes), then relocks. A lock button on every screen shows the remaining time and locks immediately when tapped.
- A one-time recovery code is shown at setup for a forgotten PIN.
- This prevents accidents, not determined tampering.

## 7. Backup formats

### CSV (data only, also inside the full backup)
One row per item. Vendor options flattened into column groups so the file opens cleanly in Excel or Sheets:

`id, name, category, subcategory, location, unit, on_hand, desired, spares, barcode, notes, source, preferred_vendor, photo_file, last_counted, counted_by, v1_supplier, v1_part_no, v1_url, v1_pack_size, v1_pack_price, v1_price_checked, v2_…, v3_…`

- `photo_file` is the photo's path inside the ZIP, e.g. `photos/st-0001.jpg` (blank if none).
- `last_counted` is an ISO 8601 date-time with offset (`2026-10-24T18:42-05:00`) or blank. A date-only value (`2026-10-24`, as written by v0.4–v0.7 files) is read as midnight local time that day. Files without this column (e.g. the starter catalog) import with it blank. `counted_by` is text or blank; files without it import blank.
- Import matches columns by header name, not position, so older files (without `last_counted` or `counted_by`) and hand-edited files still load.
- Notes with commas or line breaks are quoted correctly (tested).

### Full backup (ZIP)
`inventory.csv` + `suppliers.csv` (name, website, notes) + `locations.csv` (name, notes, order) + `categories.csv` (category, subcategory, order) + `order-lists.csv` (list_id, list_name, list_notes, item_id, quantity) + `pending-items.csv` (only if pending items exist) + `manifest.json` + `photos/<item id>.jpg` and `photos/<pending id>.jpg`.

- **`categories.csv`** has one row per category and subcategory, in list order; a category with no subcategories gets one row with a blank subcategory. `order` is the category's position. It keeps empty categories, empty subcategories and the custom order through a backup and restore. When it's missing (a data-only CSV, older ZIPs), categories are rebuilt from `inventory.csv` in first-appearance order. **Reading** also accepts the starter catalog's layout (`frc2408-starter-catalog-2026-10-21.zip`): a blank-subcategory row for every category, carrying the category's position, followed by its subcategory rows, whose `order` is the subcategory's position. In both layouts the category's position is taken from its first row, and subcategories keep the order of their rows.
- **`order-lists.csv`** has one row per line, and a row with a blank item_id for an empty list. When it's missing, the backup has no named lists.
- **`pending-items.csv`** has the same columns as §18.4 `new-items.csv` plus `helper_name`.
- **`manifest.json`** holds the app name and version, `savedAt` (date and time, ISO 8601) and the item and photo counts. Restore never requires it. The restore comparison (F17) takes the saved date from it; without it, from the timestamp in the file name, then the ZIP's file dates, else "unknown". A CSV-only restore uses the file name or "unknown". The tablet tracks its own last-change time for the "on this tablet now" side.

### Count kit and counts file
Helper-device file formats are defined in §18.2 and §18.4. They aren't backups and can't be used with Restore (F17). Restore rejects them with a message saying which screen uses them.

### Both
- Filenames include a timestamp, e.g. `inventory-backup-2026-10-17-1035.zip`.
- The PIN, settings and helper records (§3) are not included. The Supplier, Location and Category lists, order lists and pending items are data, not settings: they travel in `suppliers.csv`, `locations.csv`, `categories.csv`, `order-lists.csv` and `pending-items.csv`. A CSV-only restore rebuilds missing supplier names from the vendor columns and missing location names from the location column (appended to the end of the walk order) (F17).
- Export → restore must round-trip with no data loss (tested).
- Full backups with many photos are larger; Bluetooth transfer will be slower than Quick Share or Drive. The starter catalog's photos are about 6 MB.

## 8. Part photos

- Optional, one per item.
- Take a photo with the tablet camera or choose one from the gallery.
- Resized on the device to about 1024 px on the long side, JPEG, to keep storage and backups small.
- Thumbnail in the item row; full size on the detail card.
- Replace or remove a photo without the PIN.
- **Starter photos** come from the preferred vendor's product page (or the next vendor option that has one) and were resized to the same standard. They are the vendors' images, kept for identifying parts inside the team's app; don't republish them. Replace any of them with a photo of the team's actual part at any time.

## 9. QR labels

Select items (or a whole category/location) → choose a label layout → printable page → Android print dialog.

Each QR code encodes `2408:<item id>` (e.g. `2408:st-0063`). The prefix tells team labels apart from QR codes printed on vendor packaging. Labels use the id, not the name, so they keep working after an item is renamed. Locations are offered in walk order (F25).

| Layout | Label size | Per sheet (letter) | Label content |
|---|---|---|---|
| Avery 5160-compatible | 1" × 2⅝" | 30 | Small QR, name, location |
| Avery 5163-compatible | 2" × 4" | 10 | Large QR, name, location, part # |
| Avery 22805-compatible | 1½" × 1½" square | 24 | QR, short name |
| Plain paper grid | QR size 1", 1½", or 2" | Varies | QR, name, dashed cut lines |

Printing aids:
- **PDF route** (no printer on the tablet's network): in the Android print dialog choose **Save as PDF** with paper size **Letter**. Then print the PDF from a computer at **Actual size / 100%**, not "Fit", "Shrink oversized pages" or the printer's own scaling. The alignment nudge is saved per layout on the tablet, so any offset from the second printer is corrected there and then a new PDF is made.
- **Start position:** skip already-used labels on a partially used sheet.
- **Alignment nudge:** top/left offset in 0.5 mm steps, saved per layout.
- **Test print:** prints label outlines on plain paper to hold against a label sheet before using real labels.
- On-screen reminder to print at 100% / "actual size," since "fit to page" scaling misaligns labels.
- Label sizes must be checked against the actual package before building the layouts (Stage 4).
- Additional layouts can be added later as data, without code changes.

## 10. Price updates

Not automatic in v1. A browser app is blocked from reading other websites directly, vendors don't generally publish pricing APIs, and scraping their sites breaks whenever they change and may violate some sites' terms.

v1 approach:
1. Each vendor price carries a price_checked date; stale prices are flagged (F14).
2. One-tap link to check a price on the vendor's site (F11).
3. **Price refresh with Claude:** before ordering, export a data-only backup, give it to Claude in a desktop chat with web search, and ask it to check current prices for items on the order list. Claude returns a price-update CSV, imported with F18. Counts recorded since the export are not overwritten.
4. McMaster-Carr shows prices only to signed-in users, so McMaster options are added by the team (or in a price-refresh session where a mentor signs in).

## 11. Categories (team structure, Dan 2026-10-21 12:28, revised 12:54; editable in the app via F9 and F28)

| Category | Subcategories |
|---|---|
| Electrical | Control System · Sensors · Cameras · Speed Controllers · Motors · Servos · Batteries · Connectors · Cables/Wires · Power Distribution |
| Pneumatics | Accumulation · Cylinders · Fittings · Solenoids · Compressors · Tubing |
| Mechanical | Chassis · Structure · Brackets & Plates · Sheet Material · Bumpers · Wheels · Bearings · Bushings · Collars · Keys · Spacers · Hubs · Shafts · Adapters |
| Fasteners | Cable Ties · Nuts · Bolts · Screws · Pins · Retaining Clips · Rivets · Washers |
| Power Transfer | Gear Boxes · Chains · Belts · Gears · Pulleys · Sprockets · Linear Motion |
| Assemblies | — (complete units, e.g. full swerve modules, Climber in a Box) |
| Public Relations | Labels · Buttons |
| Programming | — |
| Tools | Hammers · Wrenches · Allen Wrenches · Sockets & Socket Wrenches · Power Tools · Wiring Tools · Specialty Tools |
| Safety | Safety Glasses · Gloves · First Aid · Fire Extinguishers |
| Misc | — |

- Categories and subcategories appear in this order. More can be added at any time (F9).
- Empty categories and subcategories are kept (they're in `categories.csv`).
- Placement rules from Dan:
  - control devices go in Electrical › Control System: controller, radio, gamepads, Pneumatic Hub, PDH/PDP, Mini Power Module, PCM, VRM-type modules;
  - fasteners include cable ties;
  - complete assemblies (a whole swerve module) go in Assemblies, while their parts and kits stay in their own categories.
- "Wiring Tools" and "Specialty Tools" were suggested by Claude for the starter tools and approved by Dan (13:00).
- The v0.5–v0.7 categories (Structure, Fasteners, Motion, …) are replaced. Every starter item was remapped; see `seed/category-mapping-2026-10-21.csv`. An existing install keeps its categories when upgraded (§18.7).

## 12. Starter catalog scope (delivered in Stage 2)

- 129 items, 168 vendor options, prices dated 2026-10-17. Seed file: `frc2408-starter-catalog-2026-10-21.zip` (full-backup format, §7, now with `categories.csv` and items remapped to the §11 categories; the 2026-10-17 seed used the old categories). Counts, prices and the $8,413.66 total are unchanged. Research details: `stage2-report.md`.
- Vendors in the seed: REV, AndyMark, CTRE, WCP, Thrifty Bot, Amazon, plus FIRST (as `other`) for SystemCore. VEX has no FRC product line on its store today; McMaster prices need a login (§10). Both remain in the Supplier list.
- Motor/controller platform: **NEO 2.0 with SPARK MAX** (NEO V1.1 is discontinued). NEO 550 for mechanisms.
- **Swerve:** team owns Thrifty Swerve TTB-SWERVE-8MM-8MM (regular/inverted, 8mm keyed drive and rotation, 25:1 azimuth). Plan: convert to NEO 2.0 (8mm 15T spline, same as Kraken X60 per REV documentation) using WCP-1011 — 12T, 20 DP, 14T center distance, SplineXS bore — for both drive and steering pinions (Dan's experience; matches Thrifty's 12T (14T CD) pinion). Thrifty's spline-bore pinion kits are listed as alternates. 8mm keyed spares kept for the existing motors.
- **Tank:** common tank drivetrain parts (wheels, tread, sprockets, chain tensioners, bearing plates).
- **Control system:** SystemCore (required for 2027; one per team in the Kickoff Kit) replaces the roboRIO, which is not in the seed.
- **Desired amounts:** recommended starting values for one competition robot plus a practice tank chassis; spares = 0. Adjust in the app. With on_hand = 0 the first order list totals $8,413.66, so count existing stock (F24) before relying on it.
- **Photos:** 128 of 129 items (SystemCore has none yet).
- **Locations and last_counted:** blank for every starter item. The seed has no `locations.csv` and no `last_counted` column; both import as empty (§7).
- Prices must be verified before ordering (F14, §10).

## 13. Out of scope for v1 (parked)

Usage log (who took what), competition pit-kit checklist, live multi-device sync (a server-backed shared database; file-based helper devices for counting are in v1, §18), helpers editing anything other than counts, locations, barcodes and new items, an "on order" status or automatic receiving for order lists (received parts are added to on-hand by hand, F27), automatic price scraping, inventory value on hand, budget limits, multiple photos per item, undo for deletions.

## 14. Development stages and platforms

| Stage | Work | Platform | Output | Status |
|---|---|---|---|---|
| 1 | Interview and spec | Claude chat (mobile OK) | This document | Done |
| 2 | Category list and starter catalog research | Claude desktop chat (web search, big-screen review) | Seed ZIP + report | Done 2026-10-17; seed remapped to the new categories 2026-10-21 |
| 3 | UI mockups at tablet size | Claude desktop chat | Interactive mockup canvas (67 artboards), `stage3-design-notes.md`, `stage3-verification.md` | Done 2026-10-17; helper-device screens (row 11) added 2026-10-19 (`docs/mockups/helper-screens/`) |
| 4 | Build | Claude Code in VS Code | Git repo, app, tests, GitHub Pages deployment | Done 2026-10-18 (milestones 1–10, built to v0.7) |
| 5 | Verification | Fresh Claude Code session + hands-on testing on the Tab S8 (including a real label print) | Review report checked against §5 acceptance criteria; fixes | Done 2026-10-21 (`docs/stage5-review.md`), except the real label-sheet print, which waits for labels to be bought |
| 6 | Changes and new features | Claude Code in VS Code | Updates; spec revised | v0.8 (§18.7) |

Recommended build order within Stage 4: data model and storage → item list, search, filters → add/edit/remove items, categories, suppliers, and locations → order math and order list → CSV/ZIP backup, restore, share → PIN → photos → QR labels and scanning → count-in → starter catalog load → offline/PWA install. (v0.7 was built in this order. The v0.8 changes are added afterwards as Stage 6 milestones; see §18.7.)

Stage 4 should use the Stage 3 mockup canvas as the visual reference and §17 for conventions.

## 15. Open questions

1. ~~Which Thrifty Bot swerve module version the team owns~~ — answered: TTB-SWERVE-8MM-8MM (Stage 2).
2. Which label sheets you end up buying (any of the §9 layouts work; others can be added). Still open: waiting on a team purchase decision (2026-10-18). Until then, labels are printed through the PDF route (§9; Dan, 2026-10-21 13:00).
3. ~~Test-fit NEO 2.0 with the WCP-1011 pinion~~ and 4. ~~Which robot radio is legal for 2027~~ — closed 2026-10-18: robot questions, not app questions (Dan). The starter catalog keeps its items; the team can edit them in the app.
5. ~~Stage 3 proposals S2, S4–S11~~ — approved 2026-10-17 15:34 and written into v0.5 (F7, F9, F14, F16, F17, F18, F21, F25, §2, §6, §9).
6. ~~Approve the helper devices and other proposal changes (§18, F26–F28)~~ — approved 2026-10-21 13:44 (Dan: "yes to all"). The four details Claude decided in the claude.ai proposal, as approved:
   - (a) The safety net for a no-PIN import is a built-in **Undo this import**, not an automatic backup file. A web app can't save a file on its own without the share sheet.
   - (b) Helpers can't edit desired, spares, notes, vendor fields or the photos of existing items.
   - (c) The new category mapping (revised 12:54): 10 starter items are still marked for a check in `category-mapping-2026-10-21.csv` (small either/or placements; Claude's choice stands unless Dan changes it).
   - (d) F27 order-list details Claude filled in: the default quantity, adding the same item twice, and deleting an item that's on lists.
7. ~~Approve the merge decisions (2026-10-21, `docs/spec-merge-plan.md`)~~ — approved 2026-10-21 13:44 (Dan: "yes to all"). Claude Code's choices where the proposal and v0.7 differed or the proposal left a gap, as approved:
   - (a) F22: the shop-tablet / helper question comes first, and the shop tablet keeps all three setup choices (starter catalog, restore a backup, start empty).
   - (b) `categories.csv`: backups keep the v0.7 layout; reading accepts both it and the new seed's layout (§7).
   - (c) Upgrading doesn't remap an existing install's categories; the new categories come with a fresh setup or a restore (§18.7).
   - (d) Restore: a full backup replaces order lists and pending items; a CSV-only restore keeps them and drops order-list lines for items that no longer exist; either clears Undo this import (F17).
   - (e) Helper mode keeps its data in its own database on the device, separate from a main tablet's (§18.7).
   - (f) A schema-version check ships before the first database upgrade (§18.7; Stage 5 review finding 6).
   - (g) Imported helper counts join the current count round by their counted_at date (F24).

## 16. Decision log

| Timestamp (CDT) | Decision |
|---|---|
| 2026-10-17 07:42 | Feature list received: CSV, Bluetooth sharing, collapsible categories, FRC starter catalog, inventory/desired/cost/supplier, order list |
| 2026-10-17 09:28 | Students edit on one tablet; Bluetooth = send backup; location optional; desired = current needs; order list CSV grouped by supplier; multiple vendors per item with totals; no existing data; add QR/barcode scanning, highlighting/filtering, part numbers with links, search |
| 2026-10-17 10:33 | Add spares column, included in order quantity; mentor PIN for delete, prices, restore; app generates QR labels; order quantity rounds up to pack size; order totals only; all eight vendors; NEO + SPARK MAX; drivetrain undecided; lean catalog; weekly backup reminder |
| 2026-10-17 10:35 | PWA proposed as app type (pending confirmation); IndexedDB as live storage with CSV for import/export; automatic price scraping deferred in favor of Claude-assisted price refresh |
| 2026-10-17 10:52 | Items must be addable/removable (including starter items); notes field; optional part photos; multiple label-sheet sizes for a regular printer; tablet not school-managed; catalog covers both swerve and tank, team owns Thrifty Bot swerve modules; desired/spares not PIN-protected; app name "FRC 2408 Inventory Management"; defaults confirmed (3 vendors, 90-day stale price, 5-min PIN unlock, preferred vendor behind PIN) |
| 2026-10-17 10:57 | PWA confirmed as app type |
| 2026-10-17 10:58 | v0.2: photos added via ZIP full backup; category management added; label layouts with start position, alignment nudge, and test print |
| 2026-10-17 11:23 | Stage 2 delivered: module identified (TTB-SWERVE-8MM-8MM); categories finalized; 125-item seed; findings: NEO V1.1 discontinued, NEO 2.0 spline shaft, SystemCore replaces roboRIO for 2027, VEX has no FRC line, McMaster prices need login |
| 2026-10-17 11:37 | Recommended starting desired amounts in the seed; move swerve to NEO 2.0 with spline pinions; keep pneumatics; add McMaster options later; suppliers must be addable/removable (F23); include vendor product photos in the seed |
| 2026-10-17 11:39 | Dan suggested a WCP spline adapter for the pinions; none found in WCP's catalog or SplineXS docs; Thrifty spline-bore pinion kits used instead (can add a WCP option if a part number turns up) |
| 2026-10-17 11:45 | v0.3: supplier management, suppliers.csv in full backup, starter photos, Stage 2 results |
| 2026-10-17 11:46 | Dan: WCP 12T steel spur gear with 8mm SplineXS bore works as the NEO 2.0 swerve pinion → WCP-1011 (14T center distance) added as st-0129 for drive and steering; Thrifty spline kits kept as alternates (desired 0) |
| 2026-10-17 12:07 | Stage 3 design direction: light theme; adaptive navigation (side rail in landscape, bottom tabs in portrait); logo rust for chrome only, with stock status in its own red/amber plus icon and word |
| 2026-10-17 12:39 | Quick-adjust number labeled "On hand" everywhere; mockup demo data uses on_hand = 0 (real starter state) |
| 2026-10-17 14:43 | Stage 3 questions answered: (1) vendor option 1 open while adding an item — yes; (2) count-in goes into the spec with all three modes, nothing cut → F24 + last_counted; (3) delete keeps the confirmation dialog only, no undo; (4) destructive buttons become black with a red outline; (5) label sheets still open; (6) locations become a managed list → F25 |
| 2026-10-17 14:50 | v0.4: F24 count-in, F25 locations, last_counted field, locations.csv, F6/F8/§6 updates, §17 UI conventions. PIN policy for locations follows categories (add/reorder open; rename/remove need PIN) — Claude's default, confirm or change |
| 2026-10-17 15:34 | Dan approved all remaining Stage 3 proposals (S2, S4–S11) |
| 2026-10-17 15:40 | v0.5: S2 barcode without PIN; S4 banner placement/snooze; S5 QR format; S6 restore confirmation; S7 all-or-nothing price import; S8 ▲/▼ reorder; S9 named settings; S10 stale summary banner; S11 storage status and error screen |
| 2026-10-18 | Dan (after the M9 review): recounts should show their own progress, using "counted since <date>" → F24 count rounds |
| 2026-10-18 | v0.6: F24 count rounds |
| 2026-10-18 | Dan: write the approved Q3 (`categories.csv`) and Q8 (`manifest.json`) into the spec; label sheets wait for a team purchase decision; §15 items 3 (NEO 2.0 test fit) and 4 (robot radio) closed as not app questions |
| 2026-10-18 | v0.7: Category list in §3; `categories.csv` and `manifest.json` in §7; §15 updated |
| 2026-10-19 13:23 | (claude.ai) Dan asked about running on several tablets for the initial count. Options compared: file-based split and merge (A) vs. server-backed live sync (B) |
| 2026-10-19 13:47 | (claude.ai) Dan chose to explore option A (helper devices with a count kit, counts file and Import counts on the main tablet) |
| 2026-10-19 13:52 | (claude.ai) Helpers can add items not in the catalog (e.g. other motor controller models); they arrive as pending items for review on the main tablet |
| 2026-10-19 13:53 | (claude.ai) Import counts needs no PIN; students' phones can be helpers |
| 2026-10-19 13:57 | (claude.ai) Dan: the app is built through milestone 10 and was in Stage 5 testing. The helper devices become a Stage 6 change to the existing build (§18.7) |
| 2026-10-19 13:59 | (claude.ai) Dan: the tablet has a PIN and test data only; no real count yet. Plan: start fresh after the change and do the first real count with helpers (§18.7) |
| 2026-10-19 | (claude.ai) Proposal drafted, written there as "v0.6 draft" from v0.5: §18 helper devices, F26, F24 update, `last_counted` as date-time, `counted_by`, Helper and Pending item records, `pending-items.csv`, phone support for helper mode. Not the same as this repo's v0.6 (count rounds) |
| 2026-10-21 11:58 | (claude.ai) Stage 5 B4 passed (stale flag confirmed 12:28). Share sheet: email queued in the Gmail outbox, not sent; Bluetooth and Drive didn't transfer, likely tablet setup (checking). Dan requested: new categories, bulk move, named order lists, order-list search, supplier filter last |
| 2026-10-21 12:28 | (claude.ai) Categories set (§11), more allowed; bulk move yes; order lists: named lists, add from row / detail / scan, no "on order" status, received items added by hand; order search exports everything by default plus "shown lines only" |
| 2026-10-21 12:54 | (claude.ai) Stage 5: share sheet fixed (tablet network); B10 full backup, data-only backup, restore and price import passed. Categories revised: new Fasteners (bolts, screws, nuts, washers, rivets, cable ties…), Assemblies (full swerve modules, Climber in a Box…), Electrical › Cameras, gamepads and Pneumatic Hub/PDH/PCM/VRM-type devices in Control System, Pneumatics › Compressors and Tubing, Tools (hammers, wrenches, Allen wrenches, sockets, power tools…), Safety (safety glasses, gloves, first aid, fire extinguishers…) |
| 2026-10-21 13:00 | (claude.ai) Wiring Tools and Specialty Tools kept; Mini Power Module → Electrical › Control System. Stage 5 B5 and B6 passed. Labels not bought yet and no network printer: labels will be saved as a PDF, emailed and printed from another computer (§9) |
| 2026-10-21 13:40 | Claude Code: the proposal (`docs/proposals/2026-10-21-claude-proposal.md`) merged into v0.7 as the v0.8 draft. No F-number or section clashes (proposal adds F26–F28, §18, §19). Kept from v0.6/v0.7: count rounds, `manifest.json`, the `categories.csv` layout, the Category table, closed §15 Q3/Q4. Merge decisions listed in §15 Q7. Details: `docs/spec-merge-plan.md` |
| 2026-10-21 13:40 | v0.8 draft: F26 helper devices (§18), F27 named order lists, F28 bulk move, F12 order search, F5 filter order, §11 categories and remapped seed, `last_counted` date-time and `counted_by`, `order-lists.csv` and `pending-items.csv`, §9 PDF route, F22 setup choices, §18.7 upgrade, §18.6 and §19 tests. Awaiting approval (§15 Q6, Q7) |
| 2026-10-21 13:44 | Dan: §15 Q6 (a)–(d) and Q7 (a)–(g), yes to all. The 10 flagged placements in `category-mapping-2026-10-21.csv` stay as Claude chose |
| 2026-10-21 13:46 | Dan: "Approved. Make SPEC-next-draft.md the new docs/SPEC.md." v0.8 approved and made `docs/SPEC.md` |
| 2026-10-23 | Dan (after M14 on the tablet): build a custom order by selecting many items with checkboxes, e.g. only AndyMark, ordering up to desired rather than desired + spares. F27 gains "Add many at once": checkboxes on the Automatic list and Add to order list… in Inventory Select mode; the quantity rule (desired + spares / desired only / one pack) is chosen each time. The Automatic list stays desired + spares. Built as M15b, after M15 |

## 17. UI conventions (from Stage 3)

Reference: Stage 3 mockup canvas and `stage3-design-notes.md`. Helper-device and import screens: `docs/mockups/helper-screens/` (they show the old category names; follow §11).

- **Navigation:** six destinations — Inventory, Order, Scan, Count, Labels, More. Side rail in landscape (1280 × 800 CSS px); bottom tabs in portrait. Suppliers, Categories, Locations, Backup/Restore/Price import and Mentor PIN & settings live under More.
- **Theme:** light. Ground #F2EFEA with white cards; text #1A1411; secondary text #4A403A.
- **Brand color:** logo rust (#8A3315) and dark rust-brown rail (#2E1710) for chrome and primary buttons only. Never used to show stock status.
- **Stock status:** every status uses color, icon and word together.
  - Short: red #B3122E fill, octagon icon, "SHORT n".
  - Low spares: amber #F5B700 fill, triangle icon, "LOW SPARES".
  - OK: outline, check icon, "OK".
  - Row tints are supplementary. Category headers show "n short" / "n low spares" / "All stocked".
- **Destructive actions** (delete item, replace everything on restore, remove supplier/category/location): **black button with a red outline**, a trash or warning icon, and the action spelled out ("Delete item", "Replace everything"). Never a red fill, so they can't be mistaken for status badges.
- **PIN:** navy (#1F3A5F). A lock button on every screen shows "Locked" or "Unlocked m:ss". Locked fields are dashed blue-gray with a lock in the label. A PIN prompt says why it's needed and continues the action after unlocking.
- **Banners:** navy for information (backup reminder, count-in progress); light amber for attention (stale prices). Never red.
- **Sizes:** all touch targets ≥ 48 px. Primary actions 56–64 px; steppers 64 px in lists and 80 px on detail, scan and count-in; keypad keys 68–72 px. Text ≥ 15 px; item names 19 px; counts 26–64 px.
- **Fonts:** Barlow Condensed (headings, numbers) and Atkinson Hyperlegible (body), both SIL OFL, bundled for offline use.
- **States:** every list or import screen has empty, loading and error states with one clear next step.
- **Helper mode:** a navy bar at the top of every helper screen reads "HELPER · <name>" with the assigned groups, so a helper is never mistaken for the main tablet. Three bottom tabs: Count, Scan, Send. On phones (360–430 CSS px wide) the count-in keypad keys are at least 64 px, steppers 64 px, and nothing scrolls sideways.
- **Pending items** carry a dashed outline "PENDING" chip (never a status color), the same style as other not-yet-real things.

## 18. Helper devices and count import (F26)

**Purpose:** let several students count at once, mainly for the first full inventory, without a server. The main tablet stays the only full copy of the inventory. Helpers are temporary counting devices that hold a copy made for one counting effort.

**Roles**
- **Main tablet:** the shop tablet set up with "Set up the shop tablet" (F22). It has the PIN, the full inventory and backups.
- **Helper device:** any tablet or phone that joined with a count kit. It can count, set locations, attach barcodes and propose new items. It has no PIN, order list, prices, backups or settings.

### 18.1 Setting up helpers (main tablet)
Count-in start screen → **Helper devices**.
- **Add helper:** name (unique), groups to count (categories, or locations once they exist; one kind per helper) and **Allow new items** (on by default). The screen shows every group with the helper(s) assigned to it and highlights unassigned groups. Assigning one group to two helpers is allowed after a warning ("both will count it; you'll settle differences on import").
- **Send count kit:** builds the kit (§18.2) and opens the share sheet (Quick Share, Drive, email, Bluetooth, USB). **Include photos** is on by default (about 6 MB for the starter catalog); turn it off for slow transfers. A kit can be re-sent at any time. Each send gets a new kit id and records `last_kit_at`.
- **Edit / remove helper:** changing groups or the new-items setting takes effect in the next kit. The name can't be changed once a kit has been sent, because imports use it to recognize the helper's earlier counts; create a new helper instead. Removing a helper doesn't touch counts already imported.

### 18.2 Count kit and joining (helper)
**Kit file:** `count-kit-<helper name>-<yyyy-mm-dd-hhmm>.zip` containing:
- `kit.json`: format version, kit id, helper id, helper name, created at (date-time), main tablet's app version, assigned groups (kind + names), allow_new_items.
- `inventory.csv`: §7 format, with `v*_pack_price` and `v*_price_checked` left blank (helpers don't need prices).
- `suppliers.csv`, `locations.csv`, `categories.csv`, and `photos/` (optional).

**Joining:** on the helper, first launch → **Join as a helper** → choose the kit file. The helper shows its name and groups and is ready to count. If the helper already holds counts that haven't been sent, opening a new kit asks to **Send my counts first** or **Discard unsent counts** (destructive style, §17). **Leave helper mode** (on the Send screen) clears all helper data after the same check and returns to the first-launch choice.

### 18.3 Counting on a helper
- **Count** uses the F24 screens (by category / by location / scan as you go), showing only the assigned groups. Any item can still be found by search or scan. Counts outside the assignment are allowed and are flagged on import.
- **A helper may change:** on_hand (the count), location (including "New location…", F25) and barcode (attach from Scan, F21).
- **A helper may not change:** desired, spares, notes, photos of existing items, category, vendor fields. It also can't delete items or manage suppliers, categories or locations. The order list isn't shown.
- **Add item not on the list** (only if the kit allows new items; from the count screen and from an unknown scan):
  - Required: name, category, unit, on hand.
  - Optional: subcategory (existing or new), location, photo, barcode, notes, desired (default 0) and vendor option 1 (supplier from the list, part #, link, pack size, price).
  - The item is saved as **Pending** with a temporary id (`pending-<helper id>-<n>`). Pending items can't get QR labels until they're accepted on the main tablet.
- Every saved count records `counted_at` (date-time with offset).

### 18.4 Sending counts (helper)
Send tab → **Send my counts** builds `counts-<helper name>-<yyyy-mm-dd-hhmm>.zip` and opens the share sheet:
- `counts.json`: format version, kit id, helper id, helper name, created at, file sequence number, app version.
- `counts.csv`: `item_id, on_hand, counted_at, location, barcode, outside_assignment`. One row per item counted or changed since the kit was opened, with its latest values. Blank location or barcode means unchanged.
- `new-items.csv`: `pending_id, name, category, subcategory, unit, on_hand, desired, location, barcode, notes, photo_file, counted_at, v1_supplier, v1_part_no, v1_url, v1_pack_size, v1_pack_price`.
- `locations-new.csv`: `name` for locations created on the helper.
- `photos/<pending id>.jpg` for new items with photos.

Each file is **cumulative**: it always carries everything since the kit, so a lost file is covered by the next one and sending again is always safe. The Send screen shows "Last sent <time> · n changes not sent yet". A navy banner on the Count screen reminds the student to send when unsent changes exist. Phones, iPhones in particular, may clear website data after several days without use, so helpers should send at the end of every session.

### 18.5 Import counts (main tablet)
From the Count-in start screen or the Backup screen → **Import counts** → choose one or more counts files. No PIN.

**1. Check.** Each file is checked as a whole before anything changes, as with F18: format, required columns, numbers ≥ 0, valid dates. A file that fails is rejected with the reasons and nothing from it is used. A file from a kit this tablet didn't make (unknown kit or helper id) shows a warning and can be imported anyway; item ids are matched as usual. Restore files and kit files are rejected with a pointer to the right screen.

**2. Preview.** Nothing is saved yet. Every incoming row is sorted into these groups:

| Situation | Rule | Shown as |
|---|---|---|
| New count | Item's last count on this tablet is older than the kit, or was made by the same helper earlier | **Will apply** |
| Already applied | Same helper and same counted_at as this tablet's last count | **Skipped** (not listed one by one) |
| Same number | Values match the current on_hand | Applied quietly; last_counted takes the newer time |
| Conflict | The item was counted on this tablet or by another helper after the kit was made, and the numbers differ | **Needs a choice:** both numbers, who counted, when. Choose **Keep this tablet's**, **Use helper's**, or **Add together** (stored in two places). **Use newest for all** settles every conflict at once |
| Outside assignment | Counted by a helper not assigned that group | Will apply, marked for a glance |
| Unknown item | The item id no longer exists here (deleted since the kit) | **Skipped**, listed |
| Location | Applied if the item has no location here. If the item already has a different one: **Keep** or **Use helper's** | In the item's row |
| Barcode | Applied if the item has no barcode here. A different existing barcode: **Keep** or **Use helper's** | In the item's row |
| New location name | A name matching an existing one (ignoring capitals) is merged. Any other name is listed with **Add** (default; goes to the end of the walk order) or **Same as…** an existing location, which covers a location renamed on this tablet after the kit was sent | Listed |
| New item | Becomes a pending item | **New items** section |

When several files are imported together, they're applied in order of counted_at, and conflicts are checked between files as well as against this tablet. Times come from each device's own clock; "Use newest for all" trusts them, so a phone with a wrong clock can mislead it. The preview shows each time so a mismatch is visible.

**3. Apply.** **Apply n counts** is enabled once every conflict has a choice. All changes are saved together; if anything fails, nothing is saved. Applied counts set on_hand, last_counted (= the helper's counted_at) and counted_by (= the helper's name). Pending items are stored for review.

**4. Summary.** Shows counts applied, skipped, conflicts settled, outside assignment, new items waiting, and the order-list total before → after. Buttons: **Review new items**, **Back up now**, **Undo this import**.

**Undo this import.** Before applying, the app records the previous on_hand, location, barcode, last_counted and counted_by of every changed item, plus the locations and pending items the import created. **Undo this import** (on the summary, and on the Backup screen until the next import or restore) puts them all back and removes those locations and pending items. Locations are removed only if no item uses them yet. Items already accepted from pending stay; delete them normally if needed. It's a confirmation dialog in destructive style (§17). Undo replaces a PIN for this action: a bad file can always be reversed.

**Pending items: review.** From the summary or **Pending from helpers (n)** on the Count-in start screen:
- **Accept:** opens the Add item form (F6), filled in with the helper's fields and photo. The item gets its real id when saved. Vendor option 1 is open while adding, as in F6, and prices can be added later by a mentor.
- **Same as an existing item:** pick the item. Then choose **Use as the count** or **Add to the count** (stored in two places). The pending item is removed and the existing item's last_counted / counted_by are updated.
- **Discard:** removes it (confirmation).
- **Likely duplicates** are flagged: pending items with the same barcode as each other or as an existing item, or with nearly the same name. Two pending items can be **combined into one** (add counts or keep one) before accepting.
- Pending items can wait. They stay in the list and travel in full backups until decided.

### 18.6 Must-have tests for §18 (Vitest)
- Every row of the §18.5 preview table, including a conflict between two helpers and the same helper sending twice.
- Importing the same counts file twice changes nothing the second time.
- Several files imported together give the same result in any order.
- Undo restores every changed field exactly and removes created locations and pending items.
- A file that fails the check changes nothing.
- Kit → helper → counts file → import round-trip, with notes containing commas and line breaks, photos on new items and a new location.
- Date-only `last_counted` values from older files are read correctly.
- Imported counts follow the count-round rule (F24): a count with counted_at on or after the "counting since" date counts toward the round; an earlier one doesn't.

### 18.7 Upgrading the existing v0.7 build (Stage 6)
v0.7 is built (milestones 1–10) and verified in Stage 5. v0.8 is added to that build, not built from scratch.
- **Order of work:** finish Stage 5 first: fix its findings, then tag the verified build `stage5-verified`. Build each v0.8 milestone on a separate branch and merge it only when its own verification passes. This keeps Stage 5 fixes and v0.8 features apart and leaves a known-good version to go back to.
- **Separate milestones:** build the other v0.8 changes (F5 filter order, F12 search, F28 bulk move, categories, F27 order lists) as their own milestones, separate from helper devices, so each can be tested and merged on its own. Suggested order: F5 → categories (§11, `categories.csv`) → F28 → F12 search → F27 → helper devices (F26).
- **Schema-version check first:** before the first database upgrade ships, the app records its schema version in the database. An app older than the database it finds shows a "reload to update" screen and saves nothing, so an old cached copy can't write old-format data into an upgraded database (Stage 5 review finding 6).
- **Database upgrade:** a new Dexie schema version that:
  - adds the Order list, Helper, Pending item (and pending-photo) and import-undo stores, and the `counted_by` field. The Category store already exists (v0.7);
  - converts existing `last_counted` dates to date-times at local midnight, with the UTC offset for that date;
  - changes nothing else. It doesn't remap item categories to the new §11 list; the new categories come with a fresh "Set up the shop tablet" or a restore, and an upgraded tablet can be changed by hand (F9, F28).
  Export a full backup from the tablet before installing v0.8; that backup is the way back. Test the upgrade against a copy of real tablet data, not only fresh seed data.
- **Helper data is kept apart:** a helper device keeps its kit, counts and new items in its own database, separate from the main tablet's inventory database, so a helper is never taken for a main tablet and **Leave helper mode** can clear it completely.
- **Count timing across the upgrade:** an item counted on the main tablet before the upgrade has a last_counted of midnight that day, so a helper count from a kit made later that same day reads as newer even if the tablet's count came after the kit. This only affects counts made before the upgrade; the fresh start below avoids it.
- **Current tablet (2026-10-19):** it holds only a PIN and test data; no real count has started. Plan: once v0.8 is installed, clear the app's data and set the tablet up fresh with "Set up the shop tablet" (new PIN and recovery code, starter catalog). Start the real first count after that, using helpers. Keep the database upgrade anyway: it's small, it protects any other test installs, and every later version will need the same pattern. Testing it against the current test data is enough.
- **Existing installs:** a device that already has an inventory database is the main tablet. The first-launch question (F22) appears only on a fresh install.
- **Older files:** v0.4–v0.7 backups restore into v0.8 unchanged (columns are matched by header, §7). Don't restore a v0.8 backup into a v0.7 build.
- **File versions:** `kit.json` and `counts.json` carry a format version. A helper refuses a kit with a newer format than it understands, and the main tablet refuses such a counts file. The message says to reload the app to get the latest version. Helpers load the app from the same web address, so a reload brings them up to date.
- **Regression:** all existing tests must still pass. The screens v0.8 touches are F22 (first launch), F24 (count-in start screen), F15/F17 (backup and restore with the new columns, `order-lists.csv` and `pending-items.csv`) and shared components that gain phone layouts: keypad, stepper, Add item form. Re-run the Stage 5 checks for those features after the change, and compare tablet screenshots before and after so the phone layouts don't shift the tablet layout.

## 19. Must-have tests for the other v0.8 changes (Vitest)
- **Categories:**
  - the seed loads the §11 categories in order, including empty subcategories;
  - the 2026-10-21 seed's `categories.csv` (a blank-subcategory row for every category) and a v0.7 backup's `categories.csv` both load with the right category and subcategory order;
  - a backup without `categories.csv` builds categories from the items;
  - the backup → restore round-trip keeps empty categories and their order.
- **Bulk move (F28):** moving n selected items changes only their category and subcategory, is saved all at once, and reports the right count. Creating a new subcategory while moving works.
- **Order search (F12):**
  - the filter matches name, part #, supplier and notes;
  - "Showing n of m" and the shown total are right;
  - Export CSV contains every line;
  - Export shown lines only contains exactly the filtered lines, with the note row.
- **Named order lists (F27):**
  - the default quantity follows §4 (suggested order quantity, or one pack);
  - adding many at once: each quantity rule (desired + spares, desired only, one pack) with pack rounding; items already at the target skipped and counted; replace or keep for items already on the list;
  - pack rounding and totals match §4;
  - the no-price line is left out of the total;
  - deleting an item removes it from every list;
  - order lists never change on_hand, desired, spares or the automatic list;
  - the `order-lists.csv` round-trip keeps empty lists too;
  - a full restore replaces order lists and pending items; a CSV-only restore keeps them and drops lines for items that no longer exist.
- **`last_counted` as date-time:**
  - count rounds (F24) give the same progress for date-time values as for the old dates, including an item counted late on the evening before the "counting since" date (not counted) and one on that date (counted);
  - the database upgrade converts dates to local midnight with the right offset on both sides of a daylight-saving change, keeps blank values blank, adds blank `counted_by`, and changes no other field;
  - an older app opening an upgraded database refuses to save (schema-version check).
