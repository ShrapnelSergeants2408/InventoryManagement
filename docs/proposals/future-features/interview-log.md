# Future features interview log

Part checkout, tool checkout and the competition pit packing list. Started from `docs/proposals/2026-10-29-team-feature-ideas.md` and SPEC v0.18. Each line is Dan's answer, with the local time (America/Chicago) when it was recorded.

## Shared foundations

**Round 1, 2026-10-29 17:03**
- People list: **names + role** (student / mentor).
- Identifying at the moment of action: **both** — pick from the list, or scan a personal QR badge.
- Sync: **stay file-based** (no server). Separate devices exchange files, like helpers.
- Build order: **tool checkout first**.

**Round 2, 2026-10-29 17:06**
- Managing the people list: **mentor PIN** for add, rename and remove (like suppliers and locations).
- Leavers: **archive**. Hidden from the pick list, badge stops working, history keeps the name, can be restored.
- Name format: **first name + last initial** (e.g. "Alex R."), to keep student data in backup files to a minimum.
- Badges: printed on the **same label sheets as parts** (§9 layouts).

## Tool checkout

**Round T1, 2026-10-29 17:09**
- Placement: **inside the inventory app, plus a helper-style mirror**. A second device can join as a tool station and exchange files.
- Which tools: **items marked "lendable"**, a per-item switch in any category.
- Duplicates: **by quantity**. One item, e.g. "Cordless drill", 4 on hand, shows "3 in / 1 out".
- Recorded at checkout besides who and when: a **note**, and **mentor approval (PIN) for some tools**. Not chosen: where it's going, expected return.

**Round T2, 2026-10-29 17:12**
- Overdue: **due back the same day**. Anything still out once the local date changes is overdue.
- On hand: **unchanged by checkouts**. On hand = owned; available = on hand − out. Order math ignores checkouts.
- Station sync: **the station owns checkouts** once one is set up. The shop tablet shows the last-imported status, read-only.
- PIN tools: a per-item **"PIN to check out"** switch, next to "lendable".

**Round T3, 2026-10-29 17:15**
- PIN tools at the station: **only at the shop tablet**. The station refuses them.
- Broken tools: **"Needs repair" blocks checkout** until a mentor clears it. Set on return or at any time, with a note.
- Returns: **anyone, no name asked**. A return is just a scan.
- History: kept **forever, in backups**.

**Round T4, 2026-10-29 17:18**
- Split: **by tool**. PIN tools go out and come back only at the shop tablet. Other lendable tools go out and come back only at the station, or at the tablet if no station is set up. Each tool has exactly one owner.
- Station device: an **old tablet mounted at the tool wall**, landscape, always on.
- Station screen: **three tabs** — Scan first, then Tools (list with photos and status), then Out now.
- Shop tablet shows: an **Out now list**, a **shop status strip count**, availability and history **on the item detail**, and a **Needs repair filter**.

**Round T5, 2026-10-29 17:21**
- File flow: **end-of-day send with a reminder banner**, like helpers. Files are cumulative, and the tablet shows how old its station data is.
- Station recovery: **rebuild from the tablet**. The next tool kit carries the last-imported checkouts; anything after the last send is flagged "please confirm".
- Quantity: **choose how many** per checkout (default 1). Partial returns are allowed.

## Part checkout (usage log)

**Round P1, 2026-10-29 17:24**
- Placement: **shop tablet only**. It owns on hand, so nothing needs merging.
- Names: **never** recorded for part use. The log is time, amount, source and project — not who.
- Projects: an **optional, mentor-managed list** (More › Projects), e.g. comp bot, practice bot, outreach.
- Logged: **every on-hand change**, each tagged with its source: quick +/−, Took parts, count-in, helper import, receiving, edit, restore.

**Round P2, 2026-10-29 17:27**
- Took parts screen: **yes, a scan basket**. Scan or search several parts, set amounts, pick a project once, confirm.
- Undo: **on the confirming toast** for a few seconds. After that, a normal adjustment, which is also logged.
- Reports: **all four** — most-used parts, use by project (with cost at current prices), suggested desired amounts, usage CSV export.
- Retention: **forever, in backups**.

**Round P3, 2026-10-29 17:29**
- Unused parts: a **Put back mode** in the same basket, credited back to the project.
- Project on Took parts: **optional, defaulting to the last project used**. "No project" is one tap.

## Competition pit packing list

**Round K1, 2026-10-29 17:32**
- Placement: **hybrid**. Lists and packing happen on the shop tablet. A pit device joins with a **pit kit** for the event, and its **used-at-event file** is imported back with a preview. Unpacking happens at the shop, so the tablet never leaves.
- Lists: **templates** (e.g. "District event", "Demo day"). Each event starts as a copy that can be tweaked, and earlier events can be copied too.
- Non-inventory things: **typed lines** (name + quantity) that never touch inventory.
- Containers: **yes, containers with QR labels** (e.g. "Spares tote A"). Scanning a container shows or ticks its contents, and unpacking checks it all came back.

**Round K2, 2026-10-29 17:35**
- The pit device can **mark parts used** (subtracted on import, with a preview), **find which tote holds a part**, and **log things added at the event** (bought, or borrowed from other teams) as typed lines. Not chosen: pit tool checkout.
- On hand: **unchanged while packed**. The item shows "n packed for <event>"; only parts marked used are subtracted.
- Pit device: a **spare tablet**, tablet layout with camera scanning.
- Ticking off: **scan or tap, with counts** (packed 3 of 4), showing what's still missing.

**Round K3, 2026-10-29 17:38**
- Lendable tools on a pack list: **checked out to the event** at the device that owns them (tablet or station). Unpacking returns them.
- Parts used at the event: **the event becomes a project**, so "Use by project" shows what the event used and what it cost.
- Missing at unpack: a **follow-up list**. Each line is Found, Used (subtracted and logged) or Lost (subtracted, logged as lost). The trip stays open until the list is empty.
- Trips: **one active at a time**.

Interview closed 2026-10-29 17:38.

**Addition, 2026-10-29 17:44** (Dan, unprompted)
- After the competition, each packing-list line gets a **"used" check box**, to help decide whether it belongs on the list for the next year or event.

**Priorities, 2026-10-29 18:02** (Dan)
- Development order: **tool checkout, then pit trips, then part usage**. This replaces the 17:03 answer, which only fixed tool checkout as first.

**Follow-up, 2026-10-29 18:05**
- Pit before part usage: **record on the trip, back-fill later**. Pit trips subtracts on hand and keeps the used-up and lost amounts (with times) on the trip lines. When the part usage log ships, it back-fills them as `event-used` / `event-lost` lines with the event as the project.
- Local repo: **just write the files** into `docs/proposals/future-features/`. Dan branches and commits in VS Code.
