# Stage 4 — final regression and F1–F25 check

**Date:** 2026-10-18 CDT · **Source:** branch `m10-starter-pwa` at `0acf613` (M1–M10 plus the F24 count rounds of SPEC v0.6). The source was the same for every run below; later commits only add documents.

This closes Stage 4 as the plan asks (stage4-plan §4: "After M10: a full regression and an end-to-end verification against every F1–F25"). Each requirement in SPEC v0.6 §5 was read again, clause by clause, and traced to a test or browser check that **ran on this source**. The milestone reviews (`docs/reviews/M2.md` … `M10.md`) have the detail.

## Full regression

| Run | Result |
|---|---|
| `npm test` | **33 files, 504 tests, all pass** |
| `npm run build` | Clean (TypeScript strict, Vite, service worker with 16 precache entries) |
| Browser checks on the production build (headless Chrome) | M2 **28/28** · M3 **50/50** · M4 **25/25** · M5 **39/39** · M6 **54/54** · M7 **32/32** · M8 **61/61** · M9 **71/71** · M10 **40/40**, all with no console errors or warnings. **400 checks.** Each check starts from a new tablet: first-launch setup, then the starter catalog. |
| Deliberate-bug (mutation) checks across Stage 4 | Every milestone M2–M10 at unit level, and M7–M10 also through the browser; every mutant that could change behaviour was caught, after the test gaps each review found were closed. |

## F1–F25

| F | Requirement (SPEC v0.6 §5) | Verified by | Verdict |
|---|---|---|---|
| F1 | Collapsible category → subcategory; state remembered; red/yellow counts in headers | `inventory-view.test.ts` (grouping, header counts), `prefs.test.ts`; M2 browser (expand, reload keeps groups, header chips) | ✅ |
| F2 | Row: thumbnail, name, on hand, desired, spares, order qty, preferred supplier, pack price, location; note icon; highlight | `ItemRow.tsx`, `inventory-view.test.ts`; M2 browser and screenshots; thumbnails M7 | ✅ |
| F3 | Large +/− and typed on hand, labeled "On hand" everywhere | `db.test.ts` (never below 0, 10 parallel taps → 10); M2 browser; the same labeled stepper on detail and Scan (M3, M8) | ✅ |
| F4 | Search name, part #, supplier, location, notes; as you type | `search.test.ts` (all vendor options, D2 accents); M2 browser | ✅ |
| F5 | Needs order · Red · Yellow · category · supplier · location | `filters.test.ts`, `inventory-view.test.ts`; M2 browser | ✅ |
| F6 | Anyone adds an item, new subcategories too; vendor option 1 without the PIN, locked after saving | `item-form.test.ts`, `edits-db.test.ts`; M3 browser (no PIN pad while adding; locked after); photo while adding M7 | ✅ |
| F7 | Students edit counts, location, desired, spares, notes, photo, category, barcode (typed or scanned); vendor/price need the PIN | M3 browser and gate matrix (M6); photo M7; Scan button in the editor M8 | ✅ |
| F8 | Delete any item; PIN; confirmation with name and on-hand; no undo | M3/M6 browser (dialog text, PIN, item and photo gone); M6 independent review | ✅ |
| F9 | Add, rename, reorder (▲/▼) categories and subcategories; remove only when empty or after moving; PIN for rename/remove | `lists.test.ts`; M3/M6 browser | ✅ |
| F10 | Detail card: full notes, photo (enlarge), every vendor option with links, +/− | M3 browser; photo and enlarge M7 | ✅ |
| F11 | One-tap supplier link | `url.test.ts` (only http/https links); a link that opens in a new tab (`target=_blank`, `noopener`): M3 | ✅ |
| F12 | Order list: order_qty > 0, by preferred supplier, subtotals, grand total; CSV; count-in banner while any item is uncounted | `order.test.ts`, `order-list.test.ts` (§4 worked examples, $8,413.66); M4 browser; banner wording Q7, progress M9 | ✅ |
| F13 | Order CSV columns, subtotal rows, grand total | `order-list.test.ts` (exact columns, D4); M4 browser (exported file read back) | ✅ |
| F14 | "Price n days old" past the setting; summary banner when more than half are stale | `order-list.test.ts` (90/91 days, blank date, the half-stale threshold); M4 browser; setting M6 | ✅ |
| F15 | Full backup (ZIP) or data only (CSV); share sheet | `backup-restore.test.ts` (round trip); M5 browser | ✅ (Android share sheet: Stage 5, Q1) |
| F16 | Reminder banner on Inventory and Backup after the period; Later until next launch; either export resets | `backup-reminder.test.ts`; M5 browser; clock from setup (D7), set at the end of first launch (M10) | ✅ |
| F17 | Restore ZIP or CSV; PIN; compare, back up first, "I understand"; CSV keeps photos; missing names added | `backup-restore.test.ts`; M5/M6 browser; M5 independent review | ✅ |
| F18 | Price import: vendor fields only, whole file checked first, errors by row, summary, new suppliers added, PIN | `price-import.test.ts`; M5 browser; M5 independent review | ✅ |
| F19 | Part photos (§8): take/choose, resize, thumbnail, enlarge, replace/remove without the PIN | `photos.test.ts`, `image-size.test.ts`; M7 browser (stored JPEGs decoded back) | ✅ (camera on the tablet: Stage 5) |
| F20 | QR labels (§9): layouts, start position, page breaks, nudge, test print, 100% reminder | `labels.test.ts`, `labels-db.test.ts` (QR round trip through zxing); M8 browser (print media and PDF) | ✅ (real sheets at 100%: Stage 5; geometry "verify against package", §15 Q2) |
| F21 | Scan QR or stored barcode → item with +/−; typed id or code; unknown → attach (no PIN) or add | `scan.test.ts`; M8 browser (fake camera plays a team label); scanner keeps reading after a report (M9 fix) | ✅ (native detector on the tablet: Stage 5) |
| F22 | First launch loads the starter catalog: on hand 0, desired, spares 0, photos; editable; offers count-in | `setup.test.ts`, `seed.test.ts`; M10 browser (also offline, and the Q2 restore path) | ✅ |
| F23 | Suppliers: add, rename (everywhere), remove with replacement (default `other`), `other` kept, duplicates rejected, A–Z with `other` last, PIN | `lists.test.ts`, `edits-db.test.ts`; M3/M6 browser | ✅ |
| F24 | Count-in: three modes, start screen, one item per screen, keypad, preview, location, save and resume, summary, count rounds, no PIN | `count.test.ts`, `count-db.test.ts`; M9 browser (71 checks, incl. rounds) | ✅ |
| F25 | Locations: add anywhere (no PIN), reorder (no PIN), rename/remove (PIN) with replacement or "No location", duplicates rejected, walk-order pickers with recent quick picks | `lists.test.ts`; M3/M6 browser; from count-in M9 | ✅ |

Also checked across the build: §2 (offline, persistent storage, storage-error screen with Set up again: M2, M5, M10), §4 (all four worked examples and the no-price rule: M1/M4), §6 (the full PIN gate matrix: M6 and its independent review), §7 (round trip with no data loss: M5), §17 (48 px targets, both orientations, status as color + icon + word: every milestone's browser check).

## Left for Stage 5 (Tab S8, hands-on)

Install to the home screen and the persistent-storage answer for the installed app · first launch speed on the tablet · an update after a real GitHub Pages deploy · the Android share sheet for ZIP and CSV (Q1) · camera and photo picker, EXIF rotation, 12 MP decode time · native `BarcodeDetector` formats and range, torch, a long scan session · **a real label print at 100% on each sheet type, then the nudge** · gloves on the keypad and steppers · font rendering.

## For Dan

- **Spec:** spec-questions Q3 (`categories.csv`) and Q8 (`manifest.json` in the full backup) are built as approved but not yet written into SPEC (v0.6 only added count rounds).
- **Label sheets** are still undecided (§15 Q2); the layouts are data, so adding or correcting one is a small change.
- A **fresh-session review** before Stage 5 is optional: the high-stakes parts (order math, backup/restore, price import, PIN) already had one (M5, M6), and nothing in M7–M10 changed them.
