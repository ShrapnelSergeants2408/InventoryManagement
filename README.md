# FRC 2408 Inventory Management

The parts inventory app for FRC Team 2408, the Shrapnel Sergeants. Students and mentors use it to look up parts, count stock, see what needs ordering, record orders and spending, and print QR labels for bins and parts.

It is an **offline web app (PWA)** installed on the shop's tablet. There is no server and no account: the inventory lives in the tablet's browser storage, and files (backups, count kits, catalogs) move the data on and off the tablet.

| | |
|---|---|
| **Live app** | https://team2408.com/InventoryManagement/ |
| **Code** | `ShrapnelSergeants2408/InventoryManagement` on GitHub |
| **Main device** | The shop's Samsung Galaxy Tab S8, with the app installed from Chrome to the home screen |
| **Helper devices** | Students' phones (Android or iPhone) or spare tablets, used only during big counts |
| **Current version** | See `version` in `package.json`, or **More › About** in the app |

> **The tablet holds the only full copy of the inventory.**
> Never clear Chrome's site data for the app, because that erases the inventory. Back up every week (**More › Backup, restore & price import › Full backup (ZIP)**) to the team's shared Drive folder.

---

## Contents

1. [What the app does](#1-what-the-app-does)
2. [How it works](#2-how-it-works)
3. [Using the app](#3-using-the-app)
4. [Developing](#4-developing)
5. [Testing](#5-testing)
6. [Making a change](#6-making-a-change)
7. [Releasing and updating the tablet](#7-releasing-and-updating-the-tablet)
8. [Changing stored data safely](#8-changing-stored-data-safely)
9. [Vendor catalog scripts](#9-vendor-catalog-scripts)
10. [Troubleshooting](#10-troubleshooting)
11. [Documentation map](#11-documentation-map)
12. [Known limits and next steps](#12-known-limits-and-next-steps)

---

## 1. What the app does

The app has six areas: a side rail in landscape and bottom tabs in portrait.

| Area | What you do there | Spec features |
|---|---|---|
| **Inventory** | Browse parts by category and subcategory, search, filter (needs order, short, low spares, due for a recount, category, location, supplier), use the large ± buttons to change on-hand counts, select many items to move or add to an order list | F1–F5, F28 |
| **Item card** | Photo, notes, up to three vendor options with links and prices, desired and spare quantities, add to an order list, edit, delete (PIN) | F6–F11, F19 |
| **Order** | The **Automatic** list (everything below desired + spares, grouped by supplier with totals), named order lists, **Mark ordered…**, **Receive…**, order **History** and the spending summary, CSV export | F12–F14, F27, F30–F32 |
| **Scan** | Scan a QR label, a manufacturer barcode or a bin's location QR code with the camera (or type it in). A scan opens the item, attaches an unknown barcode, or lists what is in a bin | F21, F29 |
| **Count** | Guided count-in by category, by location, or by scanning. Set up **helper devices** for big counts and import what they counted | F24, F26 |
| **Labels** | Print QR labels on standard label sheets, with alignment nudges | F20 |
| **More** | Suppliers, categories, locations, backup, restore, price import, **Add items from a file**, reminders and limits, the mentor PIN, About | F9, F15–F18, F22–F23, F25, F33 |

### Stock status

Each item compares **on hand** with **desired** (what the team wants available) and **spares** (the cushion on top):

- **SHORT n**: red, octagon icon. On hand is below desired.
- **LOW SPARES**: amber, triangle icon. Desired is covered but spares are not.
- **OK**: outline, check icon.
- **NOT COUNTED**: dashed outline. The item has never been counted, and the order list treats it as 0 on hand.

The order quantity rounds up to whole packs and subtracts units already on open orders. The exact rules are in `docs/SPEC.md` §4.

### Mentor PIN

A 4–6 digit PIN guards actions that are hard to undo or that change money: deleting items, vendor and price fields, suppliers, renaming or removing categories and locations, restore, price import, adding items from a file, settings, and placed orders. Counting, adding items, editing locations, notes and photos, and building order lists need no PIN. Once entered, the PIN stays unlocked for 5 minutes by default. The lock button in the top bar shows the time left and locks again when tapped.

The PIN **prevents accidents; it is not real security**. A forgotten PIN is reset with the one-time **recovery code** shown at setup. Keep that code in the mentor binder, never on the tablet.

## 2. How it works

```
             ┌──────────── GitHub Pages (static files only) ────────────┐
             │  index.html, JS, CSS, fonts, icons, service worker       │
             └──────────────────────┬───────────────────────────────────┘
                                    │ first load and updates
                                    ▼
┌────────────────────────── Shop tablet (Chrome PWA) ───────────────────────────┐
│  Preact screens ─► domain rules ─► data layer (Dexie) ─► IndexedDB            │
│                                          ▲                                    │
│        files in/out (src/io): backups, CSV, count kits, catalogs, labels      │
└──────────┬──────────────────────────────────────────────────────┬─────────────┘
           │ count kit (ZIP)                       counts file (ZIP)│
           ▼                                                        │
   Helper phone/tablet  ── counts in its own database ─────────────┘
           (files travel through a shared Google Drive folder)
```

- **Offline first.** A service worker caches the whole app, so after the first load it works with no connection. The only exception is the shop tablet's first setup, which downloads the 5.4 MB starter catalog.
- **One database per device.** The shop tablet keeps everything in IndexedDB (`frc2408-inventory`). A helper device keeps a separate, smaller database (`src/data/helper-db.ts`) and never opens the inventory.
- **No sync.** Data moves only through files: full backups (ZIP), data-only backups (CSV), count kits and counts files for helpers, price-update CSVs and catalog ZIPs. The tablet's share sheet sends a file to Drive, email or Quick Share.
- **Updates wait for you.** When a new version is published, the app shows a **Reload** banner instead of reloading itself, so a count in progress is never cut off.
- **Old copies can't damage new data.** The database records its schema version. An older cached copy of the app that finds a newer database shows "Update needed" and writes nothing.

### Stack

TypeScript, [Preact](https://preactjs.com/), [Vite](https://vite.dev/) with `vite-plugin-pwa`, [Dexie](https://dexie.org/) over IndexedDB, Papa Parse (CSV), JSZip, `qrcode-generator`, `barcode-detector` (a ZXing WebAssembly fallback for browsers without the BarcodeDetector API, such as iPhone Safari), and Vitest. The fonts (Barlow Condensed, Atkinson Hyperlegible) are bundled so they work offline.

## 3. Using the app

This section is a short guide. The full step-by-step guides are `docs/HANDOFF.md` §9 (common jobs) and `docs/GETTING-STARTED-HELPERS.md` (a count with helper devices, including a card to hand to students).

### First setup of a shop tablet

1. On the tablet, open the live app in Chrome and use **Add to home screen / Install**.
2. Choose **Set up the shop tablet**. Set the mentor PIN, write down the **recovery code**, and confirm.
3. Choose **Load the starter catalog** (129 FRC parts with photos), **Restore a backup file**, or **Start empty**.
4. In **More › Reminders & limits**, set the season start date, the school-year budget, and the shared Drive folder links.
5. Make a **Full backup** right away and put it in the Drive folder.

If the tablet ever shows first-time setup unexpectedly, Chrome cleared its storage. Set a PIN, choose **Restore a backup file**, and pick the latest backup.

### Everyday jobs

| Job | Where |
|---|---|
| Find a part | Inventory search box (it searches name, part numbers, suppliers, location, notes, category and barcode), or Scan its label |
| Take or return parts | ± on the item row, the item card or the scan result |
| Add a new part | Inventory › **Add**, or scan an unknown barcode › **Add a new item** |
| Count the shop | Count › **Start a new count** (by category, by location, or scanning) |
| Big count with several devices | Count › **Helper devices**. See `docs/GETTING-STARTED-HELPERS.md` |
| See what to buy | Order › **Automatic**, or a named list |
| Record an order | A supplier group › **Mark ordered…** (PIN). When it arrives: the order › **Receive…** |
| Spending report | Order › **History** › Spending summary › Export CSV or Print |
| Refresh prices | Export a data-only backup, prepare a price-update CSV (SPEC §10), then **Price update import** (PIN) |
| Add many parts at once | More › Backup… › **Add items from a file** (PIN). This only adds items the tablet doesn't have; it never changes existing ones and can be undone once |
| Labels | Labels tab (choose items, then a sheet layout), or **Labels** on an item card or at the end of a count |
| Back up | More › Backup… › **Full backup (ZIP)**. A reminder appears after 7 days without one |

### Helper devices, in short

The tablet makes a **count kit** file for each helper (one per student device) listing that helper's categories or locations. The student opens the app on their phone, chooses **Join as a helper**, opens the kit, counts, and taps **Send my counts**, which makes a **counts file**. The mentor imports the counts files on the tablet (**Count › Import counts**), reviews conflicts and new items, and confirms. Rules that prevent lost counts: one kit per device, send at the end of every session, use the phone's normal browser (not a private tab or a browser inside another app), and remember that "saved to Downloads" is not "sent".

## 4. Developing

### Prerequisites

- **Node.js 22** (what CI uses) and npm
- Git
- **Google Chrome**, for the browser checks
- A code editor. VS Code works well with TypeScript

### Getting started

```
git clone https://github.com/ShrapnelSergeants2408/InventoryManagement.git
cd InventoryManagement
npm ci
npm run dev        # http://localhost:5173, live reload
```

The dev server uses your own browser's storage, which is separate from the tablet's, so experiment freely. To start over, clear the site data for `localhost:5173` in your browser.

| Command | What it does |
|---|---|
| `npm run dev` | Development server with live reload |
| `npm test` | All unit tests (Vitest, about 1,070 tests, under 10 seconds) |
| `npm run test:watch` | Unit tests in watch mode |
| `npm run typecheck` | TypeScript check only |
| `npm run build` | Type check and production build into `dist/` |
| `npm run preview` | Serves `dist/` the way the live site does |
| `npm run checks` | Every browser check against `dist/` (run `npm run build` first). See [Testing](#5-testing) |

### Project layout

```
src/
  main.tsx            entry point
  domain/             pure rules, with no storage and no screens: order math, stock status, search,
                      filters, labels, count rounds, helper-import planning, money, dates, validation
  data/               everything that reads or writes IndexedDB. db.ts holds the schema and versions;
                      helper-db.ts is the helper device's database
  io/                 files in and out: CSV, backup ZIP, restore, count kit, counts file, price import,
                      add items from a file, image resizing, the share sheet, barcode scanning
  security/           mentor PIN hashing (PBKDF2), the unlock timer, gate() for PIN-protected actions
  ui/
    App.tsx           boot: works out the device's role (shop tablet, helper or new) and opens its database
    shell/            frame, hash router, PIN pad host, toasts, update and backup banners
    screens/          one folder per area (inventory, item, order, scan, count, labels, more)
    helper/           the helper-device app (Count, Scan, Send)
    components/       shared pieces: dialogs, steppers, keypad, scanner, select bar
    data-hooks.ts     live queries: screens re-render when the data they read changes (live.ts: the shared hook)
    shell/lazy.tsx    screens loaded on demand (the everyday ones are in the main bundle)
  styles/             CSS, with design tokens in tokens.css
tests/                Vitest unit tests; tests/helpers.ts builds test items
scripts/
  m*-ui-check.mjs     browser checks, one per milestone (headless Chrome against dist/)
  m19-upgrade-check.mjs, m23-helper-upgrade-check.mjs   database upgrade checks (run by hand)
  run-checks.mjs      runs every browser check in parallel
  check-lib.mjs       shared start-up for the browser checks
  *-catalog.mjs       vendor catalog scripts (section 9)
seed/                 the starter catalog ZIP loaded at first setup
docs/                 spec, hand-off guide, reviews, proposals (section 11)
.github/workflows/    ci.yml (pull requests) and deploy.yml (main → GitHub Pages)
```

**Layering rule.** `domain/` imports nothing from `data/`, `io/` or `ui/`, so its rules can be unit-tested without a browser. `data/` owns every database transaction. A write that touches several tables runs in **one** Dexie transaction, so a failure leaves the tablet unchanged. Screens read through the hooks in `ui/data-hooks.ts` (Dexie `liveQuery`) and write through `data/` functions.

**Conventions.** Code comments cite the spec (`F27`, `§18.5`, `v0.20`) and the mockups (`mockup 2c`), so a comment leads back to the decision behind it. Read them before you change behaviour. Every list or import screen has loading, empty and error states. Touch targets are at least 48 px. Stock status always uses color, icon and word together (SPEC §17).

## 5. Testing

There are three layers. Run all three before any release.

### Unit tests (`npm test`)

About 1,070 Vitest tests in `tests/`. They use `fake-indexeddb` for database tests and run with `TZ=America/Chicago`, so tests that depend on dates give the same results on every machine. Rules belong in `src/domain` with unit tests. A change to stored data or a file format needs a **round-trip test** (export, restore, nothing lost).

`tests/tablet-backup.test.ts` is skipped unless you point it at a real tablet backup. Use it before any database change:

```
TABLET_BACKUP="C:\path\to\backup.zip" npx vitest run tests/tablet-backup.test.ts
```

A real backup is team data. Never commit one.

### Browser checks (`npm run checks`)

Each `scripts/m<N>-ui-check.mjs` drives the **built** app in headless Chrome with a real IndexedDB, prints one `PASS`/`FAIL` line per check, and saves screenshots. Together they form the regression suite (940 checks across 31 scripts on 2026-11-17).

```
npm run build
npm run checks                      # all of them, 4 at a time (about 6 minutes)
npm run checks -- m3 m25            # only some
npm run checks -- --jobs 2 --out C:\temp\checks
```

- Don't rebuild or switch branches while checks are running. Each check reads `dist/` and its own script when it starts.
- Each check has its own two ports (a preview port and a Chrome debugging port). A new check copies the latest one, calls `startCheck()` from `scripts/check-lib.mjs`, and takes two unused ports.
- `m10` rewrites `dist/`, so the runner runs it alone at the end.
- On Windows, pass folder arguments as Windows paths (`C:\...`), quoted if they contain spaces.
- Look at the screenshots at 1280 × 800 (landscape) and 800 × 1280 (portrait) as well as the PASS lines.

### Upgrade checks (by hand)

`scripts/m19-upgrade-check.mjs` (the tablet) and `scripts/m23-helper-upgrade-check.mjs` (a helper) open data written by an **older build** with a **newer build**. They need an older `dist/` and a backup as arguments (see each file's header). Run them, or a copy adapted to your change, whenever the database schema changes.

### Continuous integration

- **Pull requests** (`.github/workflows/ci.yml`): `npm ci`, `npm test`, `npm run build`.
- **Merge to `main`** (`.github/workflows/deploy.yml`): the same steps, then publish `dist/` to GitHub Pages.

The browser checks are **not** run in CI. Run them locally and record the result in the milestone review.

## 6. Making a change

Every release so far has followed this routine, and it is why the tablet has never lost data. Keep to it.

1. **Spec first.** Write the change into `docs/SPEC.md`: a new version at the top, the feature table, and the decision log (§16). Ask the app owner (currently Dan, a mentor) about anything not yet decided **before** coding.
2. **Branch** from `main`, named for the milestone (`m31-short-name`). `main` accepts only pull requests.
3. **Build it with tests.** Rules go in `src/domain` with unit tests, screens in `src/ui`. Changes to data or files need round-trip tests.
4. **Raise the version** in `package.json` and nowhere else. The app (More › About), backup and kit files, and browser checks all read it from there. Use semantic versioning: a patch for fixes, a minor version for features.
5. **Check it:** `npm test`, `npm run build`, a new browser check for the milestone, the full `npm run checks`, and the screenshots in both orientations.
6. **Write `docs/reviews/M<n>.md`**: what was built, the evidence (test and check counts), the details decided along the way for the owner to confirm, and the tablet check steps. Add an entry to `docs/session-log.md`.
7. **Open a pull request.** CI must pass. Two branches stacked on each other are merged with a **merge commit**, not a squash.
8. After the merge deploys, do the **tablet check** (section 7).

**Working with Claude Code.** Most of this app was built with Claude Code. Start a session with "Read docs/HANDOFF.md and docs/SPEC.md, then …", ask for questions before code, ask for the list of details it decided, and ask for an independent review in a fresh session for anything that touches backups, restore, database upgrades or money.

## 7. Releasing and updating the tablet

A merge to `main` is live at https://team2408.com/InventoryManagement/ within a few minutes (check the **Actions** tab on GitHub). The installed app on the tablet may keep the old version until it is told otherwise:

1. **Make a full backup on the tablet first.** It is the way back if the update goes wrong.
2. Open the app and wait for the **Reload** banner. It often doesn't appear.
3. If it doesn't: swipe the app away, then go to Android **Settings › Apps › Chrome › Force stop**. Open the app, wait about 15 seconds, close it and open it again.
4. **More › About** shows the version and build time. Confirm it is the new one.
5. Run the tablet-check steps at the end of that milestone's `docs/reviews/M<n>.md`.

**Never clear site data, and never test on the shop tablet.** It holds the real inventory. Test on your own browser or a spare device.

**Rolling back:** revert the merge on `main` with a new pull request. If the bad release changed the database schema, the older version will show "Update needed" on the tablet and refuse to write. In that case, ship a fix forward rather than a revert, or restore the backup made in step 1 after the revert.

## 8. Changing stored data safely

This is the risky part: a mistake here can lose the team's data.

- The schema lives in `src/data/db.ts`: `SCHEMA_VERSION` (currently 4) and one `this.version(n)` block per step. **Add a new version; never edit an old one.** Put data migrations in that version's `.upgrade()`.
- A helper's database version is 100 + the inventory schema version, and it follows automatically.
- Keep `checkSchema()` working. It stops an older copy of the app from writing to a newer database.
- Count kits and counts files carry a `format_version`; raise it when their format changes. Backup ZIPs record the app version in `manifest.json`, and restore recognises older backups by which files they contain. Either way, **keep reading old files**, because the team has old backups in Drive.
- Before shipping, test the upgrade against a copy of a **real tablet backup** (`tests/tablet-backup.test.ts`) and run an upgrade check modelled on `m19`/`m23`.

## 9. Vendor catalog scripts

These are Node scripts, run on a computer and never by the app, that build a catalog ZIP for **More › Backup… › Add items from a file**:

```
node scripts/andymark-catalog.mjs <output folder>              # facts only; --images to add photos
node scripts/shopify-catalog.mjs thriftybot <output folder>    # photos included; --no-images to skip
node scripts/shopify-catalog.mjs ctre <output folder>
node scripts/rev-catalog.mjs <output folder>                   # reads product pages; about 13 minutes
```

They check `robots.txt`, wait between requests, wait out "too many requests" (429) answers, and leave out discontinued, FTC/FLL, tool, bundle, merchandise and game-piece products by default, listing each product left out and why in `<vendor>-left-out.csv`. `--from-json` / `--from-pages` rebuild a ZIP offline from a saved feed. Each script's header lists every option, and SPEC §23.7 records the rules and the terms-of-service check for each vendor.

- **There are no scripts for WCP, Vulcan Spring or Bimba.** Their terms forbid scraping or copying.
- **Keep the ZIPs out of this public repository.** The photos belong to the vendors, and the scripts' photo use is for the team's own tablet only.
- Vendor sites change. If a script starts skipping everything or failing, re-check its parser against a saved page or feed (`--save-json`, `--save-pages`) and update its unit tests.

## 10. Troubleshooting

| Symptom | What to do |
|---|---|
| The tablet shows first-time setup | Chrome cleared its storage. Set a PIN › **Restore a backup file** › the latest backup |
| "Can't open the inventory" | Close other tabs of the app and tap **Try again**. Only start over if a mentor is sure and has a backup |
| "Update needed" | This copy of the app is older than the data. Update it (section 7). It writes nothing until then |
| "Waiting for other tabs" | Another tab or window of the app is open. Close it |
| An update doesn't arrive | Force-stop Chrome (section 7). Check **More › About** |
| Forgot the PIN | More › **Forgot the PIN?** › the recovery code from the mentor binder |
| A helper's counts are missing | Was the counts file actually uploaded, not just saved to Downloads? Ask the student to **Send my counts** again. The file is cumulative, so sending twice is safe |
| The camera doesn't scan | Allow the camera in Chrome's site settings, or use **Type a code** on the Scan screen (a barcode's digits, or an item id) |
| A browser check fails only when run with the others | Run that check alone (`npm run checks -- m12`). If it passes alone, it is a timing problem in the check, not the app |

## 11. Documentation map

| File | What it is |
|---|---|
| [`docs/SPEC.md`](docs/SPEC.md) | **The source of truth.** Every feature (F1–F33), the data model, calculations, PIN rules, file formats, UI conventions, and the decision log (§16) |
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | Hand-off guide: accounts, the change routine, the tablet check, keeping data safe, common jobs |
| [`docs/GETTING-STARTED-HELPERS.md`](docs/GETTING-STARTED-HELPERS.md) | Running a count with helper devices, with a student card |
| `docs/reviews/M*.md` | One per milestone: what was built, the evidence, the decisions, the tablet check |
| `docs/session-log.md` | A log of every work session |
| `docs/stage3-design-notes.md`, `docs/mockups/` | The approved screen designs. Code comments refer to mockup numbers |
| `docs/proposals/` | Ideas not yet approved: the review backlogs and `future-features/` (tool checkout, pit trips, part usage log) |
| `docs/history/` | Finished planning documents, kept for the record |

## 12. Known limits and next steps

Left out on purpose (SPEC §13): live sync between devices, sending orders to suppliers, automatic price checks, more than one photo per item, and undo for deletions.

The latest review of the whole app, with suggested improvements in priority order, is [`docs/proposals/2026-11-17-review-backlog.md`](docs/proposals/2026-11-17-review-backlog.md). Proposed larger features (tool checkout, pit trips, a part usage log) are in [`docs/proposals/future-features/`](docs/proposals/future-features/README.md). Nothing in `docs/proposals/` is approved until it is written into `docs/SPEC.md`.
