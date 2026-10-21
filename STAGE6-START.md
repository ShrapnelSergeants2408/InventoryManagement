# FRC 2408 Inventory — Stage 6 start (2026-10-21)

**Situation:** Stage 5 checks on the tablet all pass, except the real label-sheet print (deferred until labels are bought). Your repo already contains a spec "v0.6" and "v0.7" from earlier Claude Code sessions. The changes designed in the claude.ai project were also drafted as "v0.6", which is a **name collision**. This kit renames them to a neutral **proposal** so Claude Code can merge them into your repo's latest spec as the next version (probably v0.8).

## What's in this kit

| Path (unzip at the repo root) | What it is |
|---|---|
| `docs/proposals/2026-10-21-claude-proposal.md` | The proposal: a full spec based on **v0.5 (2026-10-17 15:40)** plus the 2026-10-19/21 changes. See "Proposal contents" below |
| `docs/mockups/helper-screens/` | 6 screenshots (11a–11f), mockup source and VERIFICATION.md for the helper-device screens. They still show the old category names; follow the new §11 |
| `seed/frc2408-starter-catalog-2026-10-21.zip` | Starter catalog remapped to the new categories, plus `categories.csv`. Same 129 items, 168 vendor options, 128 photos, $8,413.66 |
| `seed/category-mapping-2026-10-21.csv` | Old category → new category for every starter item (for review) |

**Proposal contents** (all approved by Dan in principle; the details in its §15 Q6 still need a final yes):
1. Filter order: Supplier last (F5).
2. New categories (§11), saved in backups as `categories.csv`.
3. Bulk move of items to another category (F28 in the proposal).
4. Order-list search, plus "Export shown lines only" (F12).
5. Named order lists. Inventory is never changed by a list; received parts are added by hand (F27 in the proposal).
6. Helper devices for counting, with count kits, counts files and Import counts with undo (F26 and §18 in the proposal).
7. Upgrading the existing build (§18.7) and tests (§18.6, §19).

The F-numbers above are the proposal's. If your repo's v0.6/v0.7 already used F26–F28, they'll be renumbered in step 3.

---

## Step 1 — Close Stage 5 (5 minutes)

1. Bring `docs/stage5-findings.md` up to date (T-01 fixed, D-01 label sheet deferred).
2. Commit, then tag the verified build with a name that won't clash with spec versions:
   ```
   git tag stage5-verified
   ```
   (Push the tag if the repo is on GitHub.)

## Step 2 — Unzip this kit

Unzip `stage6-kit.zip` at the **top of your repo**. It only adds files under `docs/proposals/`, `docs/mockups/helper-screens/` and `seed/`; it doesn't replace anything. Keep the old seed file too; the old one is still what v0.5 loads.

## Step 3 — Find out what v0.6/v0.7 are, and merge (Claude Code, no code changes)

Start a **new** Claude Code session in VS Code and paste:

```
We're starting Stage 6 of FRC 2408 Inventory Management. Do not change any code or docs/SPEC.md in this step.

1. Find out what "v0.6" and "v0.7" are in this repo: git tags and branches (git tag, git branch -a, git log --oneline -30), the header, "Changes in" sections and decision log of docs/SPEC.md, and any other spec files in docs/. Tell me in plain words what each version changed and when.
2. Read docs/proposals/2026-10-21-claude-proposal.md. It was written in a separate claude.ai chat starting from SPEC v0.5 (2026-10-17 15:40), so it doesn't know about this repo's v0.6/v0.7. Its changes are listed at the top ("Changes in v0.6 (draft)" and "Also in v0.6 (draft)"): helper devices (F26, §18), named order lists (F27), bulk move (F28), order-list search (F12), filter order (F5), new categories (§11, categories.csv), last_counted as date-time + counted_by, upgrade notes (§18.7) and tests (§18.6, §19).
3. Write docs/spec-merge-plan.md with:
   - each proposal change: already in the repo spec / new / conflicts (and how you'd resolve it);
   - F-number or section-number collisions and the renumbering you suggest;
   - data-model and Dexie schema impact (current schema version → next), including migrating existing data;
   - anything in the repo's v0.6/v0.7 that the proposal would accidentally undo.
4. Write docs/SPEC-next-draft.md: the repo's current spec with the proposal merged in, as the next version number, with a "Changes in" section and decision-log entries dated today. Keep the proposal's wording unless it conflicts.
5. Stop and wait for me. Keep a timestamped log (America/Chicago) in docs/session-log.md.
```

**Then:** read `docs/spec-merge-plan.md`. I'd also have it double-checked: upload `spec-merge-plan.md` and `SPEC-next-draft.md` to the claude.ai project chat, and Claude there will check them against what you decided. Answer the proposal's §15 Q6 (a–d) in the same pass. When you're happy, tell Claude Code: *"Approved. Make SPEC-next-draft.md the new docs/SPEC.md."*

## Step 4 — Plan the build (Claude Code, still no code)

```
docs/SPEC.md is now approved at <version>. Plan Stage 6 before writing code:
1. Propose milestones in this order, each on its own git branch, merged only after its verification passes: (1) filter order F5, (2) categories §11 + categories.csv + new seed seed/frc2408-starter-catalog-2026-10-21.zip, (3) bulk move, (4) order-list search + export shown lines, (5) named order lists, (6) helper devices + Import counts. Use the F-numbers from the approved spec.
2. For each milestone: acceptance criteria (spec section/F-numbers), the tests you'll add (see the spec's helper-device and "other changes" test sections), the screens touched, and the regression checks from the spec's "upgrading the existing build" section.
3. Describe the Dexie schema upgrade and how you'll test it against a copy of real tablet data (export a full backup from the tablet first).
4. Use docs/mockups/helper-screens/ for the helper and import screens (they show old category names; follow the spec), and the existing app's styles for everything else.
Stop and wait for my OK.
```

## Step 5 — Build, one milestone at a time

For each milestone, tell Claude Code: *"Build milestone n."* After each one, it should:
- run all tests (old and new) and the build;
- write a verification pass "as a review of someone else's work" with cited evidence;
- commit, merge after your OK, and update docs/session-log.md.

Then test that milestone on the tablet before starting the next. Ask me here for the hands-on checks for each milestone.

**High-risk milestones:** categories (data migration) and helper devices (Import counts changes real counts). For these, run the independent-review prompt (Stage 5 Part A, adapted) in a fresh session before merging.

## Step 6 — Fresh start on the tablet

When all milestones are merged and deployed:
1. Export a full backup of whatever is on the tablet (just in case).
2. Clear the site data, open the app, choose **Set up the shop tablet**, set a new PIN and **write down the recovery code**.
3. Confirm the new categories, 129 items and $8,413.66.
4. Start the real first count, with helpers.
