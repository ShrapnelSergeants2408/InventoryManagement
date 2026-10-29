# Future features — draft specs

Specs for the three ideas in `../2026-10-29-team-feature-ideas.md`, built from Dan's interview on 2026-10-29 (16:58–17:44). They are proposals: nothing here is in `docs/SPEC.md` yet. When a feature is approved, its section merges into SPEC as §23–§26 with features F33–F52.

| File | What | Build order |
|---|---|---|
| [00-shared-foundations.md](00-shared-foundations.md) | §23 — device roles and kit files, **people list** and QR badges (F33–F35), **projects** (F36), PIN changes, §13 changes | With the first feature |
| [01-tool-checkout.md](01-tool-checkout.md) | §24 — lendable tools, check out / return, Out now and overdue, Needs repair, **tool station** (F37–F41) | 1st |
| [02-part-usage-log.md](02-part-usage-log.md) | §25 — every on-hand change logged, **Took parts / Put back** basket, undo, usage reports (F42–F45); back-fills trips' event use (§25.4a) | 3rd |
| [03-pit-trips.md](03-pit-trips.md) | §26 — containers, templates, trips, packing, **pit device**, unpacking, the **"Used" box** and the next list (F46–F52) | 2nd |

Build order is Dan's (18:02): **tool checkout → pit trips → part usage**. Section and feature numbers follow the spec order, not the build order; they get final numbers when each merges into SPEC.md.
| [interview-log.md](interview-log.md) | Every answer, with times | — |

**Placement at a glance**

| Feature | Lives | Linked by files? |
|---|---|---|
| Tool checkout | Inside the app, plus an optional **tool station** tablet at the tool wall | Tool kit → station; tool activity file → tablet |
| Part usage log | Inside the app, **shop tablet only** | No |
| Pit trips | Planning, packing and unpacking on the shop tablet; a **pit device** at the event | Pit kit → pit device; used-at-event file → tablet |

Each spec ends with **Details Claude decided** (D1–D24, for Dan to confirm) and **Open questions** (Q1–Q10).

---

## Verification — 2026-10-29 17:47

A separate review pass, reading the drafts as someone else's work, against three criteria:
- (A) every interview answer is in a spec, and nothing contradicts one;
- (B) nothing conflicts with SPEC v0.18 or HANDOFF without being called out;
- (C) feature and section numbers are unique and continuous.

**Verified**
- (A) All 50 recorded answers (foundations 8, tools 19, parts 10, pit 12, plus Dan's 17:44 addition in §26.7, F52) appear in a Decisions table with their time. Unchosen options stay out: no expected-return date, no pit tool checkout (only Q9 raises a read-only version), no names on part use.
- (B) Checked against SPEC §3, §6, §7, §9, §13, §17, §18, F17 and F21, and HANDOFF §8. The QR prefix `2408:` and the id alphabet match `src/domain/scan.ts` and `src/domain/ids.ts`.
- (C) F33–F52 each defined once; §23–§26 follow §22.

**Changed during verification**
1. Tool checkout §24.5 said a restore would leave the tablet owning all tools. In fact a restore keeps settings and helper records (HANDOFF §8), so a station survives it. Rewritten: import the station's latest cumulative file after a restore.
2. Return records lacked an event id, so station imports couldn't be idempotent. Added `event_id`.
3. The "NEEDS REPAIR" chip had no color rule. Now an outline, never a stock-status color (§17).
4. The §23.4 PIN list missed deleting templates and removing containers (pit D24). Added.
5. The "Took parts" button placement clashed with the §17 lock-button rule. Now left of the lock, plus on the item detail card.
6. A lost tool at unpack wasn't logged. Now logs `event-lost`.
7. The trip's `planning` → `packing` change had no trigger. Now the first tick, or Start packing.

**Called out, not resolved (needs Dan)**
- D13: the undo toast breaks §17's tap-through rule on purpose.
- D18: Trips sit under More rather than as a seventh tab.
- D11: restore isn't logged per item, although the 17:24 answer listed restores among logged changes.
- Q1–Q10.

**Remaining uncertainty**
- Sizes are estimates.
- Tool station and pit device behaviour on the actual spare tablet (camera, staying awake when mounted) is untested.
- The track-record matching for typed lines (by name) may need tuning once real trips exist.

### Re-check after the build-order change — 2026-10-29 18:08

Pit trips moved ahead of part usage (Dan, 18:02). Every place the pit spec wrote usage lines now records on the trip line instead, with event id, time and quantity, so §25.4a can back-fill exactly (Dan, 18:05). Checked:
- **§26.5 import:** records the entry, and writes a usage line only once §25 exists.
- **§26.6 Used / Lost / tool Lost:** recorded as entries or outcomes.
- **Tests:** §26.9 now covers "built without §25"; §25.5 covers the back-fill.
- **Data:** §26.2 gained `used_up_entries`, `outcome_at` and the outcome quantity.
- **Projects (§23.3):** now ship with pit trips, the first feature that creates them.
- No remaining text says part usage is built before pit trips.

**Risk level:** medium. These are planning documents, not code or data. Before building, have a fresh Claude Code session review the spec that's going first (tool checkout + foundations) against SPEC.md, as the M-reviews did.
