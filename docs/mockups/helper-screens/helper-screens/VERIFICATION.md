# v0.6 helper-device mockups: verification

**Date:** 2026-10-19 · **Canvas:** row 11 of "FRC 2408 Inventory — Stage 3 Mockups" (artboards 11a–11f) · **Spec:** SPEC v0.6 draft §18 (not yet approved)

## Traceability (§18 → artboard)

| Requirement | Where | Result |
|---|---|---|
| §17 helper bar "HELPER · name", 3 tabs Count / Scan / Send | 11a–11c | Pass |
| §18.3 count with F24 keypad on a phone; keys ≥ 64 px | 11a | Pass (keys measured 64 px at 360 and 390 px wide) |
| §18.3 location chips incl. "New location…" | 11a, 11b | Pass |
| §18.3 add item: required name, category, unit, on hand; optional photo, location, barcode, desired (default 0), notes, vendor option 1 | 11b | Pass (Save disabled when name is empty) |
| §17 PENDING = dashed chip, never a status color | 11b, 11d, 11f | Pass |
| §18.4 cumulative file, unsent count, send-before-leaving reminder, file name format | 11c | Pass |
| §18.2 Leave helper mode needs counts sent first; destructive style | 11c | Pass (message only, mockup) |
| §18.5 check passed before preview; nothing saved yet | 11d | Pass |
| §18.5 preview groups: will apply / conflicts / same number / outside / already applied | 11d | Pass |
| §18.5 conflict: both numbers, who, when; Keep / Use helper's / Add together; Use newest for all | 11d | Pass |
| §18.5 new location names: auto-merge matching names; Add / Same as… | 11d | Pass |
| §18.5 Apply disabled until every conflict has a choice | 11d | Pass (tested) |
| §6 no PIN for Import counts | 11d–11f | Pass ("No PIN needed" chip) |
| §18.5 summary: applied, skipped, conflicts settled, outside, new items waiting, order total before → after | 11e | Pass after fix (the "outside groups" tile was missing) |
| §18.5 Undo this import with confirmation, destructive style | 11e | Pass (tested; returns to the preview) |
| §18.5 pending review: Accept, Same as existing (Use as / Add to count), Discard with confirmation | 11f | Pass (tested) |
| §18.5 likely duplicates flagged; Combine (add / keep one) | 11f | Pass (tested) |
| §18.1 assign helpers / send kit; §18.2 join; F22 role choice | — | **Not drawn** (described in §18) |

## Checks run
- Audit of 6 artboards: 101 controls, 0 under 48 px, 0 sideways overflow, 0 page errors.
- Phone screens forced to 360 px wide: no sideways overflow. One quick chip measured 47.9 px, so quick chips now have a 56 px minimum width.
- Functional script: 28/28 pass (keypad, save/advance, add-form validation, send flow, conflict choices, apply, undo, use newest, combine, same-as, discard, empty state).

## Remaining uncertainty
- The phone layout is shown at 390 px and checked at 360 px in a desktop browser, not on real phones (Android Chrome or iPhone Safari).
- Example data (students, times, counts, Talon SRX / Victor SPX) is illustrative only.
- The real app's styles may have drifted from the Stage 3 mockups during the build. Match the built app where they differ.

## Session log (CDT)
- 14:04 Dan asked for the screens and for Stage 5 steps
- 14:06 Stage 5 checklist written, checked against the seed (9 suppliers, 124 priced lines, no unpriced items), delivered
- 14:08 Phone screens 11a–11c built and rendered; fixed shrinking cards, the helper bar wrapping and the photo placeholder
- 14:12 Tablet screens 11d–11f built and rendered
- 14:14 Audit, 360 px check and functional tests; quick-chip width fixed; 28/28 pass
- 14:16 Canvas published (row 11); summary tile fix republished; package `v06-helper-mockups.zip` delivered
