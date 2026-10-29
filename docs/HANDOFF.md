# Hand-off guide: FRC 2408 Inventory Management

For whoever looks after the app next: a mentor, a programming student, or a future Claude Code session. It covers what the app is, where everything lives, how to change it safely, and what to do when something goes wrong on the tablet.

Written 2026-10-29, at app version 1.0.0 (SPEC v0.18).

---

## 1. What it is

An offline web app (a PWA) for the team's parts inventory: look up parts, count stock, see what to order, record orders and spending, print QR labels.

| | |
|---|---|
| **Live app** | https://team2408.com/InventoryManagement/ (GitHub Pages; the shrapnelsergeants2408.github.io address redirects there) |
| **Code** | GitHub, `ShrapnelSergeants2408/InventoryManagement` (public) |
| **Main device** | The shop's Samsung Galaxy Tab S8, the app installed from Chrome to the home screen. **It holds the only full copy of the inventory.** There is no server |
| **Helper devices** | Other tablets or students' phones, for big counts only. They get a "count kit" file and send back a "counts file" (SPEC §18) |
| **Stack** | TypeScript, Preact, Vite; IndexedDB through Dexie; Papa Parse (CSV), JSZip, a QR library, a barcode scanner; Vitest for tests |

## 2. Where everything is

| Path | What it is |
|---|---|
| `docs/SPEC.md` | **The source of truth.** Every feature (F1–F32), the data model, calculations, PIN rules, backup formats and UI conventions. The top of the file lists what each version changed; §16 is the decision log |
| `docs/reviews/M*.md` | One file per milestone: what was built, the evidence (tests run), the details decided along the way and the tablet check. Read the latest few to see how work is done here |
| `docs/session-log.md` | Running log of every work session, with times |
| `docs/stage3-design-notes.md`, `docs/mockups/` | The approved screen designs (screenshots and their source). Code comments refer to mockup numbers, e.g. "mockup 2c" |
| `docs/proposals/` | Ideas not yet decided, e.g. `2026-10-29-team-feature-ideas.md` (part checkout, pit packing list, tool checkout) |
| `docs/history/` | Finished planning documents and the Stage 5 review, kept for the record |
| `seed/` | The starter catalog loaded on first setup (129 items, prices dated 2026-10-17) |
| `src/domain/` | Pure rules with no storage or screens: order math, stock status, search, labels, order history. Most unit tests are here |
| `src/data/` | The database (`db.ts`: schema versions, upgrades), and everything that reads or writes it |
| `src/io/` | Files in and out: CSV, backup ZIPs, count kits, counts files, price import, sharing |
| `src/security/` | The mentor PIN (hashing, the unlock timer, `gate()`) |
| `src/ui/` | Screens (`screens/`), the app frame (`shell/`), shared pieces (`components/`), helper mode (`helper/`) |
| `tests/` | Unit tests (Vitest). `tests/helpers.ts` builds test items |
| `scripts/m*-ui-check.mjs` | Browser checks: each drives the built app in headless Chrome with a real database and prints PASS/FAIL. One per milestone |
| `scripts/m19-upgrade-check.mjs`, `scripts/m23-helper-upgrade-check.mjs` | Upgrade checks: an older build's data opened by a newer build. Templates for the next database change |
| `.github/workflows/deploy.yml` | On every push to `main`: install, test, build, publish to GitHub Pages |

## 3. Accounts and access

- **GitHub:** the `ShrapnelSergeants2408` organization. `main` only accepts pull requests (a repository rule). Merging a PR to `main` publishes the app within a few minutes.
- **The domain** `team2408.com` is shared with the team website; the app is the `/InventoryManagement/` path.
- **Mentor PIN** (4–6 digits): set on the tablet. Forgotten? More › Forgot the PIN? asks for the **one-time recovery code** shown at setup. Keep that code off the tablet (the mentor binder). The PIN only prevents accidents; it isn't real security.
- **Backups** go wherever the share sheet sends them (Google Drive, email). Agree on one Drive folder.

## 4. Set up a computer for development

1. Install **Node.js 22** (what the deploy uses) and Git. Chrome is needed for the browser checks.
2. `git clone https://github.com/ShrapnelSergeants2408/InventoryManagement.git`, then `cd InventoryManagement` and `npm ci`.
3. Commands:

| Command | What it does |
|---|---|
| `npm run dev` | Runs the app at http://localhost:5173 with live reload. It uses its own browser storage, separate from the tablet |
| `npm test` | All unit tests (about 900, under a minute) |
| `npm run build` | Type check and production build into `dist/` |
| `npm run preview` | Serves `dist/` as the live site would |

A browser check runs on a built app: `npm run build`, then

```
node scripts/m22-ui-check.mjs "C:/Program Files/Google/Chrome/Application/chrome.exe" <folder for screenshots>
```

It prints one PASS or FAIL line per check and exits 1 if anything failed. The full set (`m2` … `m23`) takes about 25 minutes. Don't rebuild or switch branches while it runs, because each check reads `dist/` and its own script when it starts. On Windows, pass folder arguments as Windows paths (`C:\...`, quoted if they contain spaces).

## 5. How to make a change

This is the routine every milestone so far has followed. Keep to it: it's why the tablet has never lost data.

1. **Spec first.** Write the change into `docs/SPEC.md`: a new version at the top, the feature table, the decision log. Anything not decided goes to the person who owns the app (Dan) as a question before coding.
2. **Branch** from `main` (`m24-short-name`). Never commit to `main` directly.
3. **Build it with tests.** Rules go in `src/domain` with unit tests; screens in `src/ui`. A change to stored data or backup files needs a round-trip test (export, then restore, with nothing lost).
4. **Raise the version:** `APP_VERSION` in `src/io/backup.ts`. Two browser checks expect it: update the version in `scripts/m16a-ui-check.mjs` and `scripts/m17-ui-check.mjs` too.
5. **Check it:**
   - `npm test`.
   - `npm run build`.
   - A new browser check for the milestone (copy the latest one).
   - The full browser regression.
   - Look at the screenshots in landscape (1280 × 800) and portrait (800 × 1280).
6. **Write `docs/reviews/M<n>.md`** with what was built, the evidence, the details you decided ("for Dan to confirm") and the tablet check steps. Add a session-log entry.
7. **Open a pull request.** After it's merged and deployed, run the **tablet check** (section 7).

Two branches stacked on each other must be merged with a **merge commit**, not squash.

## 6. Changing the database (the risky part)

The inventory lives in the browser's IndexedDB on the tablet. A mistake here can lose the team's data, so:

- The schema is versioned in `src/data/db.ts` (`SCHEMA_VERSION`, currently 4, and one `this.version(n)` per step). Add a new version; never edit an old one.
- The app writes its schema version into the database. An **older** cached copy of the app that finds a newer database shows "reload to update" and writes nothing. Keep this guard working.
- A helper device's database uses version **100 + the inventory schema version** (`src/data/helper-db.ts`). It follows automatically when `SCHEMA_VERSION` rises.
- **Before shipping an upgrade:**
  - Test it against a copy of a **real tablet backup**: `TABLET_BACKUP="path\to\backup.zip" npx vitest run tests/tablet-backup.test.ts`. The file is team data and isn't in the repo.
  - Run an upgrade check modelled on `scripts/m19-upgrade-check.mjs` (the tablet) and `scripts/m23-helper-upgrade-check.mjs` (a helper).
- **Before installing it on the tablet,** make a full backup there. That backup is the way back.

## 7. Updating the tablet (the tablet check)

After a merge, the new version is live within a few minutes, but the installed app on the tablet may keep the old one:

1. Open the app and wait for the **Reload** banner. It often doesn't appear.
2. If it doesn't: swipe the app away, then Android **Settings › Apps › Chrome › Force stop**. Open the app, wait about 15 seconds, close it and open it again. (Or open the site in a Chrome tab and refresh.)
3. **More › About** shows the version and build time: check it's the new one.
4. Then run the steps listed at the end of that milestone's review file.

**Never clear Chrome's site data for the app. That erases the inventory.**

## 8. Keeping the data safe

- The tablet is the only full copy. The app reminds you weekly to back up (More › Backup, restore & price import › **Full backup (ZIP)**); send it to the shared Drive folder. A file saved only to the tablet's Downloads is lost with the tablet.
- **Restore** (PIN) replaces everything with a backup. Its confirmation compares the tablet with the backup and offers **Back up this tablet first**.
- If the tablet suddenly shows first-time setup, Chrome cleared its storage. Set a PIN, choose **Restore a backup file**, and pick the latest backup.
- If the app says it **can't open the inventory**, try again first (close other tabs of the app). Only start over if a mentor is sure and has a backup.

### Starting completely fresh (e.g. after testing)

The app has no "erase everything" button on purpose. A restore keeps the PIN, settings and helper list, so the only full reset is clearing the site's data in Chrome:

1. Optional: make a **Full backup** first if you might want the old data again.
2. Close the app. In Chrome: **Settings › Site settings › All sites › team2408.com › Delete data** (or **Clear & reset**). The domain is shared with the team website; clearing it only logs you out of that site.
3. Open the app from the home screen (online, so it can load). It shows first-time setup: **Set up the shop tablet**, a new PIN, a new recovery code (write it down), then **Load the starter catalog**, **Restore a backup file** or **Start empty**.
4. Set More › Reminders & limits again (they're back to the defaults). Label alignment nudges are reset too.
5. On every helper phone or tablet: Count › Send › **Leave helper mode**, or clear the site's data there too. Old count kits and counts files belong to the old data; don't import them.
6. Make a **Full backup** of the fresh start.

## 9. Common jobs (no code needed)

| Job | Where |
|---|---|
| Start of a season | More › Reminders & limits: **Season starts** (kickoff day), the **school-year budget**. Count › **Start a new count** for a fresh recount |
| Big count with several devices | Count › **Helper devices**: add a helper per student or tablet, send each a count kit, then **Import counts**. Helpers should send at the end of every session (iPhones clear website data after a few days unused) |
| Check prices before ordering | SPEC §10: export a data-only backup, ask Claude (with web search) for a price-update CSV, then More › Backup, restore & price import › **Price update import** (PIN) |
| Record an order | Order list › a supplier's **Mark ordered…** (PIN); when parts arrive, the order's **Receive…** |
| Spending report | Order › **History** › Spending summary; **Export CSV** or **Print summary** |
| Labels | Labels tab. For a new label sheet size, add one entry to the layout table in `src/domain/labels.ts` (a small code change) |
| Categories, suppliers, locations | More › each list. Renames and removals need the PIN |

## 10. Known limits

Not built on purpose (SPEC §13): live sync between devices, sending orders to suppliers, automatic price checks, more than one photo per item, undo for deletions.

The M5 review lists five theoretical edge cases that were never reproduced, such as no size limit on a restore file. They are in `docs/reviews/M5-independent.md` under "Plausible, not demonstrated".

## 11. Working with Claude Code

Most of the app was built with Claude Code. Sessions went best like this:
- Start a session with: "Read docs/HANDOFF.md and docs/SPEC.md, then …".
- Ask for questions before code when a feature isn't fully specified.
- Ask for the details it filled in to be listed for you to confirm.
- Ask for an independent review in a fresh session for anything touching backups, restore, the database upgrade or money.
- Keep the routine in section 5. Claude Code follows it when it's asked to, and the review files show what to expect.
