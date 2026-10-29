# Possible features and new apps — for team discussion

**Prepared:** 2026-10-29 for Dan to take to the team · **Status:** ideas only, nothing decided or built
**Source:** independent mentor review of the inventory app (2026-10-29)

Three ideas that go beyond the current inventory app. For each one, the team decides two things:
1. **Do we want it?**
2. **Should it be part of the inventory app or a separate app?**

Today the app runs on one shop tablet, works offline and has no server. Other devices take part by passing files, as the helper count kits do. Any new app that needs the inventory would use files the same way, unless the team decides it wants a shared server.

---

## 1. In-shop part checkout (who took what)

**The problem:** students take parts and tap **−** on the tablet (or forget to). Later, nobody knows where the 8 NEOs went, or whether the count is wrong because of a missed tap.

**The idea:** every change to on hand is recorded: when it happened, how much, from which screen (quick adjust, count-in, receiving, helper import), and optionally who did it and for what. Examples: "Alex · −2 · swerve module rebuild", "Received +50 · REV order".
- The item's detail page shows its history.
- A **Took parts** screen: scan a part, enter how many, pick your name, and optionally a project. It's faster than finding the item in the list.
- A mistaken tap can be undone right away from the message that confirms it.
- Optional: a weekly "most used parts" list to help set desired amounts.

**Where it would live:** inside the inventory app. It changes on hand, so it belongs where on hand is kept.

**Questions for the team:**
- Should picking a name be required, optional, or left out (just time and amount)?
- Do we track projects ("comp bot", "practice bot", "outreach")?
- How long should history be kept: the season, or forever?

**Size:** medium. The spec lists a usage log as "out of scope for v1" (§13); this would bring it in.

---

## 2. Competition pit packing list

**The problem:** at an event, a forgotten spare (a battery charger, a spare swerve module, the right Allen key) costs matches. Packing from memory or a paper list misses things, and nobody checks what came home.

**The idea:** a packing list for each kind of trip ("District event", "Championship", "Demo day"), with quantities.
- **Pack:** go down the list or scan each item or tote, and tick it off. The list shows what's still missing.
- **At the event:** see what's in the pit and what has been used.
- **Unpack:** scan things back in. Anything that didn't come back is listed, and parts that were used can be taken off on hand in one step.
- Lists can be copied from last year's event.

**Two ways to build it:**

| | A. Inside the inventory app | B. A separate "Pit" app |
|---|---|---|
| How it works | A new **Pit** tab next to Order and Count, using the same items, photos and QR labels | Its own small app on a pit laptop or phone. It gets a "pit kit" file from the shop tablet (like a count kit) and sends back a "used at event" file |
| Good | One place for everything; labels and scanning already work | The shop tablet can stay home; the pit app can be simpler (big checklist) and work without the full inventory |
| Harder | The shop tablet has to travel to events | Two apps to keep up to date; the files have to be passed both ways |
| Inventory link | Direct | Through the pit kit file and the "used at event" file, previewed before anything changes (like Import counts) |

**Questions for the team:**
- Does the shop tablet go to events, or stay in the shop?
- Who packs, and when (the night before, or during the week)?
- Should the list include non-inventory things (pit banner, extension cords, safety glasses)? Typed lines, like on orders, would cover these.

**Size:** medium (A) or medium to large (B).

---

## 3. Tool checkout

**The problem:** tools aren't used up like parts; they're borrowed. Nobody knows who has the good crimper, the calipers or the cordless drill, or which tools went home with a student.

**The idea:** tools can be **checked out** and **returned**.
- **Check out:** scan the tool's QR label and pick who has it and, optionally, where it's going ("pit cart", "home for the weekend").
- **Return:** scan it again.
- An **Out now** list shows each tool, who has it and for how long. Tools out longer than a set time are highlighted.
- Optional: a tool can be marked "broken / needs repair" with a note.

**Two ways to build it:**

| | A. Inside the inventory app | B. A separate "Tool crib" app |
|---|---|---|
| How it works | Items in the **Tools** category (or marked "lendable") get Check out / Return buttons and an **Out now** list | A separate app at the tool wall (an old tablet or a phone), with its own tool list |
| Good | Tools already have items, photos, locations and QR labels; one tablet | Can sit permanently at the tool wall; very simple screen; students check out tools without touching the inventory |
| Harder | The shop tablet has to be where the tools are | Its tool list has to be kept up to date with the inventory (a file exported from the shop tablet), or kept separately |
| Inventory link | Direct | A "tools" file from the shop tablet to start it; after that it stands mostly on its own |

**Questions for the team:**
- Which tools are worth tracking: only the expensive or shared ones, or every tool?
- Is a name list enough (picked from a list), or do we need sign-in?
- Should overdue tools be shown on the shop tablet as well?

**Size:** small to medium (A) or medium (B).

---

## How these fit together

All three need a **name list** (the students and mentors who can be picked). Ideas 1 and 3 both record "who did what". If the team wants more than one of them, building idea 1 first gives the others a shared base: the name list, the history record and the scan flow.

If the team wants several devices to see the same live data (a pit app that shows the shop's stock, a tool crib that updates the shop tablet), that needs a shared server. The spec keeps that out of scope (§13: no live sync). The file-based designs above avoid it.
