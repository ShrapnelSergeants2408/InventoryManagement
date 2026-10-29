# Future features — shared foundations (draft)

**Status:** draft spec from Dan's interview, 2026-10-29 16:58–17:38 · **Applies to:** [tool checkout](01-tool-checkout.md), [part usage log](02-part-usage-log.md), [pit trips](03-pit-trips.md)
**Base:** SPEC v0.18, app 1.0.0 · **Numbering:** features continue from F32; sections from §22. Everything here is a proposal until it's merged into `docs/SPEC.md`.
**Answers:** `future-features-interview-log.md` (every answer, with times).

These pieces are used by more than one of the three features, so they're specified once here. Build order (Dan, 18:02): **tool checkout, then pit trips, then part usage**. The people list ships with tool checkout. Projects (§23.3) ship with pit trips, which is the first feature to create them (event projects); part usage adds the basket's project picker later.

---

## 23. Shared foundations

### 23.1 Architecture: stay file-based (Dan, 17:03)

There is still no server and no live sync (§13 is unchanged on that point). The shop tablet stays the only full copy of the inventory. Other devices join from a **kit file** and send back a **cumulative activity file**, exactly as helpers do (§18). After this work there are four device roles:

| Role | Joins with | Can do | Sends back |
|---|---|---|---|
| **Main tablet** | First-launch setup (F22) | Everything | Count kits, tool kits, pit kits, backups |
| **Helper** (§18) | Count kit | Count, locations, barcodes, propose items | Counts file |
| **Tool station** (§24.4) | Tool kit | Check out / return the tools it owns, report a problem | Tool activity file |
| **Pit device** (§26.5) | Pit kit | Find parts, mark parts used, log things added at the event | Used-at-event file |

First launch (F22) gains two more choices after **Set up the shop tablet** and **Join as a helper**: **Join as a tool station** and **Join as a pit device**. Each opens its own kit file. Every non-main role shows a navy identity bar like helper mode (§17): "TOOL STATION · <name>" or "PIT · <event name>".

**Rules shared by every kit and activity file** (taken from §18 so they stay consistent):
- An activity file is **cumulative** since the kit was opened, so a lost file is covered by the next one and sending twice is always safe. The main tablet ignores events it has already imported (each event has an id).
- The device shows "Last sent <time> · n changes not sent yet". A navy banner reminds the user to send when unsent changes exist.
- The main tablet previews every import before anything changes, and shows how old the data from that device is ("Station data from 3:45 PM").
- Kits never carry the PIN or its hash, prices, settings or backups.

### 23.2 People list (F33)

**Purpose:** the names that tool checkout (and later features) pick from.

**Person (main tablet; copied into tool kits and pit kits)**

| Field | Required | Notes |
|---|---|---|
| id | yes | `pp-` + 5 characters from the item-id alphabet (`src/domain/ids.ts`), random, so a removed person's badge can never point at someone new |
| name | yes | **First name + last initial**, e.g. "Alex R." (Dan, 17:06). Unique, ignoring capitals |
| role | yes | `student` or `mentor` (Dan, 17:03) |
| archived | yes | Default no. Archived people are hidden from pick lists and their badge stops working, but history still shows their name. They can be restored (Dan, 17:06) |
| created / updated | yes | Date-time with offset |

| # | Feature | Acceptance criteria |
|---|---|---|
| F33 | Manage people | **More › People**, PIN required for add, rename, archive and restore (Dan, 17:06; same as suppliers). The list shows active people first, mentors and students in separate groups, then a collapsed **Archived** group. Duplicate names are rejected. The add form shows the hint "First name and last initial, e.g. Alex R." A name that looks like a full last name (two words, second longer than 2 characters without a period) gets a soft warning, which can be overridden. Renaming updates every place the name is shown, but history lines keep the name as it was when they were written (copied, like order lines) |
| F34 | Pick a person | Wherever a name is asked: a grid of large name buttons (≥ 64 px), the 6 most recently picked on this device first, then all active people A–Z, with a search box once the list passes 20. **Or scan a badge** (F35): scanning anywhere on the pick screen picks that person. An archived person's badge shows "This badge is no longer active — ask a mentor" |
| F35 | Personal QR badges | Printed from **Labels › Badges** on the same label sheets as parts (§9 layouts; Dan, 17:06). Payload `2408:pp-XXXXX`. The label shows the QR, the name and role. Select people (or "All active") and print, as with item labels |

**Scanning:** `2408:pp-…` is a badge, `2408:ct-…` a container (§26), any other `2408:` code an item (§9). The Scan tab (F21) given a badge outside a pick screen shows that person's tools out now (§24).

**Role:** shown on badges and pick lists, and the Out now list can filter by it. Role **does not** replace the PIN: a mentor still types the PIN for PIN actions (see open question Q1).

**Backups (§7):** `people.csv` (id, name, role, archived, created, updated) in the full backup. People are data, like suppliers, so restore brings them back.

### 23.3 Projects (F36)

Defined here because part usage (§25) and pit trips (§26) both use it.

| Field | Required | Notes |
|---|---|---|
| id | yes | Generated |
| name | yes | Unique, ignoring capitals, e.g. "Comp bot", "Practice bot", "Outreach", "District event — Belleville 2027" |
| kind | yes | `project` (made by a mentor) or `event` (made by a trip, §26.3) |
| archived | yes | Hidden from pickers; reports still show it |

| # | Feature | Acceptance criteria |
|---|---|---|
| F36 | Manage projects | **More › Projects**, PIN required for add, rename, archive (Dan, 17:24: "mentor-managed"). Event projects are made automatically when a trip starts and can be renamed or archived like any other. In `projects.csv` in the full backup |

### 23.4 PIN changes (§6)

- **PIN required:** managing people (F33) and projects (F36); marking an item lendable or PIN-to-check-out (F37); checking out a PIN tool (F38); clearing Needs repair (F40); setting up or retiring a tool station (§24.4); deleting a packing template, removing a container, and closing a trip with lines still open (§26).
- **No PIN:** picking a name, printing badges, checking out and returning non-PIN tools, reporting a problem, Took parts / Put back (§25), packing and unpacking (§26).
- Tool stations and pit devices have **no PIN**, like helpers (§6). Anything that needs a mentor goes to the shop tablet.

### 23.5 §13 Out of scope — changes

Remove "Usage log (who took what)" and "competition pit-kit checklist" from §13. Keep "live multi-device sync". Note that part usage records no names (§25), so "who took what" stays out of scope for parts.

---

## Details Claude decided (Dan to confirm)

- **D1.** Badge and container codes use the existing `2408:` prefix with new id prefixes (`pp-`, `ct-`), so the same scanner code tells them apart and old builds treat them as unknown codes rather than misreading them.
- **D2.** The soft warning for full last names (F33) is a nudge, not a rule, so a team with two "Alex R."s can use "Alex Ro."
- **D3.** History keeps names as written at the time. After a rename, old lines still show the old name.
- **D4.** First-launch gains two new choices (tool station, pit device) instead of one generic "join" that reads the kit to decide.

## Open questions

- **Q1.** Should the **mentor role** do anything beyond being a label, e.g. let a mentor's badge approve a PIN tool at the shop tablet? Dan chose PIN-only for PIN tools at the station (17:15); this asks about the tablet.
- **Q2.** Can one spare tablet be **both** the tool station and the pit device? Dan picked "spare tablet" for both. Recommendation: one role at a time. Turning the station into a pit device first asks it to send its tool activity, and the tablet takes those tools back (§24.4 Retire) for the trip.
