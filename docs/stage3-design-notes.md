# FRC 2408 Inventory — Stage 3 Design Notes

**Stage:** 3 (UI mockups at tablet size) · **Date:** 2026-10-17 · **Prepared for:** Dan
**Mockups:** design canvas "FRC 2408 Inventory — Stage 3 Mockups" (https://claude.ai/artifact/EGku829KFCLocrFfMEJ2ot) · 64 artboards, every screen clickable in Play
**Status:** For review. SPEC.md has **not** been changed. Proposed changes are listed in §6 for your approval.

---

## 1. Decisions that shaped the design

| Time (CDT) | Decision | Source |
|---|---|---|
| 12:07 | Light theme (glare and arm's-length reading) | Dan |
| 12:07 | Adaptive navigation: side rail in landscape, bottom tabs in portrait | Dan |
| 12:07 | Logo rust is used only for chrome (rail, primary buttons). Stock status gets its own red and amber, always with an icon and a word | Dan |
| 12:39 | The quick-adjust number must be labeled: every stepper now reads **"On hand (unit) · tap − / + or type"** | Dan |
| 12:39 | Demo data uses on_hand = 0 (the real starter state). Spares are back to catalog values (0) and "counted" flags are cleared, so the order list totals the spec's $8,413.66 | Dan |

**Look:** warm light ground (#F2EFEA) with white cards; dark rust-brown rail with the Shrapnel Sergeants logo. Barlow Condensed for headings and big numbers, Atkinson Hyperlegible (designed for legibility) for everything else. Both fonts are open-licensed and will be bundled so the app works offline.

## 2. How to review

- Each canvas row is one screen. Its artboards, left to right, are the screen's states, and the **last artboard in each row is portrait (800 × 1280)**.
- Press **Play** on any artboard. The rail and tabs switch screens; +/−, search, filters, dialogs, scanning simulation, the label preview and count-in all work. **Demo PIN: 2408**, with a live 5-minute countdown.
- Real data: all 129 starter items with names, part numbers, prices, suppliers and photos. Illustrative only: bin locations on 48 items, one **example** team-added McMaster item (no price), and the example counts on the count-in summary (10d).
- Limitation: each artboard keeps its own state, so a count changed on one artboard doesn't carry to another. Inside one artboard (list → detail → back, order list → detail) it does.

## 3. Navigation map

```
Rail (landscape) / bottom tabs (portrait) — always visible
├── Inventory (home) ─ search · quick filters · filter panel
│     ├── Item detail (opens in place) ─ Edit item ─ Delete [PIN] ─ Print QR label
│     └── + Add item (same form as Edit)
├── Order ─ Export CSV → Android share sheet · row → Item detail
├── Scan ─ found → ± and details · unknown → attach / add new · type a code · camera blocked
├── Count (proposal) ─ choose mode → one item at a time → group summary
├── Labels ─ 1 choose items → 2 layout, start position, nudge, preview → print / test print
└── More
      ├── Suppliers [PIN to change]
      ├── Categories [PIN to rename/remove]
      ├── Backup, restore & price import [PIN to restore/import]
      └── Mentor PIN & settings [PIN]
First launch only: Set PIN → Recovery code → Starter catalog → Loading → Ready (→ Count-in)
Overlays available everywhere: PIN pad, confirmation dialogs, toasts
```

The **lock pill** at the top right of every screen shows "Locked" or "Unlocked m:ss". Tapping it opens the PIN pad, or locks immediately when unlocked. Any action that needs the PIN opens the same pad, says why, and then carries on with the action.

## 4. Shared components (artboard 0a has the visual reference)

| Component | Where used | Notes |
|---|---|---|
| Nav rail / bottom tabs | All screens | Rail items 104 × 76 px with icon and label; tabs 88 px tall. 6 destinations in both orientations |
| Top bar + lock pill | All screens | Title, context actions, PIN state |
| Stock chip | List, detail, scan, count-in | **SHORT n** (red, octagon), **LOW SPARES** (amber, triangle), **OK** (outline, check). Row tint is extra, never the only signal |
| Group header counts | List | "12 short", "2 low spares" or "All stocked" chips, plus "n items · n counted" |
| Item row | List | Thumbnail, name, note icon, part # · supplier · pack price · location, Desired / Spares / Order, status chip, labeled On-hand stepper |
| On-hand stepper | List (64 px), detail / scan / count-in (80 px) | −, typed number (numeric keypad), +; never below 0 |
| PIN pad | Everywhere | 3 × 4 keys (72 px), 4–6 digits, wrong-PIN message, forgot-PIN help |
| Locked field | Edit | Dashed blue-gray field with a lock in the label |
| Confirmation dialog | Delete, restore, remove supplier/category | Names the thing and its count; destructive button labeled with the action |
| Banner | List, backup, order | Navy = information (backup reminder, count-in progress); amber tint = needs attention (stale prices) |
| Empty / loading / error states | List, order, scan, import | Icon, plain explanation, one clear next step |
| Order flags | Order list | "Price n days old" (navy outline, clock) and "NO PRICE — not in total" (dashed outline) |
| Simulated Android sheets | Export, backup, print | The real app uses Android's own share and print dialogs |

## 5. Count-in mode (NEW — proposal, row 10)

**Problem:** with on_hand = 0 the first order list says $8,413.66 until someone counts the shop.

**How it works**
1. **Start (10a):** shows the current order total, overall progress, and three ways to walk:
   - **By category** (default for the first count, since starter items have no locations): follows the list order.
   - **By location:** one bin or shelf at a time; becomes the fastest option once locations exist.
   - **Scan as you go (10c):** scan a label or barcode and the keypad opens for that item. Best after QR labels are printed; only 10 starter items have barcodes today.
   - Two options: *ask for a location while counting* (on) and *skip items with desired 0* (5 items).
2. **One item at a time (10b, 10e):** big photo, name, part #, desired and spares. Glove-sized keypad with **None**, **= desired**, and ±1 buttons, plus a live "After saving: SHORT n / OK" preview. Location chips let a student file the item to a bin in the same step. Back / Skip for now / **Save & next**.
3. **Group summary (10d):** counted / short / skipped, the order total before → after, then *Next group*, *Print labels for this group* and *Back up now*.
4. Progress is saved after every item, so a count can span several meetings. The order list shows a navy "Count-in: n of 130 counted" banner until every item is counted.

**Spec impact if accepted:** a new optional item field `last_counted` (date), plus a column in the §7 CSV. It drives progress, "Not counted yet" on the detail card and "n counted" in group headers. Without it, the app can't tell a counted 0 from a starter 0.

## 6. Proposed spec changes (not applied — your call)

| # | Area | Proposal | Why |
|---|---|---|---|
| S1 | F6 vs §6 | When **adding** a new item, vendor option 1 (supplier, part #, link, pack size, optional price) is editable without the PIN. The fields lock once the item is saved (3c) | F6 lets anyone add an item, and §4 needs a preferred vendor to save. But §6 puts vendor fields behind the PIN, so a student could never finish adding an item |
| S2 | F7 / F21 | The **barcode** field needs no PIN: students can scan to fill it in Edit, and attach an unknown barcode from Scan | The spec doesn't say; barcode isn't a vendor or price field |
| S3 | §3, §7 | Add optional `last_counted` date to Item and to the CSV | Needed for count-in (§5) |
| S4 | F16 | The backup banner shows on the **Inventory** screen (home) and on **Backup**, not on every screen. "Later" hides it until the next app launch | Keeps work screens uncluttered and still gets seen every session |
| S5 | F20 / F21 | QR labels encode `2408:<item id>` (e.g. `2408:st-0063`). The scanner also accepts a bare id or a typed code | Tells team labels apart from vendor QR codes on packaging |
| S6 | F17 | The restore dialog compares "on this tablet" with "in the backup", offers **Back up this tablet first**, and needs an "I understand" tick before **Replace everything** (8c) | A restore is the one action that can wipe weeks of counts |
| S7 | F18 | The price-update file is checked as a whole before anything is saved. Errors list row numbers and nothing changes (8e) | A half-applied price file is worse than none |
| S8 | F9 | A **Reorder** mode with ▲/▼ buttons (no PIN), not only drag handles | Drag is unreliable with gloves |
| S9 | §6 settings | List the PIN-protected settings: backup reminder (7 days), stale-price age (90 days), unlock length (5 min) | §6 says "changing settings" but names none |
| S10 | F14 | When most lines are stale, show one summary banner with the price-refresh steps as well as the per-line flags (4b) | Every starter price (checked 2026-10-17) goes stale on the same day, 2027-01-16, early in build season |
| S11 | §2 | Show persistent-storage status (Backup, About), and provide a storage-error screen that leads to Restore (1f) | Makes the IndexedDB risk visible before it bites |

## 7. Questions for you

1. **S1:** OK for students to fill vendor option 1 when adding a new item? The alternative is saving the item with supplier "other" and no price for a mentor to fix later.
2. **Count-in:** should it go into the spec (as F24) with the `last_counted` field? Should "by location" or "scan" be cut from v1 to keep it smaller?
3. **Delete undo:** a 10-second "Undo" toast after deleting an item, or keep the confirmation dialog only (current spec)?
4. **Destructive red vs. status red:** delete/replace buttons use #A3122B, close to the SHORT red #B3122E. They're always labeled with a trash icon and a word. Keep them, or switch destructive buttons to black with a red outline?
5. **Label sheet geometry** in the preview is approximate (SPEC §9 says to measure the real package in Stage 4). Which sheets will you buy? (Open question 2.)
6. **Location names:** free text with recent-location chips, or a managed list like suppliers? A managed list would make count-by-location and label-by-location cleaner.

## 8. Notes for Stage 4 (build)

- Remember expanded/collapsed groups (F1), filters, and the per-layout label nudge in local storage. The mockup holds them only in memory.
- Fonts: bundle Atkinson Hyperlegible and Barlow Condensed (both SIL OFL) as woff2.
- Target sizes: everything interactive is ≥ 48 px. Primary actions 56–64 px; steppers 64 px in lists and 80 px on detail, scan and count-in; keypad keys 68–72 px.
- Contrast: white on SHORT red 6.9:1; ink on amber 10.1:1; muted text 8.8–10:1; white on rust 8.2:1.
- Mockup simplifications to replace with real behavior: camera feed (simulated buttons), Android share and print sheets, label-sheet geometry, the "Print QR label" link (should preselect the item), and deleting/restoring (toasts only).

## 9. Decisions — 2026-10-17 14:43 CDT (applied in SPEC v0.4 and the mockups)

| Q | Decision | Applied |
|---|---|---|
| 1 | Vendor option 1 is open while adding an item (S1) | SPEC F6 and §6. Mockup 3c tag now reads "SPEC F6" |
| 2 | Count-in goes into the spec, all three modes kept | SPEC F24 + `last_counted` field + CSV column. Canvas row 10 relabeled as F24 |
| 3 | Delete keeps the confirmation dialog only (no undo) | SPEC F8; "undo for deletions" added to §13 (out of scope) |
| 4 | Destructive buttons are black with a red outline | All delete / remove / replace buttons restyled (#1A1411 fill, 3 px #E5484D outline); SPEC §17; component sheet 0a updated |
| 5 | Label sheets — still open | SPEC §15 Q2 |
| 6 | Locations become a managed list | SPEC F25, Location table in §3, `locations.csv` in §7. Mockups: Edit location picker with "+ New location…" (no PIN, duplicates rejected), new Locations screens 7i–7k (walk order, reorder without PIN, rename/remove with PIN, remove asks where items go), Locations row under More, count-in "New location…" chip |

**My default, please confirm:** location PIN rules copy the category rules. Anyone can add or reorder; rename and remove need the PIN. That lets students create a bin name during count-in without a mentor.

**15:34:** Dan approved S2 and S4–S11. All are written into SPEC v0.5. The mockups already showed them; one alignment fix: the order-list stale banner now appears only when more than half of the priced lines are stale (F14).
