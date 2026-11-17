# Full review — regression, usability, code (2026-11-17)

**Reviewed:** `main` at the M30 merge (`3c4af38`), app version 1.6.0, SPEC v0.25. **Status:** proposals only. Nothing here is approved; each item needs a spec entry before it's built (HANDOFF §5). The priority shown is the reviewer's suggestion, for Dan to set.

## 1. Regression result

| Layer | Result |
|---|---|
| `npm test` | **1,073 passed**, 1 skipped (`tablet-backup.test.ts`, which needs a real backup), 57 files, 6.8 s |
| `npm run build` | Clean type check and build. One warning: the main chunk is 755 kB (227 kB gzipped) |
| `npm run checks` | **940 checks pass across 31 scripts, 0 fail, no console errors or warnings**, in 368 s (4 at a time) |
| Upgrade checks (m19, m23) | Not run. They need an older build and a real tablet backup, and nothing in the schema has changed since M23 |
| `npm audit --omit=dev` | 0 vulnerabilities in what ships. 4 moderate ones in build tools only |
| `npm outdated` | Patch and minor updates only: preact 11.0.1 → 11.2.0, vite 8.3.4 → 8.3.8, dexie 4.4.6 → 4.4.7, vitest 5.0.5 → 5.1.0, papaparse, barcode-detector, fake-indexeddb |

The app is healthy. Data safety is the strongest part of the codebase: writes run in single transactions, an old cached copy can't write to a newer database, restore and every import show a preview before the PIN, and file formats have round-trip tests.

## 2. Measured: inventory drawing time with large catalogs

M30's catalog scripts produce 400–750 parts per vendor (SPEC §23.7), so the tablet could reach about 3,000 items. A probe (headless Chrome, the built app, items cloned into IndexedDB, then the page reloaded) timed typing into the Inventory search box. Each figure runs from setting the box's value to two animation frames later. "CPU ÷ 4" is Chrome's CPU throttling, a rough stand-in for the Tab S8 and students' phones.

| Items | CPU | Reload → list | Type "b" (rows drawn) | Type "be" (rows) | Clear |
|---|---|---|---|---|---|
| 129 (today) | full | 184 ms | 67 ms (100) | 26 ms (17) | 30 ms |
| 129 | ÷ 4 | 395 ms | 437 ms (100) | 57 ms (17) | 28 ms |
| 1,029 | full | 186 ms | 349 ms (797) | 40 ms (136) | 17 ms |
| 1,029 | ÷ 4 | 409 ms | **2,478 ms** (797) | 285 ms (136) | 74 ms |
| 3,029 | full | 198 ms | 954 ms (2,348) | 139 ms (405) | 25 ms |
| 3,029 | ÷ 4 | 1,062 ms | **7,738 ms** (2,348) | 843 ms (405) | 182 ms |

The search logic itself is cheap: `buildInventoryView` takes 3.5–4.2 ms at 2,000 items (Vitest, desktop). **The cost is drawing every matching row.** Search and filters expand every group, so each row is drawn with its stepper and thumbnail. Results update on every keystroke, so the first letter typed draws almost the whole catalog.

## 3. Recommendations

### High: do before loading the vendor catalogs onto the tablet

| # | Item | Why | Suggested fix |
|---|---|---|---|
| R1 | **Limit the rows drawn for a search or filter** | §2: at 3,000 items, a one-letter search blocks the screen for about 1–8 s, and each later keystroke waits behind it | Draw the first ~100 matches with "Show 100 more (n left)", or draw groups only as they scroll into view. Wait about 150 ms after the last keystroke before searching. Keep the counts in the headers exact. Add a browser check at 3,000 items |
| R2 | **Check for updates while the app is open** | `registerSW` (`src/ui/shell/UpdateBanner.tsx`) checks only when the page loads. An installed app reopened from Android's recent apps never loads again, which is why the Reload banner "often doesn't appear" and HANDOFF §7 needs Force stop | In `onRegisteredSW`, call `registration.update()` when the app becomes visible again (at most once every 30 min) and every hour. Add **Check for updates** to More › About, using the existing `updateAndReload()`. Then simplify HANDOFF §7 |
| R3 | **Escape formulas in exported CSVs** | M5-independent left this open. Vendor names now come from scraped catalogs, and the order and spending CSVs are opened in Sheets and Excel. A cell starting with `=`, `+`, `-` or `@` is read as a formula (a name such as "-20 thread …" turns into an error) | Prefix `'` in the **order and spending** CSVs only (they are opened by people, not re-imported). Leave backup CSVs exact so round trips stay unchanged |

### Medium: usability

| # | Item | Notes |
|---|---|---|
| R4 | **Labels from an Inventory selection** | Select mode offers Move to… and Add to order list…, but not Labels. Printing labels for 20 new parts means picking them again on the Labels tab. `href.labels(ids)` already exists; add it to the select bar |
| R5 | **Catalog parts the team doesn't stock** | Add items gives each new part on hand 0, desired 0 and no last-counted date (`src/io/add-items.ts`). They don't need ordering, but each shows **NOT COUNTED**, and the Order screen's count-in banner (`countBanner: uncounted > 0`, `src/domain/stale.ts`) stays up until every one is counted. After 600 vendor parts, that banner and the category headers' "n not counted" lose their meaning. Consider marking imported parts as "reference" (or counted as 0 at import) so they stay out of count rounds and the not-counted totals until the team stocks them |
| R6 | **Restore file size limit** | Add items limits files to 50 MB, but restore has no limit (M5-independent, still open). Use the same limit, with a clear message |

### Medium: code efficiency and maintainability

| # | Item | Notes |
|---|---|---|
| R7 | **One generic live-query hook** | `src/ui/data-hooks.ts` has six copies of the same `liveQuery` → `Live<T>` hook (snapshot, order lists, orders, helpers, pending, settings). One `useLive(query, deps)` removes about 80 lines, and a fix to one copy then reaches all |
| R8 | **Split the bundle** | Everything is one 755 kB chunk; only the scanner fallback loads on demand. Load JSZip (98 kB), Papa Parse, and the rarely used screens (Labels, History, Placed order, Helpers, Import, Backup, Settings, the managed lists) with `import()`. This helps most on helper phones' first load and on cold starts. The service worker still caches everything for offline use |
| R9 | **Break up the largest components** | `Count()` in `count/Count.tsx` is about 480 lines with 22 `useState` hooks; the editor's `Form` is about 460 lines. Move the walk state into a reducer or custom hook in `src/domain`, where it can be unit-tested like the rest of the rules |
| R10 | **A ± tap re-reads the whole inventory** | Each count change writes `items` and `settings`, so `useSnapshot` reloads every item and list and the open list is re-rendered. Fine at 129 items. With R1, check a ± tap at 3,000 items, and memoise row components (`memo(ItemRow)`) if it lags |

### Low: upkeep

| # | Item | Notes |
|---|---|---|
| R11 | **Add a license** | The repository is public with no `LICENSE`, so legally nobody else may reuse it. Pick one (MIT is common for team code). The bundled fonts are already SIL OFL |
| R12 | **Lint and format** | There's no ESLint or Prettier. Add `eslint` with `typescript-eslint` and `eslint-plugin-react-hooks` (it catches stale hook dependencies, which hand review misses) and run it in `ci.yml` |
| R13 | **A browser smoke test in CI** | GitHub's Ubuntu runners have Chrome. Running 3–4 fast checks (m2, m11, m30) on every pull request would catch a broken screen even when nobody runs `npm run checks` locally |
| R14 | **Dependency patch updates** | See §1. Apply them in one PR with the full regression run |
| R15 | **Documentation drift** | SPEC's title line still says v0.25 is "not yet built", and the status line still lists v0.21–v0.23 as "for Dan to confirm". `future-features/README.md` plans §23–§26 and F33–F52, but M30 has since used §23 and F33, so renumber before the next merge. HANDOFF's test count and run time are updated in this branch |
| R16 | **Tidy `scripts/`** | 31 browser checks, 2 upgrade checks, 8 catalog files and helpers share one folder. `scripts/checks/` and `scripts/catalog/` would make it easier to find things (update `run-checks.mjs` and the docs together) |

## 4. Suggested order

R2 and R1 first (one small milestone: they change how the app feels on the tablet, and R1 must come before the vendor catalogs are loaded), then R3 and R4, then R7–R9 as a cleanup milestone with no behaviour change, so the browser checks prove nothing moved. Do R11–R16 whenever convenient.
