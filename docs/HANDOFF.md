# Hand-off guide: Hiebert Home Inventory

For whoever looks after the app next: Dan, or a future Claude Code session. It covers what the app is, where everything lives and how to change it safely.

Written 2026-11-02, updated 2026-11-03 at app version 0.1.3 (SPEC v3.0, milestone H3: the Household and Holiday parts; next milestone H4, the Holiday setup).

---

## 1. What it is

A household inventory web app (PWA): what's in each bin and on each shelf, with QR labels. It's forked from the FRC 2408 shop inventory (app 1.0.0, SPEC v0.18). The FRC code, spec, reviews and mockups are in git history before commit `3ae9912` and upstream at `ShrapnelSergeants2408/InventoryManagement`.

| | |
|---|---|
| **Code** | GitHub, `dhiebert-whs/HouseholdInventory` (`upstream` remote = the FRC app, for reference only; nothing is merged back) |
| **Users** | The family, each on an iPhone, the app added to the home screen from Safari |
| **Where the data lives (now)** | In each phone's browser storage (IndexedDB via Dexie, database `home-inventory`). Until H5 there is **no sync**: each phone has its own copy, and backups are the only way to move data |
| **Where it's going** | H3 (0.1.3) split the app into Household and Holiday parts with a switch; H4 adds the Holiday setup workflow; H5 adds a Cloudflare Worker + D1 + R2 server and sync between phones (SPEC v3.0 §12, §15) |
| **Stack** | TypeScript, Preact, Vite; Dexie; Papa Parse (CSV), JSZip, a QR library, a barcode scanner with the zxing fallback (iPhone Safari has no BarcodeDetector); Vitest |

## 2. Where everything is

| Path | What it is |
|---|---|
| `docs/SPEC.md` | **The source of truth**: data model, features F1–F20, labels, screens, sync, milestones, decision log |
| `docs/proposals/2026-11-02-household-conversion-plan.md` | The planning interview and the decisions behind SPEC v2.0 |
| `docs/reviews/H*.md` | One file per milestone: what was built, the evidence, the details decided along the way, the phone check |
| `docs/session-log.md` | Running log of every work session (the FRC history is kept at the top) |
| `src/domain/` | Pure rules with no storage or screens: search, filters, the grouped list, labels, QR codes, validation |
| `src/data/` | The database (`db.ts`) and everything that reads or writes it |
| `src/io/` | Files in and out: CSV, backup ZIPs, sharing, images, barcode scanning |
| `src/ui/` | Screens (`screens/`), the app frame (`shell/`), shared pieces (`components/`) |
| `tests/` | Unit tests (Vitest). `tests/helpers.ts` builds test items |
| `scripts/h*-ui-check.mjs` | Browser checks: each drives the built app in headless Chrome with a real database and prints PASS/FAIL. One per milestone |

## 3. Set up a computer for development

1. Install **Node.js 22** and Git. Chrome is needed for the browser checks.
2. `git clone https://github.com/dhiebert-whs/HouseholdInventory.git`, then `npm ci`.
3. Commands: `npm run dev` (http://localhost:5173), `npm test`, `npm run build`, `npm run preview`.

A browser check runs on a built app:

```
npm run build
node scripts/h3-ui-check.mjs "C:/Program Files/Google/Chrome/Application/chrome.exe" <folder for screenshots>
```

It prints one PASS, FAIL or INFO line per check and exits 1 if anything failed. On Windows, pass folder arguments as Windows paths.

## 4. How to make a change

The routine that kept the FRC app's data safe:

1. **Spec first.** Write the change into `docs/SPEC.md` (decision log, features). Anything undecided goes to Dan as a question before coding.
2. **Branch** from `main` (`h2-short-name`). Never commit to `main` directly. Don't stack a branch on another open PR's branch: on 2026-11-02 that left H2a merged into a side branch instead of `main`.
3. **Build it with tests.** Rules go in `src/domain` with unit tests; screens in `src/ui`. A change to stored data or backup files needs a round-trip test (export, then restore, with nothing lost).
4. **Raise the version:** `APP_VERSION` in `src/io/backup.ts` and `package.json`; the browser check expects it.
5. **Check it:** `npm test`, `npm run build`, a new `scripts/h<n>-ui-check.mjs` (copy the latest), and the earlier checks still in `scripts/`.
6. **Write `docs/reviews/H<n>.md`** with what was built, the evidence, the details you decided ("for Dan to confirm") and the phone check steps. Add a session-log entry.
7. **Open a pull request** on `dhiebert-whs/HouseholdInventory` (not upstream).
8. **After Dan merges,** check that a deploy ran: `gh run list -R dhiebert-whs/HouseholdInventory`. On 2026-11-02 merges to `main` started no run; if none starts, `gh workflow run "Deploy to GitHub Pages" -R dhiebert-whs/HouseholdInventory --ref main` (with Dan's go-ahead).

## 5. Changing the database (the risky part)

- The schema is versioned in `src/data/db.ts` (`SCHEMA_VERSION`, currently 3):
  - v1 was H1;
  - v2 is H2a, with its upgrade from v1 (`tests/upgrade-h1.test.ts`);
  - v3 is H3, the two parts, with its upgrade from v2 (`tests/upgrade-v2.test.ts` and part 1 of `scripts/h3-ui-check.mjs`).
- Add a new `this.version(n)` with an `.upgrade()`; never edit an old one once a phone has real data.
- A table whose primary key changes needs a new table name: `photos` → `pictures` (H2a), and `categories` → `categoryList`, `tags` → `tagList` (H3, keyed by part and name).
- The 0.1.2 → 0.1.3 conversion lives in `src/domain/parts.ts` (`fromV2`), so the upgrade and restoring a 0.1.2 backup can't drift apart. 0.1.1 backups are no longer read.
- The app writes its schema version into the database. An **older** cached copy that finds a newer database shows "update needed" and writes nothing. Keep this guard working.
- Until H5, a phone's database is its only copy: make a **Full backup** on the phone before installing an update that changes the schema.

## 6. Updating the app on an iPhone

1. Open the app from the home screen and wait for the **Reload** banner.
2. If it doesn't appear: close the app (swipe up), open it again, wait a few seconds, and repeat once.
3. **More › App version** shows the version and build time: check it's the new one.

Never remove the home-screen app or clear Safari's website data for its address before a **Full backup**: until H5 that erases the inventory on that phone.

## 7. Keeping the data safe (until H5)

- **More › Backup & restore › Full backup (ZIP)**, then save to Files or iCloud Drive. The reminder is monthly by default (More › Settings; 0 turns it off).
- **Restore** replaces everything on the phone with a backup, after a comparison and an "I understand" tick.
- If the app shows first-time setup on a phone that had data, iOS cleared its storage: choose **Restore a backup file**.

## 8. Working with Claude Code

- Start a session with: "Read docs/HANDOFF.md and docs/SPEC.md, then …".
- Ask for questions before code when a feature isn't fully specified, and for the details it filled in to be listed for you to confirm.
- Ask for an independent review in a fresh session for anything touching backups, restore, the database or sync (SPEC §15 calls for one at H4).
