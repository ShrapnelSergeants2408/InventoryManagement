# Part usage log (draft spec)

**Status:** draft spec from Dan's interview, 2026-10-29 17:24–17:29 · **Build order:** third (Dan, 18:02)
**Depends on:** [shared foundations](00-shared-foundations.md) §23.3 (projects) · **Back-fills:** [pit trips](03-pit-trips.md), whose used-up and lost amounts are kept on trip lines until this log exists (§25.4a; Dan, 18:05)
**Size estimate:** medium. The log touches every screen that changes on hand; the basket and reports are new screens.

The proposal called this "part checkout (who took what)". Dan chose **no names** for part use (17:24), so it's renamed **part usage log**. It answers *what* was used, *when*, *how* (which screen) and *for which project*, but not *who*.

---

## 25. Part usage log

### 25.1 Decisions (Dan, 2026-10-29)

| Topic | Decision | Time |
|---|---|---|
| Placement | **Shop tablet only**: it owns on hand | 17:24 |
| Names | **Never** recorded for parts | 17:24 |
| Projects | **Optional, mentor-managed list** (§23.3) | 17:24 |
| What's logged | **Every on-hand change**, tagged with its source | 17:24 |
| Took parts screen | **Yes, a scan basket**: several parts, one project, one confirm | 17:27 |
| Undo | **On the confirming toast**; later fixes are normal adjustments (also logged) | 17:27 |
| Reports | **Most-used parts, use by project, suggested desired amounts, usage CSV** | 17:27 |
| Retention | **Forever, in backups** | 17:27 |
| Unused parts | **Put back** mode in the same basket, credited to the project | 17:29 |
| Project on the basket | **Optional, defaults to the last one used**; "No project" is one tap | 17:29 |

### 25.2 Data model (§3)

**Usage line** (new store; one per item per on-hand change)

| Field | Required | Notes |
|---|---|---|
| id | yes | Generated |
| at | yes | Date-time with offset |
| item_id / item_name | yes | Name copied, so lines survive an item's rename or deletion |
| change | yes | Signed amount in the item's unit (−3, +50). Changes of 0 aren't logged |
| on_hand_after | yes* | On hand after this change. *Blank only on lines back-filled from trips (§25.4a) |
| source | yes | See below |
| project_id / project_name | no | Only on `took`, `put-back`, `event-used` and `event-lost` lines; name copied |
| ref | no | What it came from: placed-order id, helper name, trip id, basket id |

**Sources**

| source | Comes from | Counts as use in reports? |
|---|---|---|
| `adjust` | Quick +/− and number entry (F3), item editor (F7) | No (could be a correction) |
| `took` / `put-back` | Took parts basket (F43) | Yes (put-back subtracts) |
| `count` | Count-in save (F24): the difference from the old on hand | No |
| `helper` | Import counts (§18.5), and the lines reversing it if the import is undone | No |
| `received` | Receiving (F31) | No |
| `added` | A new item's starting on hand (F6) | No |
| `event-used` / `event-lost` | Pit trips (§26.5, §26.6) | Used: yes. Lost: no (shown separately) |
| `undo` | The toast's Undo (F44); points at the line it reverses via `ref` | Cancels the original |

**Restore (F17) is not logged per item.** The usage log is part of the backup, so restoring brings back the backup's log, and the tablet writes one note line, "Restored from backup of <date>" (D11).

### 25.3 Features

| # | Feature | Acceptance criteria |
|---|---|---|
| F42 | Item history | Every on-hand change writes a usage line in the same database transaction as the change, so a crash can never leave one without the other. Item detail (F10) gains **History**: the last 10 lines (date, change, source, project) and **See all**. Deleting an item (F8) keeps its lines |
| F43 | Took parts / Put back | Opened from **Took parts** on the Scan tab, on the item detail card (that item already in the basket), and on the Inventory top bar to the left of the lock (§17: only the screen's main button sits right of the lock). A basket: a **Took / Put back** toggle at the top, **project** picker (defaults to this device's last project; "No project" is one tap; Dan, 17:29), then scan or search parts. Each scan adds a line with a stepper (default 1; scanning the same part again adds 1). Taking more than on hand shows "On hand is only 3 — take 3? The count may be off" and caps at on hand (D12). **Confirm** shows the totals ("Take 7 parts, 3 items, for Comp bot?") and saves all lines in one step. Lendable tools can't be added ("Tools are checked out, not taken" → opens check-out, §24) |
| F44 | Undo toast | After a basket, quick +/−, or number entry: a toast "Took 7 parts for Comp bot · **Undo**". Undo writes `undo` lines restoring on hand and the toast confirms "Undone". This toast stays 10 seconds and its Undo button catches taps; the rest of the toast lets taps through as §17 requires (D13). After it's gone, mistakes are fixed with a normal adjustment |
| F45 | Usage reports | **Order › Usage** (beside History, F32). Same date ranges as F32 (This month … Custom). **Most used:** items ranked by net use (`took` − `put-back` + `event-used`) with units and cost. **By project:** each project's net use and cost, expandable to items; "No project" is its own row. **Lost at events:** `event-lost` lines. **Suggest desired:** items whose average use per 4 weeks over the last 8 weeks (setting, D14) exceeds desired + spares, each with "Set desired to n" (no PIN, like F7). **Export usage CSV:** the raw lines for the range |

**Cost** in reports uses the preferred vendor's current price per unit (pack price ÷ pack size). Items without a price show "—" and are counted in a "n items without a price" note. These are estimates; actual spending stays in F32.

### 25.4 Backups (§7)

The full backup adds `usage.csv` with the columns of §25.2. The data-only CSV is unchanged. Retention is forever (Dan, 17:27). At about 50 lines a meeting, a season adds a few thousand rows, which is small.

### 25.4a Back-filling trips (Dan, 18:05)

Pit trips is built before this log, so trips record their own event use on trip lines (§26.2). When the usage log arrives, the database upgrade writes, for every trip line:
- one `event-used` line per recorded used-up entry;
- one `event-lost` line per Lost outcome,

each with the entry's own time, the trip's event project and `ref` = trip id. `on_hand_after` is blank for back-filled lines (the app can't rebuild it reliably), and the item history shows them with a "from trip records" note. The upgrade runs once, and running it again writes nothing. Trips recorded after the upgrade write their usage lines directly.

### 25.5 Must-have tests (Vitest)

- Back-fill: every used-up entry and Lost outcome becomes exactly one line with the right time, project and ref; a second run writes nothing; a database with no trips upgrades cleanly.

- Every on-hand path writes exactly one line per item with the right source: F3, F7, F24, F31, §18.5 import and its undo, F6, F43, F44.
- The change and the line are atomic: a failed transaction writes neither.
- Net use excludes `adjust`, `count`, `helper`, `received`, `added`; put-back subtracts; undo cancels.
- Basket: the same part scanned twice merges; the cap at on hand works; a lendable tool is refused.
- The project default is remembered per device; an archived project isn't offered but still reports.
- Restore replaces the log; CSV round-trip of `usage.csv`.
- Suggest-desired arithmetic, including items with no use and brand-new items.

---

## Details Claude decided (Dan to confirm)

- **D11.** Restore brings back the backup's log instead of logging a change per item. Logging hundreds of "restore" lines would bury real use.
- **D12.** Taking more than on hand caps at on hand and hints the count may be off, rather than allowing negative stock.
- **D13.** The undo toast is the one exception to §17's tap-through toasts, because an undo you can't tap is no undo. It lasts 10 s instead of 6.
- **D14.** "Suggest desired" looks at the last 8 weeks of use, scaled to 4 weeks. The window would be a setting.
- **D15.** Quick +/− asks for nothing new, so it stays as fast as today. Only the basket asks for a project.
- **D16.** Reports live under Order, next to History and spending, since they're about cost and reordering.

## Open questions

- **Q6.** Should quick − on an item offer an optional project chip after the tap, or is the basket enough?
- **Q7.** Should count corrections (big negative `count` lines) appear in a "shrinkage" report? That's the closest substitute for "where did the 8 NEOs go" now that names aren't recorded.
