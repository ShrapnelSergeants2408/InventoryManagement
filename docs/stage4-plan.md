# Stage 4 — Build plan (proposal)

**Date:** 2026-10-17 CDT · **Status:** awaiting Dan's approval (with `spec-questions.md`). No code yet.

## 1. Dependencies

| Package | Role | Why this one |
|---|---|---|
| `vite`, `typescript` | Build | SPEC §2 |
| `preact` (+ `@preact/preset-vite`) | UI rendering | **Proposed** (decision for Dan). 4 KB, React-style components with JSX. About 15 screens with many states (PIN, dialogs, count-in) are much easier to keep correct with components than with hand-written DOM updates. Alternative: no framework (plain TS + small render helpers). It's doable, but more code to review. |
| `dexie` | IndexedDB | SPEC §2 |
| `papaparse` | CSV | SPEC §2 |
| `jszip` | ZIP | SPEC §2 |
| `qrcode-generator` | QR → SVG | Tiny, no dependencies, long-established |
| `barcode-detector` (zxing-wasm polyfill) | Scan fallback | Loaded **only** when native `BarcodeDetector` is missing (desktop dev). Its `.wasm` is bundled locally; by default it fetches from a CDN, which would break offline |
| `vite-plugin-pwa` (dev) | Service worker + manifest | Workbox precache of the app, fonts, logo and seed ZIP |
| `vitest`, `fake-indexeddb` (dev) | Tests | Dexie in Node for data-layer tests |
| `@fontsource/atkinson-hyperlegible`, `@fontsource/barlow-condensed` | Fonts | Self-hosted woff2 (SIL OFL), so no Google Fonts request; only the weights used |

No CSS framework. Design tokens (colors, sizes) come from §17 and the `.dc.html` sources as CSS custom properties.

## 2. Repo structure

```
index.html
package.json · tsconfig.json · vite.config.ts · .gitattributes · .gitignore
public/                       icons generated from assets/team-logo-*.png (192, 512, maskable)
assets/                       team-logo-512.png, team-logo-1024.png (source art)
seed/                         frc2408-starter-catalog-2026-10-17.zip (imported by URL, precached)
src/
  main.tsx                    boot: open DB → storage-error | setup | app
  domain/                     PURE logic: no DOM, no Dexie; this is where most tests point
    types.ts  money.ts  order.ts  status.ts  validate.ts  search.ts  filters.ts
    ids.ts  qr-payload.ts  stale.ts  count-walk.ts
    labels/layouts.ts (data)  labels/geometry.ts
  data/                       Dexie schema + repositories (all multi-table writes in transactions)
    db.ts  items.ts  suppliers.ts  locations.ts  categories.ts  photos.ts  settings.ts
  io/                         files in/out
    inventory-csv.ts (header-name mapping)  lists-csv.ts  order-csv.ts
    backup.ts (ZIP/CSV build)  restore.ts (parse → validate → plan → apply)
    price-import.ts  seed.ts  share.ts (canShare → share | download)  image.ts (resize/thumbnail)
  security/pin.ts             hash/verify, recovery code, unlock timer, gate(reason) → Promise
  ui/
    shell/  rail+tabs, top bar, lock pill, banners, toasts, dialog host, PIN pad
    components/  StatusChip, OnHandStepper, Keypad, LockedField, Picker, EmptyState …
    screens/  Inventory, Detail, Edit, Order, Scan, Count, Labels, More, Suppliers,
              Categories, Locations, Backup, Settings, Setup, StorageError
  styles/  tokens.css  base.css  print.css (labels)
tests/      *.test.ts per module + fixtures/ (small hand-made CSVs/ZIPs; the real seed ZIP)
docs/       SPEC, design notes, mockups, spec-questions, stage4-plan, session-log, milestone reviews
```

Rule: anything with a number or a decision in it lives in `domain/` or `io/` and is unit-tested. UI files only render and call those.

## 3. Data layer (Dexie)

```ts
db.version(1).stores({
  items:      'id, category, location, barcode, *supplierKeys, lastCounted',
  photos:     'itemId',            // { itemId, full: Blob (JPEG ≤1024px), thumb: Blob (~160px JPEG), updatedAt }
  suppliers:  'key, name',         // key = name.trim().toLowerCase()
  locations:  'key, order',        // { key, name, notes, order }
  categories: 'name, order',       // { name, order, subcategories: string[] } (see Q3)
  settings:   'key',               // key/value rows, below
});
```

**Item**
```ts
{ id, name, category, subcategory, location /* name or '' */, unit,
  onHand, desired, spares /* whole numbers ≥ 0 */, barcode, notes,
  source: 'starter' | 'team', lastCounted: '' | 'YYYY-MM-DD',
  preferredVendor: 1 | 2 | 3,
  vendors: [Vendor | null, Vendor | null, Vendor | null],   // fixed slots = v1..v3
  supplierKeys: string[],     // derived, for "how many options use WCP?" (F23)
  hasPhoto: boolean, updatedAt }
Vendor = { supplier, partNo, url, packSize /* int ≥ 1 */, packPriceCents: number | null, priceChecked: '' | 'YYYY-MM-DD' }
```

Why these choices:
- **Vendor options are embedded in the item**, in fixed slots: `preferred_vendor` is a slot number (§3/§7), and an item plus its vendors must save atomically. Supplier rename/remove rewrites the affected items in one transaction (129 items is trivial).
- **Items refer to suppliers and locations by name**, matching the CSV. Rename = one transaction over the list and the items. Uniqueness is checked case-insensitively through the `key`.
- **Photos live in their own table**, so list queries never load blobs. Thumbnails are generated on save and import (not part of backups).
- **Money is integer cents** (Q6). CSV in/out converts at the boundary.
- **Settings rows:** `pinHash`, `pinSalt`, `recoveryHash`, `reminderDays` (7), `staleDays` (90), `unlockMinutes` (5), `lastBackupAt`, `setupDoneAt`, `lastChangeAt`, `labelNudge.<layoutId>`, `recentLocations`. UI-only state (expanded groups, filters, last label layout) goes in `localStorage`.
- **Restore and price import are two-phase:** parse and validate everything in memory (including decoding photos) → build a plan → apply it in **one** `rw` transaction across all tables. Any failure before or during the transaction leaves the tablet unchanged.
- `navigator.storage.persist()` is requested after setup; `estimate()` feeds the storage status (§2).

## 4. Milestones (SPEC §14 order)

Each milestone ends with: tests green → a separate verification pass written as a review of someone else's work (`docs/reviews/M#.md`, each F-criterion vs §5 with evidence) → fixes → summary (completed / verified / changed / remaining uncertainty) → commit → session-log entry.

| M | Scope | Acceptance (SPEC) | Tests (Vitest) | Risk |
|---|---|---|---|---|
| **M1** Foundation: data model & storage | Vite/TS/Preact scaffold, `.gitattributes`, tokens and fonts, Dexie schema and repos, `domain/` math, inventory CSV codec | §3, §4, §7 header matching | **§4 four worked examples; no-price rule and "n without prices" count; red/yellow/OK boundaries** (on_hand = desired−1, desired, desired+spares−1, desired+spares; spares 0); pack-size and whole-number validation; CSV header-name matching (shuffled columns, missing `last_counted`, extra columns); **seed parse: 129 items / 168 options / 128 photos / 9 suppliers; on_hand 0 → 124 priced lines, $8,413.66** | **High** (order math) |
| **M2** Item list, search, filters | Shell (rail/tabs, lock pill placeholder, banners), Inventory screen, groups, rows, On-hand stepper, loading/empty/storage-error states | F1, F2, F3, F4, F5, §2 storage error, §17 | Group counts and "All stocked"; search across name/part #/supplier/location/notes; each filter and combinations; stepper never < 0, typed entry validation; expanded-state persistence | Low |
| **M3** Add/edit/remove; categories, suppliers, locations | Detail, Edit/Add, delete confirm, Categories/Suppliers/Locations screens with ▲/▼ reorder. PIN gate calls go through `gate(reason)`, wired to a temporary dev stub; the real PIN arrives in M6 | F6, F7, F8, F9, F10, F11, F23, F25 (PIN parts re-verified in M6) | **Supplier rename updates every option; remove with replacement (default `other`); `other` not removable; duplicates rejected. Location rename/remove with replacement or "No location"; reorder. Category remove blocked until empty; rename/reorder**; editor validation (preferred vendor exists, pack size); supplier picker A–Z with `other` last; new-item id format | Medium |
| **M4** Order math & order list | Order screen, groups, subtotals, stale flags/banner, count-in banner, CSV export | F12, F13, F14 | Grouping by preferred supplier; subtotals sum to grand total; **order CSV columns exactly per F13**, subtotal and grand-total rows, CSV quoting; stale at 90/91 days, blank date, ">half of priced lines" banner threshold | **High** (money) |
| **M5** Backup, restore, share, price import | Backup screen, full/data-only export, share-or-download (Q1), reminder banner, restore dialog (compare, back up first, "I understand"), price import with error list | F15, F16, F17, F18, §7 | **Full ZIP round-trip: identical items, vendors, notes with commas/quotes/newlines/unicode, photos (byte-equal), suppliers.csv, locations.csv, categories, last_counted. CSV-only restore keeps photos for matching ids and rebuilds missing suppliers/locations. Price import: one bad row → nothing changes, errors by row number; never touches on_hand/desired/spares/last_counted; unknown suppliers added; not-found ids listed.** Reminder clock, "Later" | **High** |
| **M6** Mentor PIN & settings | Setup (set PIN, recovery code), PIN pad, lock pill with m:ss, unlock timer, settings screen, change PIN, recovery; real gate replaces the stub | §6, F8/F9/F17/F18/F23/F25 gating | Hash/verify; 4–6 digits only; unlock expires at exactly unlockMinutes (fake timers); lock button locks immediately; recovery code works once and is replaced; **gate matrix: every "required" action in §6 asks, every "not required" action doesn't** | **High** |
| **M7** Photos | Take/choose, resize to 1024 px JPEG, thumbnail, enlarge, replace/remove (no PIN) | F19, §8 | Resize dimension math (landscape/portrait/small images not upscaled); photo record replace/remove; hasPhoto consistency | Low |
| **M8** QR labels & scanning | Labels flow (select → layout → start → nudge → preview → print/test print), print CSS; Scan with BarcodeDetector + fallback, typed code, unknown → attach/add | F20, F21, §9 | **Label geometry for 5160, 5163, 22805 and plain 1"/1½"/2": every label position, start position (skips), page breaks, 0.5 mm nudge stepping and per-layout storage**; QR payload `2408:<id>` round-trip; scan resolution (QR, bare id, barcode, unknown, case/whitespace) | Medium (print scaling verified on device) |
| **M9** Count-in | Start screen, three modes, one-item screen with keypad, group summary, resume | F24 | Walk order by category / by location then "No location"; skip desired 0; save sets on_hand + last_counted; resume where stopped; progress and before → after totals; status preview | Medium |
| **M10** Starter catalog & offline/PWA | First-launch flow (incl. Q2 restore path), seed import into Dexie, offer count-in, manifest + icons, service worker, persistent-storage request and status | F22, §2 | First-launch import into fake-indexeddb: counts, on_hand 0, spares 0, photos stored, lists created; build check: precache list includes index, JS/CSS, fonts, icons and seed ZIP | Medium |

After M10: a full regression and an end-to-end verification against every F1–F25. Then Stage 5 (fresh session plus a Tab S8 hands-on, including a real label print).

**Independent fresh-session review recommended** after **M5** (backup/restore/price import) and **M6** (PIN). M1/M4 order math is covered by exact-to-the-cent tests, so a fresh review is optional there.

## 5. Things only the Tab S8 can confirm (Stage 5 list, started now)

ZIP share vs. Downloads (Q1) · native BarcodeDetector formats · camera permission prompt in the installed PWA · print at 100% and real label alignment · `storage.persist()` result · font rendering.
