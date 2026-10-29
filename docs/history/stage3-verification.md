# FRC 2408 Inventory — Stage 3 Verification Report

**Reviewed:** the Stage 3 mockup canvas (64 artboards) and design notes, against SPEC v0.3 §4, §5 (F1–F23), §6 and §9, plus Dan's Stage 3 requirements (tablet size, portrait, 48 px targets, color-independent status).
**Method:** reviewed as someone else's work. Every artboard was rendered in headless Chromium with the Design canvas's own runtime and the same uploaded data. A scripted audit and a 31-step functional test drove the real controls, and the assets were cross-checked against the server listing. Evidence below is quoted from the test output.
**Date:** 2026-10-17, 12:57–13:20 CDT.

---

## 1. Traceability — SPEC acceptance criteria → screen and element

Artboard ids are the canvas titles (e.g. **1a** = Inventory list). T = functional test result.

| Req | Acceptance criterion (abridged) | Where it is satisfied | Evidence | Result |
|---|---|---|---|---|
| F1 | Categories and subcategories expand/collapse | 1a group headers (`aria-expanded`), subcategory headers | T: Structure false→true, then Tubing → 2 rows | ✅ |
| F1 | State remembered | 1a keeps open groups while you work | Held in memory only in the mockup; Stage 4 must persist it | ⚠️ build note |
| F1 | Header shows red/yellow counts | 1a chips "12 short" / "n low spares" / "All stocked" | T: 12 of 12 headers show a short-count chip | ✅ |
| F2 | Thumbnail, name, on hand, desired, spares, order qty, supplier, pack price, location, note icon, highlight | 1a item row; 1g portrait row | T: all fields present on st-0002 row (WCP-0922 · WCP · $26.99 · Rack A, note icon, SHORT chip, row tint) | ✅ |
| F3 | Large +/− and direct entry for on_hand, no full form | 1a stepper (64 px) labeled "On hand"; 2a, 5b, 10b (80 px) | T: +,+→2; −→1; typed 7; 9×− → 0 (never negative) | ✅ |
| F4 | Search name, part #, supplier, location, notes, live | 1a search; 1b "neo"; 1d empty | T: "REV-21-1653"→NEO 2.0; "Thrifty Bot"→26; "Bin F3"→10-32×¾; "kraken"→3 (notes); "falcon 500"→empty state | ✅ |
| F5 | Needs order · Red only · Yellow only · category · supplier · location | 1a quick chips; 1c filter panel | T: Needs order→125; Low spares only→empty state (correct at on_hand 0); Motors+REV→3 NEO items | ✅ |
| F6 | Anyone adds an item, any category, new subcategories, same form as edit | 3c (Edit form in add mode, "+ New subcategory…") | T: add mode, new-subcategory field, vendor option open | ✅ (depends on proposal S1) |
| F7 | Students edit counts, location, desired, spares, notes, photo, category; vendor/price need PIN | 3a locked vendor section; 3b unlocked; 3e portrait | T: 10 vendor fields disabled; name/category/location/notes/barcode/counts enabled; all enabled after PIN | ✅ |
| F8 | Delete any item, PIN, confirmation shows name and on hand | 2c; Delete button with PIN chip on 2a/3a | T: PIN prompt first, then dialog with name + "On hand: 0 each" | ✅ |
| F9 | Add, rename, reorder; remove needs empty or move; PIN for remove/rename | 7f, 7g, 7h | T: reorder with no PIN (24 ▲/▼ buttons); remove asks PIN then shows "isn't empty yet — move to…" | ✅ |
| F10 | Full notes, photo (tap to enlarge), all vendor options with links, +/− | 2a, 2b lightbox, 2d no-photo, 2e portrait | T: full notes; photo button; 2 vendor cards; ±80 px | ✅ |
| F11 | One-tap supplier link | 2a "Open product page" per vendor; supplier website buttons on 4a and 7a | T: links = revrobotics.com/rev-21-1653, andymark.com/… | ✅ |
| F12 | Items with order_qty > 0, grouped by preferred supplier, subtotals, grand total, on screen + CSV | 4a, 4e portrait | T: grand total $8,413.66; 8 groups; subtotals sum to $8,413.66; "1 without price" | ✅ |
| F13 | CSV columns as listed; subtotal after each supplier; grand total at end | 4c export preview → share | T: 13 columns match exactly; subtotal row and grand-total row in preview | ✅ (fixed during review) |
| F14 | Prices checked > 90 days ago are flagged | 4b (demo date 2027-01-20) line chips + summary banner | T: 124 line flags; "124 stale (>90 days)" | ✅ |
| F15 | Full (ZIP) or Data only (CSV) → Android share sheet | 8a, 8b | T: share sheet opens; after sharing, last backup updates and banner clears | ✅ (sheet simulated) |
| F16 | Banner if no backup in 7 days | 1a, 8a | T: banner text present | ✅ (placement = proposal S4) |
| F17 | Restore ZIP/CSV, replaces all, PIN, confirmation; CSV keeps photos; unknown suppliers added | 8a text, 8c dialog | T: PIN prompt; Replace disabled until "I understand" | ✅ |
| F18 | Price import updates vendor fields only, summary of updated / not found, PIN, new suppliers listed | 8d summary, 8e error | T: summary shows updated, "0 counts changed", ids not found, new supplier | ✅ |
| F19 | Optional photo; take/gallery; thumbnail in row; full size on card; replace/remove without PIN | 1a thumbnails, 2a/2b/2d, 3a photo row | Inspection: photo buttons have no PIN chip; 2d shows the no-photo state (SystemCore) | ✅ |
| F20 | QR labels (§9) | 6a select (category/location/items), 6b layout, 6c print | T: 4 layouts; start → "label 10 (row 4, column 1)"; nudge +0.5 mm; test print; 21 real QR codes in preview | ✅ |
| F21 | Scan QR or barcode → item with +/−; unknown → attach | 5a–5f | T: QR → NEO 2.0 with ±; unknown → attach → "Barcode attached…" | ✅ (camera simulated) |
| F22 | First launch loads starter (on_hand 0, desired, spares 0, photos) | 9h–9j | T: set PIN → confirm → recovery → load → "Ready — 129 items loaded" | ✅ |
| F23 | Add/rename/remove supplier, replacement on remove (default other), other not removable, duplicates rejected, A–Z with other last, PIN | 7a–7e; supplier pickers on 3b | T: PIN first; "Andymark" rejected as duplicate; other has no Remove; WCP dialog shows vendor-option count and replacement chips (other preselected) | ✅ |
| §4 | Order math: need, packs = ceil, order qty, line total | 2a order line; 4a | T: (4,2,1,pk1)→5; (12,4,5,pk50)→50; (10,2,12,pk25)→nothing; (10,2,11,pk25)→25 — all four worked examples | ✅ |
| §4 | Validation: pack size whole ≥ 1; preferred vendor must exist | 3d | T: errors "pack size '2.5'…", "choose a supplier (preferred vendor)" | ✅ |
| §4 | No price → listed, marked, excluded from totals, count shown | 4a (EXAMPLE McMaster item) | T: "1 without price"; line "NO PRICE — not in total"; total unchanged at $8,413.66 | ✅ |
| §4 | Red / yellow / no-highlight rules | chip logic on every screen | Code review + T (st-0002 SHORT); yellow can't occur with on_hand 0; shown in 0a and the count-in preview | ✅ |
| §6 | 4–6 digit PIN set at first launch, stored hashed | 9f PIN pad (set + confirm) | T; "stored hashed" stated in 9a | ✅ |
| §6 | PIN required for: delete, category remove/rename, vendor/price incl. preferred, suppliers, restore, price import, settings & PIN | 2c, 7g, 3a, 7d, 8c, 8d, 9a | T for each (except settings/change PIN: inspection of 9a rows, which open the PIN pad) | ✅ |
| §6 | Not required for adding items, counts, desired/spares/location/notes/photos | 1a, 2a, 3a, 3c | T: steppers and fields work while locked | ✅ |
| §6 | Unlocked 5 minutes, then relocks | Lock pill + 9d countdown | T: "Unlocked 4:59" counting down; code relocks at 300 s | ✅ |
| §6 | One-time recovery code at setup | 9g; "Forgot PIN?" on the pad | T: code shown; Next disabled until acknowledged | ✅ |
| §9 | Select items, whole category or location | 6a tabs By category / By location, item checkboxes | Inspection + T | ✅ |
| §9 | 4 layouts with listed contents | 6b layout cards; preview shows QR + name + location (5160), + part # (5163), short name (22805), dashed cut lines (plain) | Inspection + T | ✅ |
| §9 | Start position | 6b tappable sheet map | T | ✅ |
| §9 | Alignment nudge 0.5 mm, saved per layout | 6b Down/Right steppers, "Saved for Avery 5160" | T: +0.5 mm; stored per layout key | ✅ |
| §9 | Test print outlines | 6b button → 6c dialog in test mode | T | ✅ |
| §9 | 100% / actual-size reminder | 6b persistent strip; 6c pre-print checklist | T | ✅ |
| §9 | Sizes checked against real package | — | Deferred to Stage 4 by the spec; preview geometry is approximate | ⚠️ open |

## 2. Dan's Stage 3 requirements

| Check | Method | Result |
|---|---|---|
| Landscape ≈ 1280 × 800 | All screen artboards are 1280 × 800 | ✅ |
| Every screen works in portrait | 12 portrait artboards (one per screen). Audit: document width = 800 and **0 elements overflow the right edge** outside scroll areas. Visual check of each | ✅ |
| Touch targets ≥ 48 px | DOM audit of every button, link, input, select, checkbox, radio and switch on all 64 artboards (2,912 elements): **0 under 48 px**. The detector was sanity-tested by injecting a 30 px button, which it caught | ✅ |
| Large +/− buttons | 64 px (lists), 80 px (detail, scan, count-in) | ✅ |
| Readable at arm's length | Text ≥ 15 px; names 19 px; counts 26–64 px. Contrast: white on SHORT red 6.9:1, ink on amber 10.1:1, muted text 8.8–10:1, rust buttons 8.2:1 | ✅ |
| Red/yellow also use icon or label | Audit: every element with the SHORT-red or amber fill must contain an icon **and** text. All status chips pass. Grayscale render: SHORT = dark fill + octagon, LOW SPARES = light fill + triangle, OK = outline + check. Re-audit after the fix: 0 failures, apart from the two color-token swatches on the component sheet (0a), which show the colors themselves | ✅ after fix |
| Real items and photos | All 129 photo URLs cross-checked against the server's asset listing (id **and** byte size): **129/129 match** | ✅ |
| Interactive between screens | Rail/tab links between artboards; detail opens in place; 31/31 scripted flows passed | ✅ |
| Empty, loading, error, PIN-locked states; delete/restore dialogs | 1d, 1e, 1f, 4d, 5e, 8e; 3a, 7d, 9a–9c; 2c, 8c (+7c, 7g) | ✅ |
| Console errors | No page errors on any artboard (only a missing favicon request on the local test server) | ✅ |

## 3. Problems found and fixed during review

| # | Finding | Fix |
|---|---|---|
| 1 | The count-in "PROPOSAL" tag used the low-spares amber fill with no icon. The audit flagged it as status color used for something that isn't status | Changed to a dashed black outline tag |
| 2 | CSV export preview didn't show the grand-total row F13 requires | Added "… more supplier groups" and a **Grand total** row |
| 3 | Backup banner text said it shows "on every screen", but it appears only on Inventory and Backup | Reworded; placement raised as proposal S4 |
| 4 | Flex buttons spread "( 5 )" and "( 1 )" around numbers | Wrapped those labels in a single text span |
| 5 | Edit form's three steppers overflowed the column in landscape | Stacked as labeled rows with full 64 px buttons |
| 6 | Setup step 1 pushed the PIN pad below the fold | Narrower side panel; text and pad side by side |
| 7 | Detail "no photo" placeholder laid out in a row | Fixed to a centered column |
| 8 | (Dan, 12:39) the list's number box had no label | Labeled "On hand (unit) · tap − / + or type" everywhere, with a heavier border on the editable box |

## 4. Summary

**Completed:** 64-artboard interactive canvas covering all 10 requested screens, with landscape states plus a portrait version of each, using real catalog data and photos. Also a shared-component and token sheet, a design-notes doc (navigation map, components, 11 proposed spec changes, 6 questions), and a count-in proposal.

**Verified:** every F1–F23 criterion and every §4, §6 and §9 rule maps to a screen element (table above), backed by 31/31 scripted checks. 0 touch targets under 48 px. 0 portrait overflows. Status color always comes with an icon and a word. The order total matches the spec's $8,413.66 to the cent. All 129 photo links resolve to the right files.

**Changed:** the 8 fixes in §3. Demo data reset to on_hand 0 at Dan's request.

**Remaining uncertainty:**
- **F1 "state remembered"** and the per-layout nudge are in memory only in the mockup; Stage 4 must persist them.
- **Label geometry** is approximate until the real sheets are measured (SPEC §9 / open question 2).
- **Proposal S1** (vendor fields open when adding) resolves a real conflict between F6, §4 and §6, but it's your call; F6's pass depends on it.
- Camera, Android share sheet and print dialog are simulated. Real behavior on the Tab S8 (BarcodeDetector support, permission prompts, print scaling) gets tested in Stage 5.
- The renders used the canvas runtime in desktop Chromium, not Chrome on the Tab S8; font rendering and keyboard behavior may differ slightly on the device.

**Risk level: Low–medium.** These are mockups, not code. The parts that matter most are the spec changes (S1, S3 `last_counted`, S5 QR format), because they change the data model, backup format and label contents. I recommend reviewing those in a fresh chat before Stage 4.

## 5. Session log (CDT)

| Time | Activity |
|---|---|
| 12:03 | Request received; read SPEC v0.3 (attached) |
| 12:04 | Read stage2-report.md from the project; unpacked the starter ZIP (129 items, 128 photos, 9 suppliers) |
| 12:05–12:07 | Asked 3 design questions; answers: light theme, adaptive navigation, rust for chrome only |
| 12:08 | Catalog analysis (category counts, order total check $8,413.66); created the design canvas |
| 12:11 | Uploaded 128 product photos + team logo |
| 12:14 | Built and uploaded mockup data (data.json) and QR paths for all items (qr.json) |
| 12:19 | Canvas index (64 artboards) + Inventory list published |
| 12:20–12:23 | Built a local render harness from the canvas runtime for checking each screen |
| 12:25 | PIN pad, item detail, inventory states and portrait published; progress note to Dan |
| 12:30 | Add/Edit row published |
| 12:33 | Order list row published |
| 12:36 | Scan row published |
| 12:39 | Dan: label the adjustable value; set on_hand to 0 in the data |
| 12:41–12:42 | Data reset (on_hand/spares 0, counted cleared) and re-uploaded; "On hand" label added; QR labels row published |
| 12:46 | Suppliers and categories published |
| 12:52 | Backup/restore, More/PIN and first-launch rows published |
| 12:56 | Count-in proposal row, component sheet and canvas notes published |
| 12:57 | Verification audit: touch targets, portrait overflow, color-independent status, console errors (64 artboards) |
| 13:00–13:07 | Functional test suite written and run: 31/31 pass (after fixing 4 bugs in my own test script, not the mockups); contrast and grayscale checks |
| 13:07 | Fixes from review published (CSV grand total, banner wording, proposal tag) |
| 13:08 | Photo links cross-checked against the server asset listing: 129/129 |
| 13:10–13:20 | Design notes and this report written; saved to the project |

## 6. Addendum — v0.4 changes (2026-10-17 14:43–15:00 CDT)

**What changed:** SPEC v0.4 (F24, F25, last_counted, F6/F8/§6 edits, §17), plus mockup updates (destructive button style, Edit location picker, Locations screens 7i–7k, More entry, count-in labels). The canvas now has 67 artboards.

**SPEC v0.4 review** (diffed line by line against v0.3; checked as someone else's draft):

| Check | Result |
|---|---|
| All six 14:43 answers reflected (F6 + §6; F24 + last_counted, all three modes; F8 no undo + §13; §17 destructive style; §15 Q2 still open; F25 + §3 Location table + §7 locations.csv + F17 + §9) | ✅ |
| No undecided proposal slipped in (S2, S4–S11 untouched in F7, F14, F16, F17, F18, §9; listed under §15 Q5 instead) | ✅ |
| Internal consistency: F15 ↔ §7 (locations.csv); §6 PIN list ↔ F25 and F9; F24 "no PIN" ↔ §6; §12 notes the seed has no locations or last_counted; §14 build order includes locations and count-in | ✅ |
| Found and fixed: inserting `last_counted` mid-row shifts the column positions → added "import matches columns by header name"; "added with an on-hand amount" was ambiguous for 0 → any amount entered when adding counts; artboard count 64 → 67 | ✅ fixed |

**Mockup regression:**

| Check | Result |
|---|---|
| Functional suite (31 earlier tests + 3 new: Edit location picker, Locations reorder/remove/duplicate, destructive style) | **34/34 pass** |
| Touch targets on all 67 artboards (3,142 controls) | 0 under 48 px |
| Portrait overflow | 0 |
| Status color without icon + word | 0 (only the two color swatches on 0a, as before) |
| Page errors | 0 |
| Destructive buttons | computed style: fill rgb(26, 20, 17), 3 px outline rgb(229, 72, 77) |

**Remaining uncertainty:** the location PIN rules (add/reorder open; rename/remove need the PIN) are my default, copied from categories; Dan to confirm. S2 and S4–S11 still need decisions. Label geometry is still open.

**Session log (CDT):**

| Time | Activity |
|---|---|
| 14:43 | Dan answered the six Stage 3 questions |
| 14:44–14:50 | SPEC v0.4 drafted (F24, F25, last_counted, locations.csv, F6/F8/§6, §17) |
| 14:50–14:54 | Mockups updated: destructive style on 7 files, Edit location picker, Locations screens 7i–7k, More entry, count-in labels; published |
| 14:54–14:58 | Regression: 34/34 functional tests, audit of all 67 artboards |
| 14:58–15:00 | SPEC diff review; 3 fixes; docs saved to the project |

## 7. Addendum — v0.5 (2026-10-17 15:34–15:45 CDT)

| Check | Result |
|---|---|
| Diff v0.4 → v0.5: each of S2, S4–S11 appears in the right requirement (F7, F9, F14, F16, F17, F18, F21, F25, §2, §6, §9) and nothing else changed | ✅ |
| Spec vs. mockups for each S-item (barcode field enabled when locked; banner on Inventory + Backup; `2408:` labels and typed codes; 8c restore dialog; 8e all-or-nothing import; ▲/▼ reorder on 7f/7i; settings row in More; storage status and the 1f error screen) | ✅, except S10 |
| S10: the mockup showed the stale banner whenever any price was stale; the spec says more than half | Fixed in the order-list artboards. Test: fresh prices → no banner; demo date 2027-01-20 → banner + 124 line flags |

Remaining open items: label sheet sizes (§15 Q2), NEO 2.0 test fit (Q3), 2027 radio (Q4). The location PIN rules are still my default (copied from categories) unless you say otherwise.
