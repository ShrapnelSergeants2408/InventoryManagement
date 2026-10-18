# FRC 2408 Inventory Management — Stage 4 kit

Prepared 2026-10-17 for the Stage 4 build in Claude Code (VS Code).

## What's in this kit

| Path | What it is |
|---|---|
| `docs/SPEC.md` | **Specification v0.5 — the source of truth** (F1–F25, data model, calculations, PIN rules, backup formats, labels, UI conventions §17) |
| `docs/stage3-design-notes.md` | Navigation map, shared components, count-in design, decisions |
| `docs/stage3-verification.md` | Stage 3 traceability table (every requirement → screen), checks, session log |
| `docs/mockups/screenshots/` | 67 PNGs of every screen and state (landscape 1280×800, portrait 800×1280) + `INDEX.md` |
| `docs/mockups/source/` | Mockup source (`.dc.html`): reference for exact CSS and screen logic; won't open in a browser (see its README) |
| `seed/frc2408-starter-catalog-2026-10-17.zip` | Starter catalog in full-backup format: `inventory.csv` (129 items, 168 vendor options), `suppliers.csv`, `photos/` (128 JPEGs) |
| `assets/team-logo-1024.png`, `team-logo-512.png` | Shrapnel Sergeants logo for the rail and the PWA icons |

The interactive mockup canvas lives on claude.ai and is private; Claude Code can't open it, which is why the screenshots are included. `stage2-report.md` (catalog research) stays in the claude.ai project. You don't need it for the build.

## How to start

1. Make a new folder, e.g. `frc2408-inventory`, and unzip this kit into it so `docs/`, `seed/` and `assets/` sit at the top level.
2. Open the folder in VS Code and start Claude Code.
3. Paste the prompt below.

---

## Prompt to paste into Claude Code

```
You're building Stage 4 of "FRC 2408 Inventory Management": an offline-first Progressive Web App for our FRC robotics team's shared Samsung Galaxy Tab S8 (Android, Chrome, installed to the home screen). I'm Dan, the team's mentor.

SOURCES (in this folder)
- docs/SPEC.md (v0.5) is the source of truth. Do not change it. If you find a gap or contradiction, write it in docs/spec-questions.md and ask me; I approve all spec changes.
- docs/stage3-design-notes.md and docs/mockups/screenshots/ (see INDEX.md) show the approved UI. Match them, and follow SPEC §17 (UI conventions). docs/mockups/source/*.dc.html contain the exact CSS values and a sketch of each screen's logic; reference only.
- seed/frc2408-starter-catalog-2026-10-17.zip is the starter catalog (full-backup format, SPEC §7/§12). It has no locations.csv and no last_counted column; both import as empty.
- assets/team-logo-*.png for the nav rail and PWA icons.

STACK (SPEC §2): TypeScript + Vite, IndexedDB via Dexie.js, Papa Parse, JSZip, a small QR library, BarcodeDetector with a JS fallback, Vitest. Hosting will be GitHub Pages (HTTPS). Keep dependencies few and well known. Bundle the fonts (Atkinson Hyperlegible, Barlow Condensed; SIL OFL) so it works fully offline.

STEP 0 — BEFORE ANY CODE
1. Read SPEC.md end to end as an independent reviewer. List any contradictions, ambiguities or missing details that would block or change the build (max 10, most important first), with the section numbers.
2. Propose the repo structure, data layer design (Dexie schema incl. items, vendors, suppliers, locations, settings, photos as blobs) and a milestone plan that follows the build order in SPEC §14. Give each milestone its acceptance criteria (F-numbers) and its tests.
3. Stop and wait for my answers before writing code.

HOW TO WORK
- Init git if needed; commit at the end of each milestone with a clear message. Don't create a GitHub repo, push, or set up Pages until I say so.
- After each milestone, run a separate verification pass written as a review of someone else's work: check each F-criterion in that milestone against SPEC §5 with cited evidence (test names, file/line, or what you ran). Fix what fails, then summarize: completed / verified / changed / remaining uncertainty.
- Keep docs/session-log.md with timestamps (America/Chicago) for time accounting.
- Flag risk level on high-stakes parts (backup/restore round-trip, price import, PIN handling, order math) and say when an independent review in a fresh session is worth it.

MUST-HAVE TESTS (Vitest)
- SPEC §4: all four worked examples, the "no price" rule, and the red/yellow/OK status rules.
- Seed import: 129 items, 168 vendor options, 128 photos, 9 suppliers; with on_hand = 0 the order list totals exactly $8,413.66 (124 priced lines).
- CSV/ZIP export → restore round-trip with no data loss (notes with commas/newlines, photos, suppliers.csv, locations.csv, last_counted). Columns matched by header name (SPEC §7).
- Price-update import is all-or-nothing (SPEC F18) and never touches counts.
- Supplier and location rename/remove with replacement (F23, F25); category remove blocked until empty (F9).
- Label layout math (positions, start position, 0.5 mm nudge) for all §9 layouts. Label sheet sizes are still unconfirmed (SPEC §15 Q2): keep layouts as data and mark the geometry "verify against package".

UI REMINDERS
Landscape first (1280×800 CSS px) with a side rail, bottom tabs in portrait. Touch targets ≥ 48 px; quick-adjust steppers labeled "On hand". Stock status always uses color + icon + word. Destructive buttons are black with a red outline. Mentor PIN rules exactly as SPEC §6 (5-minute unlock, lock button showing the countdown).

Start with Step 0.
```
