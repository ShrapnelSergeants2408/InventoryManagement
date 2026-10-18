# FRC 2408 Inventory Management — Specification v0.6

**Team:** FRC 2408 · **Owner:** Dan · **Target device:** Samsung Galaxy Tab S8 (Android, Chrome, not school-managed)
**Status:** Draft for review · **v0.1:** 2026-10-17 10:35 CDT · **v0.2:** 2026-10-17 10:58 CDT · **v0.3:** 2026-10-17 11:45 CDT · **v0.4:** 2026-10-17 14:50 CDT · **v0.5:** 2026-10-17 15:40 CDT · **v0.6:** 2026-10-18 CDT

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

A shop inventory tool for the robotics team. Students use one shared tablet to look up parts, add parts, adjust counts, and see what needs ordering. Mentors control deletions, pricing, suppliers, and restores with a PIN. The app produces an order list grouped by supplier.

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

## 3. Data model

### Item
| Field | Required | Notes |
|---|---|---|
| id | yes | Auto-generated, stable; encoded in QR labels. Starter items use `st-0001`…; team-added items get new ids |
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
| last_counted | no | Date on_hand was last confirmed by a physical count (F24). Blank for starter items until counted. Set when an item is saved in count-in, and when a new item is added (the on-hand amount entered when adding counts as a count) |
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
| F5 | Filters | Needs order · Red only · Yellow only · by category · by supplier · by location |
| F6 | Add item | Anyone can add a new item to any category, including new subcategories; same form as edit. While adding, vendor option 1 (supplier, part #, link, pack size, optional price) can be filled in without the PIN, so a student can save the item; once saved, vendor fields lock behind the PIN like any other item (§6) |
| F7 | Edit item | Students can edit counts, location, desired, spares, notes, photo, category, and barcode (type it or scan it in); vendor/price fields need the PIN (§6) |
| F8 | Remove item | Delete any item, starter or team-added (PIN required; confirmation step shows item name and on-hand count). No undo: the confirmation step is the only safeguard, and recovery is by restoring a backup |
| F9 | Manage categories | Add, rename, and reorder categories and subcategories (Reorder mode with large ▲/▼ buttons, so it works with gloves; drag is optional); removing one requires it to be empty or its items moved first (PIN required for remove/rename) |
| F10 | Item detail card | Full notes, photo (tap to enlarge), all vendor options with links, +/− buttons |
| F11 | One-tap supplier link | Opens the vendor product page in the browser |
| F12 | Order list | Lists every item with order_qty > 0, grouped by preferred supplier, with a subtotal per supplier and a grand total; view on screen and export CSV. While any item has never been counted (blank last_counted), a banner shows count-in progress and warns that uncounted items are treated as 0 on hand |
| F13 | Order list CSV | Columns: Supplier, Part #, Item, Unit, Need, Pack size, Packs, Order qty, Pack price, Line total, Price checked, URL, Notes; a subtotal row after each supplier; grand total at the end |
| F14 | Stale price flag | Prices with price_checked older than the stale-price age (setting, default 90 days) are marked on each order-list line ("Price n days old"). When more than half of the priced lines are stale, a summary banner also appears at the top of the order list with the price-refresh steps (§10) |
| F15 | Backup export | Two choices: **Full backup** (ZIP: CSV + suppliers + locations + photos) or **Data only** (CSV). Opens Android's share sheet (Bluetooth, Quick Share, email, Drive) |
| F16 | Backup reminder | Banner appears on the Inventory (home) and Backup screens if no backup of either kind has been exported within the reminder period (setting, default 7 days). "Later" hides it until the next app launch. Exporting either kind of backup resets the clock |
| F17 | Restore | Accepts a full-backup ZIP or a CSV; replaces all inventory (PIN required; confirmation step). The confirmation compares "on this tablet now" with "in the backup" (item and photo counts, last change / saved date), offers **Back up this tablet first**, and enables **Replace everything** only after an "I understand this replaces everything" box is ticked. A CSV-only restore keeps existing photos for matching item ids. Supplier and location names in the restored data that aren't in their lists are added automatically |
| F18 | Price-update import | Imports a CSV that updates only vendor fields (price, pack size, URL, price_checked) for matching item ids; never touches counts. The whole file is validated before anything is saved: if any row fails (e.g. pack size not a whole number ≥ 1, unknown column), nothing changes and the errors are listed by row number; shows a summary of rows updated and ids not found (PIN required). Unknown supplier names are added to the Supplier list and listed in the summary |
| F19 | Part photos | Optional; see §8 |
| F20 | QR labels | See §9 |
| F21 | Scan | Camera button scans a QR label (`2408:<item id>`, §9) or stored manufacturer barcode and opens that item with +/− buttons. A bare item id or barcode can also be typed in (torn label, no camera). An unknown code offers to attach it to an existing item (no PIN) or add a new item with it |
| F22 | Starter catalog | First launch loads the starter catalog (§12) from its full-backup ZIP: on_hand = 0, recommended desired amounts, spares = 0, vendor product photos. Starter items can be edited or removed like any other item. After loading, the app offers to start count-in (F24) |
| F23 | Manage suppliers | Add a supplier (name, optional website and notes); rename a supplier (updates every vendor option and order-list group that uses it); remove a supplier: if any vendor options use it, show how many and require choosing a replacement supplier (default `other`) before removal; `other` can't be removed; duplicate names are rejected. Supplier pickers in the item editor list suppliers alphabetically with `other` last. PIN required for add, rename, and remove |
| F24 | Count-in mode | A guided walk-through for counting stock, built for the first inventory count and reusable for later recounts. **Modes:** by category (default; follows list order), by location (Location list order, then "No location"), or scan as you go (scanning a label or barcode opens the keypad for that item). **Start screen:** current order-list total, overall progress (counted of total), progress and Start/Continue/Recount per category or location, and two options: ask for a location while counting (on by default) and skip items with desired 0. **One item per screen:** photo, name, category, supplier and part #, desired and spares; large keypad with None (0), "= desired" and ±1; live preview of the resulting status (short / low spares / OK); optional location from the Location list, with "New location…" (F25); Back, Skip for now, and Save & next. **Saving** sets on_hand and last_counted immediately, so a count can stop and resume across meetings. **Group summary:** counted, short and skipped counts, order-list total before → after, and shortcuts to the next group, printing labels for that group, and backing up. **Count rounds:** progress, Start/Continue/Recount and the summary count an item as counted when its last_counted is on or after the "counting since" date. Blank (the default, for the first count) means counted at any time. **Start a new count** sets the date to today; it can be changed or cleared. Starting a round erases nothing: on_hand and last_counted stay as they are. The F12 banner still uses blank last_counted. No PIN required |
| F25 | Manage locations | Add a location (name, optional notes) — anyone, from the Locations screen, the item editor, or count-in. Reorder (sets the walk order; same ▲/▼ Reorder mode as F9) — anyone. Rename (updates every item that uses it) and remove — PIN required. Removing a location that items use shows how many and requires choosing a replacement location or "No location" first. Duplicate names are rejected (case-insensitive). Location pickers list locations in walk order, with recently used locations as quick picks |

## 6. Mentor PIN

- 4–6 digit PIN set by a mentor on first launch; stored hashed on the device.
- Required for: removing items (F8), removing/renaming categories (F9), editing vendor/price fields including changing the preferred vendor (except vendor option 1 while adding a new item, F6), managing suppliers (F23), renaming/removing locations (F25), restoring from backup, price-update import, changing settings (backup reminder period, default 7 days; stale-price age, default 90 days; unlock length, default 5 minutes) and changing the PIN.
- Not required for: adding items (including the first vendor option of a new item), adjusting counts, count-in (F24), editing desired/spares/location/notes/photos/barcode (including attaching a barcode from Scan), adding or reordering categories and locations.
- Once entered, stays unlocked for the unlock length (default 5 minutes), then relocks. A lock button on every screen shows the remaining time and locks immediately when tapped.
- A one-time recovery code is shown at setup for a forgotten PIN.
- This prevents accidents, not determined tampering.

## 7. Backup formats

### CSV (data only, also inside the full backup)
One row per item. Vendor options flattened into column groups so the file opens cleanly in Excel or Sheets:

`id, name, category, subcategory, location, unit, on_hand, desired, spares, barcode, notes, source, preferred_vendor, photo_file, last_counted, v1_supplier, v1_part_no, v1_url, v1_pack_size, v1_pack_price, v1_price_checked, v2_…, v3_…`

- `photo_file` is the photo's path inside the ZIP, e.g. `photos/st-0001.jpg` (blank if none).
- `last_counted` is an ISO date (`2026-10-24`) or blank. Files without this column (e.g. the v0.3 starter catalog) import with it blank.
- Import matches columns by header name, not position, so older files (without `last_counted`) and hand-edited files still load.
- Notes with commas or line breaks are quoted correctly (tested).

### Full backup (ZIP)
`inventory.csv` + `suppliers.csv` (name, website, notes) + `locations.csv` (name, notes, order) + `photos/<item id>.jpg`.

### Both
- Filenames include a timestamp, e.g. `inventory-backup-2026-10-17-1035.zip`.
- The PIN and settings are not included. The Supplier and Location lists are data, not settings: they travel in `suppliers.csv` and `locations.csv`. A CSV-only restore rebuilds missing supplier names from the vendor columns and missing location names from the location column (appended to the end of the walk order) (F17).
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

## 11. Categories (finalized in Stage 2; editable in the app via F9)

| Category | Subcategories |
|---|---|
| Structure | Tubing · Plate & Sheet · Brackets & Gussets · Bumpers |
| Fasteners | Bolts & Screws · Nuts · Rivets & Rivet Nuts · Washers |
| Motion | Shafts & Spacers · Bearings · Collars · Sprockets & Chain · Pulleys & Belts |
| Drivetrain | Swerve · Tank |
| Motors | — |
| Motor Controllers | — |
| Power & Electrical | Battery & Charging · Main Breaker & Distribution · Breakers & Fuses |
| Wiring & Connectors | Wire · Power Connectors · Terminals & Ferrules · Signal & CAN Cables · Heat Shrink & Wire Mgmt |
| Control System & Sensors | Controller & Radio · Encoders · Gyro & IMU · Switches & Sensors · Cameras · Driver Station |
| Pneumatics | Air Supply · Valves · Tubing & Fittings |
| Tools & Consumables | Consumables · Hand Tools |
| Pit & Safety | Safety |

## 12. Starter catalog scope (delivered in Stage 2)

- 129 items, 168 vendor options, prices dated 2026-10-17. Seed file: `frc2408-starter-catalog-2026-10-17.zip` (full-backup format, §7). Research details: `stage2-report.md`.
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

Usage log (who took what), competition pit-kit checklist, multi-device sync, automatic price scraping, inventory value on hand, budget limits, multiple photos per item, undo for deletions.

## 14. Development stages and platforms

| Stage | Work | Platform | Output | Status |
|---|---|---|---|---|
| 1 | Interview and spec | Claude chat (mobile OK) | This document | Done |
| 2 | Category list and starter catalog research | Claude desktop chat (web search, big-screen review) | Seed ZIP + report | Done 2026-10-17 |
| 3 | UI mockups at tablet size | Claude desktop chat | Interactive mockup canvas (67 artboards), `stage3-design-notes.md`, `stage3-verification.md` | Done 2026-10-17 |
| 4 | Build | Claude Code in VS Code | Git repo, app, tests, GitHub Pages deployment | Next |
| 5 | Verification | Fresh Claude Code session + hands-on testing on the Tab S8 (including a real label print) | Review report checked against §5 acceptance criteria; fixes | |
| 6 | Changes and new features | Claude Code in VS Code | Updates; spec revised | |

Recommended build order within Stage 4: data model and storage → item list, search, filters → add/edit/remove items, categories, suppliers, and locations → order math and order list → CSV/ZIP backup, restore, share → PIN → photos → QR labels and scanning → count-in → starter catalog load → offline/PWA install.

Stage 4 should use the Stage 3 mockup canvas as the visual reference and §17 for conventions.

## 15. Open questions

1. ~~Which Thrifty Bot swerve module version the team owns~~ — answered: TTB-SWERVE-8MM-8MM (Stage 2).
2. Which label sheets you end up buying (any of the §9 layouts work; others can be added). Still open as of 2026-10-17 14:43.
3. Test-fit NEO 2.0 with the WCP-1011 pinion on one module (shaft engagement, motor spacers, mounting pattern) before buying motors for all four.
4. Which robot radio is legal for 2027 (VH-109 v1.5 is out of stock at CTRE and AndyMark; WCP lists a Robot Radio V2).
5. ~~Stage 3 proposals S2, S4–S11~~ — approved 2026-10-17 15:34 and written into v0.5 (F7, F9, F14, F16, F17, F18, F21, F25, §2, §6, §9).

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

## 17. UI conventions (from Stage 3)

Reference: Stage 3 mockup canvas and `stage3-design-notes.md`.

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
