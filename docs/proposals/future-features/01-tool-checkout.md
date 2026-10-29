# Tool checkout (draft spec)

**Status:** draft spec from Dan's interview, 2026-10-29 17:09–17:21 · **Build order:** first (Dan, 17:03)
**Depends on:** [shared foundations](00-shared-foundations.md) §23 (people list, badges, PIN changes) · **Used by:** [pit trips](03-pit-trips.md) (tools checked out to an event)
**Size estimate:** medium. The tablet side (F37–F40) is small to medium; the tool station (F41) adds a kit, an activity file and an import, modelled on §18.

---

## 24. Tool checkout

**Problem:** tools are borrowed, not used up. Nobody knows who has the good crimper or which drill went home.

**In one line:** mark tools **lendable**. People check them out by name or badge and anyone returns them with a scan. An **Out now** list shows what's out, and anything not back by the end of the day is overdue. A mounted **tool station** tablet at the tool wall can own the everyday tools, while mentor-only (PIN) tools stay with the shop tablet.

### 24.1 Decisions (Dan, 2026-10-29)

| Topic | Decision | Time |
|---|---|---|
| Placement | Inside the inventory app, plus a helper-style **tool station** that exchanges files | 17:09 |
| Which tools | Items marked **lendable**, in any category | 17:09 |
| Identical tools | **By quantity**: one item "Cordless drill", 4 on hand, "3 in · 1 out" | 17:09 |
| Recorded at checkout | Who, when, how many, optional **note**; some tools need the **mentor PIN** | 17:09 |
| Overdue | **Due back the same day** | 17:12 |
| On hand | **Unchanged**: on hand = owned; available = on hand − out. Order math ignores checkouts | 17:12 |
| Station sync | **Station owns its tools' checkouts**; the tablet shows the last-imported status | 17:12 |
| PIN tools | Per-item **"PIN to check out"** switch, honored **only at the shop tablet** | 17:12, 17:15 |
| Split | **By tool**: PIN tools out and back at the tablet only; other lendable tools at the station only (at the tablet if no station) | 17:18 |
| Broken | **Needs repair** blocks checkout until a mentor clears it | 17:15 |
| Returns | **Anyone, no name asked** | 17:15 |
| History | **Forever, in backups** | 17:15 |
| Station | **Old tablet mounted at the tool wall**, landscape, always on; tabs **Scan · Tools · Out now** | 17:18 |
| Tablet shows | Out now list, shop status strip count, availability and history on item detail, Needs repair filter | 17:18 |
| Station → tablet | **End-of-day send** with a reminder banner, cumulative files | 17:21 |
| Station data lost | **Rebuild from the tablet's last import**; later changes flagged "please confirm" | 17:21 |
| Quantity | **Choose how many** (default 1); partial returns allowed | 17:21 |

### 24.2 Data model additions (§3)

**Item — new fields**

| Field | Required | Notes |
|---|---|---|
| lendable | yes | Default no. PIN to change |
| pin_to_checkout | yes | Default no; only meaningful when lendable. PIN to change |
| needs_repair | yes | Default no |
| repair_note | no | Text from the problem report |
| repair_reported_at | no | Date-time with offset |

New CSV columns (§7) `lendable, pin_to_checkout, needs_repair, repair_note, repair_reported_at`, blank = no. Older files import with the defaults (header-name matching, §7).

**Checkout** (new store)

| Field | Required | Notes |
|---|---|---|
| id | yes | Generated on the device that made it (station ids carry the station id, so they never collide) |
| item_id / item_name | yes | Name copied at checkout, like order lines |
| quantity | yes | Whole number ≥ 1, ≤ available at that moment |
| borrower_kind | yes | `person` or `trip` (§26) |
| borrower_id / borrower_name | yes | Person or trip; name copied |
| note | no | Free text (Dan, 17:09) |
| out_at | yes | Date-time with offset |
| device | yes | `tablet` or the station's name |
| returns | 0+ | Each: event_id, at, quantity, device. No name (Dan, 17:15). The event id makes station imports idempotent |
| open | yes | Derived: quantity − returned > 0 |

**Repair event** (new store, for item history): id, item_id, kind (`reported` / `cleared`), note, at, device.

**Derived:** `out(item)` = sum of open checkout quantities. `available(item)` = on_hand − out(item), never below 0. A tool is **overdue** when it has an open checkout to a **person** whose `out_at` local date is before today. Checkouts to an active **trip** are never overdue (§26).

Order math (§4), stock status and the order list are **unchanged**: they use on_hand, never available.

### 24.3 Features on the shop tablet

| # | Feature | Acceptance criteria |
|---|---|---|
| F37 | Lendable tools | Item editor, PIN-locked section **Lending**: "Lendable" and "PIN to check out" (the second is disabled unless the first is on). Bulk: in Select mode (F28), **Make lendable…** applies to the selected items (PIN). Lendable items show a small "LENDABLE" chip (outline, never a status color, §17) |
| F38 | Check out / return | On a lendable item's detail card, from a scan, or from the Out now list. **Check out:** quantity stepper (default 1, max = available) → pick a person or scan a badge (F34) → optional note → **Check out**. PIN tools ask for the PIN first, with the reason "PIN-only tool". **Return:** scanning a tool that is out offers **Return**. If several people have it out, the open checkouts are listed (oldest first, preselected) with a stepper for how many come back. No name is asked. A tool owned by the tool station shows "Checked out at the tool station" with the station's last data time instead of the buttons |
| F39 | Out now and overdue | **Tools out** screen (from the shop status strip and More): every open checkout, grouped Overdue first, then by person or by tool (toggle), with tool, how many, who, since when, note and device. Overdue lines carry an icon and the word "OVERDUE" with a dark outline (status colors stay reserved for stock, §17). Filter by role (§23.2). The Inventory shop status strip (v0.17) gains "n tools out · n overdue" when nonzero; tapping it opens Tools out. Station-owned lines show "as of <time>". Item detail shows "3 of 4 available · Alex R. since Tue" and a **Tool history** list (checkouts, returns, repair events, newest first) |
| F40 | Needs repair | **Report a problem** (no PIN) on the detail card, in the return flow and at the station: a required note → item is **Needs repair**: an outlined "NEEDS REPAIR" chip with a wrench icon (never a stock-status color, §17), Check out disabled ("Needs repair — ask a mentor"). **Clear** needs the PIN and happens only on the shop tablet. Inventory filters (F5) gain **Needs repair** after Low spares only |

### 24.4 Tool station (F41)

**Setup (tablet):** More › **Tool station** (PIN). **Set up a station:** name (e.g. "Tool wall") → **Send tool kit** (share sheet). One station at a time (see D5).

**Ownership (by tool, Dan 17:18):**
- **Station-owned:** lendable tools without "PIN to check out" that were in the last tool kit sent to the station.
- **Tablet-owned:** PIN tools, any lendable tool added or changed since the last kit, and all tools when no station is set up.
- Each tool has exactly one owner, so checkouts never conflict.
- The tablet shows a navy banner on Tools out when tools changed since the last kit: "n tools changed — send a new tool kit".

**Tool kit** `tool-kit-<station>-<yyyy-mm-dd-hhmm>.zip`:
- `kit.json`: format version, kit id, station id and name, created at, app version, active trip (id and name) if any (§26).
- `tools.csv`: every lendable item (id, name, category, location, on_hand, pin_to_checkout, needs_repair, repair_note, photo_file). PIN tools are included so the station can show them as "Check out at the shop tablet".
- `people.csv`: active people only.
- `open-checkouts.csv`: the open checkouts of station-owned tools, as last known to the tablet.
- `photos/` (optional, on by default).

**Station screens** (landscape tablet; navy bar "TOOL STATION · <name>"):
- **Scan:** a large "Scan a tool" camera view, plus a type-in box for torn labels. A tool → its card: photo, name, location, "3 of 4 available", who has it → **Check out** (stepper, person or badge, note) or **Return** (as F38). Report a problem is available too. A PIN tool → "This tool is checked out at the shop tablet (mentor PIN)". A badge → that person's tools out.
- **Tools:** every tool from the kit with photo and status (In / n out / Needs repair / PIN-only), with search.
- **Out now:** open checkouts at this station, overdue first.
- **Send** (in the bar menu): "Last sent <time> · n changes not sent", **Send tool activity**. A navy banner on Scan reminds the user to send at the end of the day when unsent changes exist (Dan, 17:21).

**Tool activity file** `tool-activity-<station>-<yyyy-mm-dd-hhmm>.zip`, cumulative since the kit:
- `activity.json`: format version, kit id, station id and name, created at, sequence number, app version.
- `events.csv`: `event_id, type (checkout|return|problem), at, item_id, checkout_id, quantity, borrower_kind, borrower_id, borrower_name, note`.

**Import (tablet, no PIN):** Tools out › **Import tool activity**, or the Backup screen. The preview lists new checkouts, returns and problem reports. Events already imported are skipped. Two cases are flagged but still accepted:
- a checkout of a tool the tablet now owns (its ownership moved after the kit);
- a return of more than is out.

On confirm, the records join the tablet's history, and Tools out shows "Station data from <time>".

**Recovery (Dan, 17:21):** if the station's browser data is cleared, it re-joins with a new tool kit. That kit carries `open-checkouts.csv` as of the tablet's last import. The station shows a navy banner, "Started from shop tablet data of <time>. Changes after that are missing — please check the Out now list with the tools on the wall", until someone taps **Checked**.

**Retire (tablet, PIN):** import the station's last activity first (the dialog insists unless "The station is lost or broken" is ticked), then **Retire station**. The tablet takes ownership of every tool.

### 24.5 Backups (§7)

The full backup adds `checkouts.csv` (one row per checkout, returns flattened into `returns` as `event_id|at|qty|device;…`) and `repair-events.csv`.

Tool station records live in settings, like helper records. They are not backed up, and a restore keeps them, as it keeps the helper list (HANDOFF §8). After a restore the tablet's checkouts are as of the backup. Importing the station's latest activity file brings them up to date: the file is cumulative since the kit, and already-known event ids are skipped.

### 24.6 Must-have tests (Vitest)

- available = on_hand − open out; never negative; order quantity unchanged by checkouts.
- Overdue: out yesterday at 23:59 local time is overdue today; out today is not; a trip borrower is never overdue; DST and offset handling.
- Partial returns: 2 out, 1 back → 1 open; over-return flagged.
- Ownership: PIN tools always tablet-owned; tools changed after the last kit are tablet-owned; no station → all tablet-owned.
- Activity import is idempotent (the same file twice changes nothing) and cumulative (file 3 covers a lost file 2).
- Recovery kit carries exactly the open checkouts of station-owned tools.
- CSV round-trip of the new item columns, `checkouts.csv` and `repair-events.csv`; older files import with defaults.
- Archived person's badge refused at check-out; their history still shown.

---

## Details Claude decided (Dan to confirm)

- **D5.** One tool station at a time. Two stations would need to split tools between them; that can come later.
- **D6.** Return with several open checkouts: list them oldest first, preselected, so "no name asked" holds while the right borrower's line is closed.
- **D7.** Overdue uses an outlined "OVERDUE" chip, not red or amber, because §17 keeps red and amber for stock status.
- **D8.** PIN tools appear on the station read-only, so students don't think they're missing.
- **D9.** "Make lendable…" in bulk select saves marking 40 tools one by one.
- **D10.** Problem reports are allowed on any device; only clearing needs the tablet and PIN.

## Open questions

- **Q3.** Should returning a PIN tool also need the PIN, or only checking it out? (Draft: only checking out.)
- **Q4.** Should "due back the same day" have exceptions, e.g. a per-checkout "overnight OK" tick? (Draft: no; trips are the only exception.)
- **Q5.** Tool kits carry people's names. Fine to send by the same share-sheet routes as count kits?
