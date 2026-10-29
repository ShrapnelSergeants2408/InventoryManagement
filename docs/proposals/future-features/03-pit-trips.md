# Competition pit packing lists — "trips" (draft spec)

**Status:** draft spec from Dan's interview, 2026-10-29 17:32–17:38, plus Dan's addition at 17:44 · **Build order:** second (Dan, 18:02)
**Depends on:** [shared foundations](00-shared-foundations.md) (§23.1 kits, §23.3 projects), [tool checkout](01-tool-checkout.md) (tools checked out to the event)
**Later link:** [part usage log](02-part-usage-log.md). Until it's built, used-up and lost amounts are kept on trip lines; the usage log back-fills them when it ships (Dan, 18:05; §25.4a)
**Size estimate:** medium to large. Containers and templates are small; the trip lifecycle, pit device and two imports are the bulk.

---

## 26. Trips: pack, compete, unpack

**Problem:** a forgotten spare costs matches. Packing from memory misses things, nobody checks what came home, and lists never learn what wasn't needed.

**In one line:** a **trip** is copied from a **template**. It's packed at the shop by **container** (each tote has a QR label), runs at the event on a **pit device** that knows what's in each tote and records parts used up, and is **unpacked** at the shop with a follow-up list for anything that didn't come back. Each line's **"Used" box** shows whether it earned its place on the next list.

### 26.1 Decisions (Dan, 2026-10-29)

| Topic | Decision | Time |
|---|---|---|
| Placement | **Hybrid**: lists and packing on the shop tablet; a **pit device** joins with a **pit kit**; its **used-at-event file** is imported with a preview; unpacking at the shop. The tablet never leaves | 17:32 |
| Lists | **Templates**; each event starts as a copy you tweak; past events can be copied | 17:32 |
| Non-inventory things | **Typed lines** (name + quantity), never touch inventory | 17:32 |
| Containers | **Yes, with QR labels**; scan a container to see or tick its contents | 17:32 |
| Pit device can | **Mark parts used up**, **find which tote holds a part**, **log things added at the event** (bought or borrowed) | 17:35 |
| On hand while away | **Unchanged**; items show "n packed for <event>"; only parts used up are subtracted | 17:35 |
| Pit device | **Spare tablet** (tablet layout, camera scanning) | 17:35 |
| Ticking off | **Scan or tap, with counts** ("packed 3 of 4"), showing what's missing | 17:35 |
| Tools on the list | **Checked out to the event** at the device that owns them; unpacking returns them | 17:38 |
| Parts used up | **The event becomes a project** (§23.3), so usage reports show what it used and cost | 17:38 |
| Before the usage log exists | **Record on the trip, back-fill later**: used-up and lost amounts (with times) stay on trip lines; §25 back-fills them | 18:05 |
| Didn't come back | **Follow-up list**: Found / Used / Lost; the trip stays open until it's empty | 17:38 |
| Active trips | **One at a time** | 17:38 |
| "Used" box | After the competition, each line gets a **"Used" check box** to decide whether it belongs on the list next year or next event | 17:44 |

**Two kinds of "used".** "Used up" is a part consumed at the event; it subtracts from on hand. The **"Used"** box (Dan, 17:44) means the line was needed at all, e.g. the banner was used, but the spare gearbox never left its tote. Screens always say "Used up" for the first, so the two are never confused (D17).

### 26.2 Data model (§3)

**Container** (managed list, like locations)

| Field | Required | Notes |
|---|---|---|
| id | yes | `ct-` + 5 characters (§23.2 D1); QR `2408:ct-XXXXX` |
| name | yes | Unique, ignoring capitals, e.g. "Spares tote A", "Pit cart drawer 2", "Battery cart" |
| notes | no | |
| order | yes | Packing walk order |

**Packing template**

| Field | Required | Notes |
|---|---|---|
| id, name, notes | yes / yes / no | e.g. "District event", "Championship", "Demo day" |
| lines | 0+ | Each: item_id *or* typed name (+ unit); quantity; container_id (blank = "Loose") |

**Trip**

| Field | Required | Notes |
|---|---|---|
| id, name | yes | e.g. "Belleville District 2027" |
| from | no | Template or earlier trip it was copied from (informational) |
| project_id | yes | The event project made when the trip is created (§23.3) |
| dates | no | Start and end dates (informational) |
| status | yes | `planning` → `packing` → `away` → `unpacking` → `closed` |
| lines | 0+ | Each: item_id or typed name; container; **wanted**; **packed**; **used_up** (total, from the pit file and unpack); **used_up_entries** (each: event_id, at, quantity — kept so §25 can back-fill exactly); **came_back**; **used** (Dan's box: yes / no / blank); **added_at_event** (yes for pit-added lines); **outcome** for follow-up (`found` / `used` / `lost`) with **outcome_at** and quantity |

Derived: an item's **packed for trip** = packed − came_back − used_up for the active trip. It is shown, never subtracted (Dan, 17:35). Order math is unchanged.

### 26.3 Planning (tablet)

| # | Feature | Acceptance criteria |
|---|---|---|
| F46 | Containers | **More › Containers**: add, rename, reorder (no PIN, like locations F25); remove needs the PIN and moves lines to "Loose". Labels screen gains **Containers** (§9 layouts, QR + name) |
| F47 | Packing templates | **More › Trips › Templates**: create, copy, rename, delete (delete needs the PIN). Add item lines by search or scan, typed lines, set quantity and container. A template line shows its **track record**: "Used at 2 of last 3 trips" (F52) |
| F48 | Start a trip | **More › Trips › New trip** (refused while another trip is open; Dan, 17:38): name, dates, start from a template or an earlier trip. Creates the event project. The new trip's lines show the same track record, with **Hide lines not used last time** as a one-tap filter so they can be removed deliberately (F52) |

While a trip is open, a navy banner on Inventory reads "<trip> — packing 42 of 60 · Open" (or "away" / "unpacking"), tapping through to the trip (D18).

### 26.4 Packing (tablet, F49)

- The trip moves from `planning` to `packing` at the first tick, or with **Start packing**.
- The trip screen groups lines by container, in container order, with a progress bar and **Still missing** filter.
- **Scan a container** → its lines; **scan an item** → its line (asks which container if it's on several); **tap** a line to tick it. Quantities use a stepper: "packed 3 of 4" (Dan, 17:35). Scanning an item not on the list offers **Add to this trip** (a line in the current container).
- **Lendable tools** (Dan, 17:38): ticking a tool line checks it out to the trip (§24, borrower_kind `trip`), never overdue while the trip is open.
  - A PIN tool asks for the PIN, as any tablet checkout does.
  - A station-owned tool can't be checked out at the tablet. Its line says "Check out to <trip> at the tool station", and the tool kit carries the active trip so the station offers it as a borrower. The line ticks when that activity is imported (D19).
- **Done packing** moves the trip to `away` (lines still missing get a warning, not a block) and enables **Send pit kit**.
- Item rows and detail cards show "n packed for <trip>" while away.

### 26.5 At the event — pit device (F50)

**Pit kit** `pit-kit-<trip>-<yyyy-mm-dd-hhmm>.zip`: `kit.json` (format, kit id, trip id and name, project name, created, app version), `lines.csv` (the trip's lines with packed amounts), `containers.csv`, `items.csv` (id, name, unit, category, photo_file for items on the trip only; no prices), `photos/` (optional).

**Pit device screens** (spare tablet, landscape; navy bar "PIT · <trip>"):
- **Find:** search or scan a part → which container it's in, and how many were packed (Dan, 17:35). Scanning a container lists its contents.
- **Used up:** scan or pick a part, stepper → records parts consumed (can't exceed packed + added). Ticks that line's **Used** box automatically.
- **Added:** typed line for things bought or borrowed: name, quantity, **Bought** or **Borrowed from team #** (with "return to team #" shown on the line until marked returned).
- **Used? review** (Dan, 17:44): available from the end-of-event screen. Every line with a Yes / No / Skip toggle and the "Used up" lines already Yes. Big buttons, so a tired student can finish in two minutes.
- **Send** in the bar menu: cumulative **used-at-event file** `pit-used-<trip>-<yyyy-mm-dd-hhmm>.zip` with `events.csv` (`event_id, type (used-up|added|returned-borrowed|used-flag), at, line_id, item_id, name, quantity, value`). A send reminder banner as in §23.1.

**Import (tablet, no PIN):** Trips › **Import used-at-event file** shows a preview:
- parts used up, per item, with "subtract n from on hand";
- added lines;
- Used answers.

On confirm, on hand drops and the trip lines update, keeping each used-up entry with its time. Import is idempotent. Once the usage log (§25) exists, the same step also writes `event-used` lines with the event project. Until then, §25.4a back-fills them from the trip lines (Dan, 18:05).

### 26.6 Unpacking (tablet, F51)

- **Start unpacking** (status `unpacking`). Scan containers or items back with the same steppers ("came back 2 of 3 expected", where expected = packed − used up).
- **Tools** scanned back return their trip checkouts.
- **Used? review** again on the tablet for lines not answered at the event, or to change answers (Dan, 17:44).
- **Didn't come back** (Dan, 17:38): every line still short. Each line gets:
  - **Found** — ticks it back;
  - **Used** — subtracts the remainder, records it as a used-up entry, and ticks the Used box;
  - **Lost** — subtracts, recorded as the line's Lost outcome.
  - Tools: Found returns the checkout; Lost closes the checkout, subtracts on hand and records a Lost outcome.
  - Recorded entries become `event-used` / `event-lost` usage lines, directly once §25 exists, or by its back-fill.
- Borrowed lines not yet returned stay on the list until marked **Returned**.
- **Close trip** when the list is empty. Closing with open lines needs the PIN and marks them Lost (§23.4).
- Closing ends the "packed for" display and the banner.

### 26.7 "Used" box and the next list (F52, Dan 17:44)

- Every trip line, including typed and added-at-event lines, has **Used: Yes / No / not answered**. Used up at the event ⇒ Yes automatically, and it can be changed.
- **Track record**, shown on template and trip lines: "Used at n of last m trips", counting only trips that were closed and had that line answered. Lines are matched across trips by item id, or by typed name ignoring capitals.
- **Next time:**
  - Starting a trip from a template or earlier trip marks lines **not used last time** with an outline "NOT USED LAST TIME" chip. **Hide lines not used last time** filters them, and **Remove** drops one.
  - **Added at event** lines from the last trip are offered as "Add to the list? (added at Belleville)".
  - When a trip closes, **Update template…** offers to copy these changes back to the template it came from: remove never-used lines, add added-at-event lines, adjust quantities to what was used up + 1 (D20). Every change is a tick box, all unticked by default.
- **Never automatic:** nothing is removed from a template without a person ticking it. Some spares are worth carrying even if they're never used (D21).

### 26.8 Backups (§7)

The full backup adds `containers.csv`, `templates.csv` (one row per line), and `trips.csv` + `trip-lines.csv`. Trips are kept forever so the track record works across seasons (D22). Pit device records are like helper records: not backed up.

### 26.9 Must-have tests (Vitest)

- Only one open trip; a new trip is refused until it's closed.
- Packed-for derivation; on hand and order math unchanged by packing.
- Ticking a tablet-owned tool checks it out to the trip; a station-owned one waits for the station's import; trip checkouts are never overdue.
- Used-at-event import: subtracts on hand, keeps each used-up entry (event id, time, quantity) on its line, is idempotent and cumulative; used up can't exceed packed + added. Built without §25, no usage lines are written and nothing fails.
- Used up ⇒ Used box Yes; Used answers from the pit file and the tablet merge (latest answer wins, D23).
- Follow-up outcomes: Found / Used / Lost change on hand and log as specified; tools Found or Lost close checkouts.
- Track record arithmetic: only closed, answered trips count; matching by item id and typed name.
- Template update offers only, never applies without a tick.
- CSV round-trip of every new file; container QR `2408:ct-…` resolves to the container, not an item.

---

## Details Claude decided (Dan to confirm)

- **D17.** "Used up" (consumed) vs **"Used"** (needed at all) as fixed wording on every screen.
- **D18.** Trips live under **More › Trips** with a banner on Inventory while one is open, instead of a seventh navigation tab (portrait bottom tabs are already full at six).
- **D19.** Station-owned tools are checked out to the trip at the station (tool kits carry the active trip), keeping "each tool has one owner" from §24.
- **D20.** Suggested template quantity after a trip = most used up at one event + 1, offered, never applied automatically.
- **D21.** The template never drops a line by itself, since emergency spares are often unused.
- **D22.** Trips are kept forever (not asked; follows the forever choices for tools and usage).
- **D23.** If the pit device and the tablet both answer "Used" for a line, the later answer wins.
- **D24.** Templates and trips need no PIN except deleting a template, removing a container, and force-closing a trip.

## Open questions

- **Q8.** Parts **bought** at the event: should unpack offer "Add to inventory" (creating or increasing an item), or stay typed lines only as decided?
- **Q9.** Should the pit device also see **lendable tools** in the trip (who has them in the pit)? Pit tool checkout wasn't chosen (17:35); this would be read-only.
- **Q10.** One spare tablet as both tool station and pit device (see §23 Q2)?
