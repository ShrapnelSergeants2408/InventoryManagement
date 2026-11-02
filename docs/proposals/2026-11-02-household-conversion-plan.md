# Household conversion plan (draft)

**Status:** planning draft from Dan's interview, 2026-11-02 · **Base:** fork of FRC 2408 Inventory Management, app 1.0.0, SPEC v0.18
**Goal:** turn the FRC shop inventory into **Hiebert Home Inventory**: a phone-first app, shared by 2–5 household members, for holiday decorations first, then the utility room, garage (including tools), attic, and later the pantry, kitchen and laundry.

Nothing here is in `docs/SPEC.md` yet. Once Dan approves it, the plan becomes a new **SPEC v2.0** (household), which replaces the FRC spec in this fork. The FRC spec stays in git history and upstream.

---

## 1. Interview answers (2026-11-02, America/Chicago)

**Round 1, 11:0x**
- Phones: **all iPhone**.
- Sync backend: **Cloudflare free tier** (Workers + D1 + R2 + Access).
- Structure: **Area › Spot › Bin › Item**. Items can also sit loose on a spot.
- Signal in storage areas: **spotty**. Must work fully offline and sync later.

**Round 2, 11:1x (holiday decorations)**
- Features wanted: **out vs. packed status**, **setup photos / notes**, **repair / replace list**, **bin contents on the label**.
- Grouping: **both**. One season field plus free-form tags.
- Granularity: **mix, per item**. Important things individually, bulk as one line with a quantity ("Glass ornaments, ~40").
- Labels: **Avery sheets on a home printer** (current layouts).

**Round 3, 11:1x (other areas, people)**
- Pantry: **later phase**, with **keep-at-least + shared shopping list** and **scan a grocery barcode to add**. Not chosen: expiration dates.
- Garage / tools: **lent out to…**, **manuals / receipts / warranty**, **value for insurance**. Not chosen: maintenance reminders.
- Users: **everyone equal**. Each person signs in, everyone can do everything, changes show who made them. **Drop the PIN.**
- Activity history: **yes, a simple log**.

**Round 4, 11:2x**
- Photos: **several** per item and per bin.
- Packing a bin: **scan the bin, then scan or tap items in**.
- Existing data: **start fresh**. No import.
- Name: **Hiebert Home Inventory**, short name **Home Inventory**.

(Exact minutes weren't recorded during the interview. The rounds ran between about 11:00 and 11:20.)

---

## 2. What the FRC app is today (what we start from)

| Area | Today | Household fate |
|---|---|---|
| Architecture | Offline PWA. **One tablet holds the only copy** (IndexedDB via Dexie). No server | **Replace:** local-first on each phone plus sync through Cloudflare |
| Layout | 11" tablet, landscape first | **Rework:** iPhone portrait, 360–430 px, one-handed |
| Purchasing | Vendors (3 per item), pack prices, suppliers, order lists, placed orders, receipts, spending, budget, price import (F11–F14, F18, F23, F27, F30–F32) | **Remove** (about half the code) |
| Helpers | Count kits, counts files, import, pending items, undo (§18, F26) | **Remove.** Sync replaces it |
| Mentor PIN | Guards deletes, prices, restore, settings (§6) | **Remove.** Sign-in plus activity log instead |
| Starter catalog | 129 FRC parts (`seed/`) | **Remove** |
| Locations | Flat list with QR (F25, F29) | **Replace** with Area › Spot, and Bins as their own records |
| Categories | Category › Subcategory (F9) | **Keep**, with household defaults; add season and tags |
| Items | Name, category, location, on hand, desired, spares, barcode, notes, 1 photo | **Reshape** (§4) |
| Scan, QR labels | Aim-and-hold scanner, `2408:` labels, Avery layouts, alignment nudge | **Keep and extend** (bin labels, new prefix) |
| Count-in (F24) | Guided walk to count stock | **Repurpose** as packing / unpacking a bin and a yearly audit |
| Backup / restore | ZIP + CSV, weekly reminder | **Keep** as an export / safety copy. The server becomes the main copy |
| Proposals | Containers with QR (pit trips), tool checkout, people list | **Borrow** containers → bins, tool checkout → "lent out to" |

Things that carry over almost unchanged: the scanner (`src/domain/scan*.ts`, `ui/components/Scanner.tsx`, the zxing fallback), QR drawing (`domain/qr.ts`), label layout math (`domain/labels.ts`), photos and image resizing (`io/image.ts`, `domain/image-size.ts`), search and filters, CSV/ZIP plumbing, the toast and dialog components, Vitest, the browser-check scripts and the milestone / review routine (HANDOFF §5).

---

## 3. Architecture

### 3.1 Local-first with sync

Each phone keeps a full copy in IndexedDB (Dexie, as today), so search, scanning and editing work in the attic with no signal. Changes go into a local **outbox** and sync when the phone is online.

| Piece | Choice |
|---|---|
| Client storage | Dexie, **new database name** `home-inventory`, schema restarting at v1. We're starting fresh, so none of the FRC upgrade code (v1–v4, `upgradeItemToV3`, helper DB) carries over |
| Server | One Cloudflare **Worker** with a small JSON API: `GET /sync?since=<cursor>`, `POST /sync` (batch of changes), `PUT/GET /photo/<id>` |
| Database | **D1** (SQLite). One table per record type, plus `activity` |
| Photos and files | **R2**. The phone keeps resized copies for offline viewing, and uploads are queued |
| Every synced record | `id` (random, made on the phone), `updatedAt` (server time once accepted), `updatedBy` (person), `deleted` (tombstone; today's hard deletes can't sync) |
| Conflicts | **Last write wins per record.** With 2–5 people this is rare. Quantity changes are sent as the new value, not a +/− delta, so they behave the same as any other edit |
| Pull | The server returns everything changed since the phone's cursor. That happens on app open, after every push, and every few minutes while open |
| Activity log | Written **by the server** when it accepts a change ("Ann moved Snowman lights to Christmas 4"), so it's the same on every phone |

### 3.2 Hosting and sign-in: an iPhone catch

- **The catch:** the app is on GitHub Pages today. If the app stays on `github.io` and the API is on Cloudflare, Safari treats the Cloudflare Access sign-in cookie as a **third-party cookie and blocks it**.
- **The fix:** serve the app **from the same Worker** as the API (Workers static assets). App and API then share one origin.
- **What that means for deployment:** `.github/workflows/deploy.yml` switches from GitHub Pages to `wrangler deploy`, using a Cloudflare API token stored as a GitHub secret.
- **The next risk is the sign-in redirect itself.** Cloudflare Access sign-in (an emailed one-time code) redirects through `cloudflareaccess.com`. Inside an iOS **home-screen app**, that redirect can open in a separate Safari view and lose the session.
  - **Plan:** start milestone H4 with a one-day spike on a real iPhone.
  - **Fallback if Access misbehaves:** the app does its own sign-in. A person enters an emailed code once, the Worker issues a long-lived device token, and the app stores the token in IndexedDB and sends it as a header. No cookies at all.
  - Either way, each person is identified and every change is attributed.

### 3.3 Free-tier fit (check the figures again at build time)

| Resource | Free allowance (approx.) | Expected use |
|---|---|---|
| Workers requests | 100k / day | Hundreds / day |
| D1 storage | 5 GB | Under 50 MB |
| R2 storage | 10 GB | ~1–3 GB of photos (several per item, ~250 KB each after resize) |
| Access users | 50 | 2–5 |

Unlike Supabase, nothing here pauses when unused, which matters for decorations touched twice a year.

### 3.4 iPhone specifics

- **Scanning:** Safari has no `BarcodeDetector`, so the zxing WASM fallback becomes the main scanner. It needs speed testing on the real phones, especially in dim attic light. The torch toggle needs testing too.
- **Installing:** Share › **Add to Home Screen**. The FRC docs' Chrome / Android install instructions are rewritten for iPhone.
- **Storage:** home-screen web apps keep their data better than Safari tabs. Even if iOS clears it, the phone just pulls everything back from the server. That removes the FRC app's biggest risk ("never clear site data").
- **Printing:** AirPrint, or Share › Save to Files as a PDF and print from a computer at 100%. The label alignment nudge stays per phone.
- **Layout:** safe-area insets (notch, home bar) and `100dvh` layout.

---

## 4. Data model (household)

**Area:** a room or zone. Fields: id, name, order, notes. E.g. Attic, Garage, Utility room, Kitchen, Laundry.

**Spot:** a place inside an area. Fields: id, areaId, name, order, notes, photoIds. E.g. "Shelf B", "Pegboard", "Cabinet over washer". It has its own QR code (scan it to see what's there).

**Bin:** a container with a QR label.

| Field | Notes |
|---|---|
| id, **code** | Code is short and human-readable, printed big on the label ("X-04") |
| name | "Christmas 4: lights & garland" |
| spotId | Where it lives when stored |
| season | Optional (§4.1) |
| tags[] | Free tags |
| notes | |
| photoIds[] | Outside view, contents view |
| state | `stored` / `out` (unpacked, e.g. empty in the living room during the holidays) |

**Item**

| Field | Notes |
|---|---|
| id, name, category, subcategory | Categories kept from the FRC app, with household defaults |
| home | `binId`, or `spotId` for an item loose on a shelf. Exactly one |
| quantity, **approx** | "~40" for bulk lines |
| season, tags[] | Season can be inherited from the bin when blank |
| status | `stored` / `out` (+ **outAt**: free text "Mantel", "Front yard") / `lent` (+ lentTo, lentOn) |
| condition | `ok` / `needs repair` / `replace` / `toss`, plus a condition note |
| photoIds[] | Several |
| notes, barcode | Barcode kept (UPC scan to find; pantry later) |
| value, purchase date, model, serial, warranty until | Optional, mostly for tools and valuables |
| attachmentIds[] | Manuals, receipts, warranty cards (PDF or photo) |
| keepAtLeast | **Later (pantry):** reuses the FRC order-quantity logic for the shopping list |

**Season:** id, name, order, color, setup notes, setup photos. Christmas, Halloween, Thanksgiving, Easter, 4th of July, Fall and others are editable.

**Photo / Attachment:** id, owner (item, bin, spot or season), kind (`photo`, `setup`, `manual`, `receipt`, `warranty`), caption, R2 key, local thumbnail.

**Person:** id, name, email. **Activity:** id, at, personId, summary, recordType, recordId.

### 4.1 QR codes

- **Payload:** `hhi:b-XXXX` (bin), `hhi:s-XXXX` (spot), `hhi:i-XXXXX` (item, rarely labelled). Same idea as `2408:`, with a new prefix.
- **Old labels:** old FRC labels are not recognized.
- **Other barcodes:** a code that isn't `hhi:` is treated as a product barcode: find the item that has it, or attach it to one.

---

## 5. Features

### 5.1 Core (decorations and storage)

| # | Feature | Notes |
|---|---|---|
| H-F1 | **Find** | One search box over items, bins, spots, tags, seasons and notes. Each result shows its path: *Attic › Shelf B › Christmas 4*. Recently viewed when the box is empty (FRC F4) |
| H-F2 | **Browse** | By Area › Spot › Bin, by Season, or by Category. FRC F1's collapsible list, re-pointed |
| H-F3 | **Scan** | Bin → its contents and actions. Spot → what's on it. Product barcode → the item |
| H-F4 | **Pack a bin** | Scan the bin, then add items by search, by scan, by tapping from the season's "out" list, or with **quick-add** (photo + name + quantity). Items added are marked `stored` in that bin |
| H-F5 | **Unpack** | On a bin: **Take everything out**, or tick items. Each becomes `out` with an optional "where" (recent places offered). The bin can be marked `out` too |
| H-F6 | **Repack checklist** | For each season: items still `out`, grouped by the bin they belong in. Scan a bin to see "3 items still out". Done when nothing is out |
| H-F7 | **Move** | Item → another bin or spot. Bin → another spot (scan the bin, then scan the spot). Bulk move from Select mode (FRC F28) |
| H-F8 | **Setup photos** | Per season (and optionally per bin): photos with captions of how things were arranged. Shown when unpacking that season |
| H-F9 | **Repair / replace list** | Every item whose condition isn't `ok`, grouped by season. Mark fixed, tossed or replaced. Tossing deletes the item |
| H-F10 | **Labels** | Avery 5160 / 5163 / 22805 and plain-paper layouts (FRC §9), for bins, spots and items. **Bin labels on 5163 (2"×4")** show the QR, big code, name, season and a **contents summary** (top lines by quantity, "+ 12 more"). A "Contents changed since printed" flag offers a reprint |
| H-F11 | **Manage areas, spots, seasons, tags, categories** | Add, rename, reorder (FRC ▲/▼ reorder mode), remove (move the contents first) |

### 5.2 Garage, tools, valuables

| # | Feature | Notes |
|---|---|---|
| H-F12 | **Lent out** | Mark an item lent to a typed name, with a date. An "Out on loan" list. Return in one tap. A trimmed-down version of the tool-checkout proposal, with no stations or badges |
| H-F13 | **Records** | Model, serial, purchase date, value, warranty until; attach manual, receipt and warranty files. "Warranty ends soon" view |
| H-F14 | **Insurance export** | Every item with a value, by area, with total value and photos, as a CSV + photos ZIP and a printable PDF summary |

### 5.3 Everyone

| # | Feature | Notes |
|---|---|---|
| H-F15 | **Sign-in and sync** | §3. Sync status in the top bar ("Synced 2 min ago" / "3 changes waiting") |
| H-F16 | **Activity** | More › Activity: newest first, filter by person, area or season. The item and bin screens show their own recent history |
| H-F17 | **Export / backup** | The FRC full backup ZIP, re-pointed at the new data. The weekly reminder becomes monthly or optional, since the server holds the copy |

### 5.4 Later phase: pantry, kitchen, laundry

| # | Feature | Notes |
|---|---|---|
| H-F18 | **Keep at least / shopping list** | Item `keepAtLeast`. Below it, the item appears on a shared **shopping list** (live on both phones), grouped by store or area. Tick when bought → quantity goes up. Reuses the FRC order math and automatic list |
| H-F19 | **Scan a grocery barcode to add** | Look up the UPC on Open Food Facts (free, no key), which needs a signal. Name and photo are prefilled |

---

## 6. Screens (phone-first)

- **Bottom tab bar** (5): **Find** · **Scan** · **Seasons** (current season's out / repack, repair list) · **Lists** (out on loan, shopping later) · **More**.
- **Scan as a big central button.** The scanner keeps aim-and-hold (FRC F21) but with a full-width viewfinder sized for a phone.
- **Detail screens:** a photo carousel at the top, path breadcrumbs (*Attic › Shelf B › Christmas 4*), and primary actions as large buttons at the bottom within thumb reach.
- **Forms:** single column, with a camera button first on quick-add.
- **Design system:** keep FRC tokens and fonts (Atkinson Hyperlegible for body text, which suits small screens) with a new household palette and icon. Mockups for the main screens come before H3 code, as in the FRC Stage 3.

---

## 7. Milestones

Same routine as HANDOFF §5: spec first, branch per milestone, tests, review file, PR.

| # | Milestone | Contents | Size |
|---|---|---|---|
| **H0** | Spec | Write SPEC v2.0 from this plan. Dan confirms the details (§8) | S |
| **H1** | Strip and rebrand | Delete purchasing, helpers, PIN, starter catalog, their tests and browser checks. New name, manifest, icon, palette, DB name, `hhi:` prefix. The app still runs as a local-only household list | M |
| **H2** | Places, bins, seasons | New data model (§4): Area › Spot › Bin › Item, seasons and tags, several photos, scanning bins and spots, move, bin labels with contents | L |
| **H3** | Phone UI | Mockups, then the bottom tabs, a portrait rework of every remaining screen, iPhone safe areas, zxing tuning on iPhone | L |
| **H4** | Sync and sign-in | iPhone sign-in spike first. Then the Worker + D1 + R2, outbox / pull, tombstones, photo upload, the activity log, deploy via wrangler, people. **Independent review in a fresh session** (data safety) | L |
| **H5** | Holiday workflow | Pack, unpack, out / repack checklist, setup photos, repair / replace list (H-F4 to H-F9) | M |
| **H6** | Garage records | Lent out, records and attachments, insurance export (H-F12 to H-F14) | M |
| **H7** | Pantry (later) | Keep at least + shopping list, UPC lookup (H-F18, H-F19) | M |

**Order notes**
- H1–H3 give a usable single-phone app before any server work.
- A different order would deliver the holiday features in time for this Christmas's packing up in late Dec or early Jan: H1 → H2 → H3 → **H5 → H4**. The two phones wouldn't share data until H4.
- **Recommendation:** keep sync (H4) before H5 if both phones need to be updating by December. Otherwise do H5 first.

---

## 8. Details I decided (for Dan to confirm)

- **D1.** New database name and schema v1. No migration code from the FRC app (start fresh).
- **D2.** Host the app on Cloudflare (same origin as the API) instead of GitHub Pages, for iPhone sign-in cookies (§3.2).
- **D3.** Last write wins per record. No field-level merging.
- **D4.** Bin code: a letter for the area plus a number ("A-04" in the Attic), assigned automatically and editable.
- **D5.** Quantity changes sync as the new value. If two people change the same item offline at the same time, the later sync wins.
- **D6.** Deletes are soft (tombstones), kept 90 days, then purged by the server. Deleting asks to confirm but needs no PIN.
- **D7.** "Out" location is free text with recent suggestions. It isn't a managed list.
- **D8.** Activity log kept 2 years, then trimmed.
- **D9.** Old FRC docs (`docs/reviews`, `docs/mockups`, `docs/history`, the FRC `docs/proposals`) are removed from this fork in H1. They stay in upstream and git history.
- **D10.** Photos are resized to ~1600 px on the long side (FRC used 1024) so serial plates and labels stay readable. Thumbnails are cached on the phone, full size fetched when viewed.

## 9. Open questions (answered 2026-11-02 ~11:30; now in SPEC v2.0)

Dan: "1) yes; 2) confirmed; 3) only 2 people will have access (me and my wife), is there additional cost for custom domain, items should only be in one season, keep value/insurance fields for all items".
- Q1: **yes**, so sync (H4) comes before the holiday workflow (H5).
- D1–D10: **confirmed**.
- Q2: **2 people only**.
- Q3: a custom domain costs only the domain registration (~$10–12/yr); using it on Cloudflare is free. **Free `workers.dev` address for now.**
- Q4: **one season per item**.
- Q5: **value and records fields on every item**.

Original questions:

- **Q1.** Is the Christmas deadline real? It decides whether H5 or H4 comes first (§7).
- **Q2.** Who besides Dan and Ann gets access, if anyone (the 3rd–5th seats)?
- **Q3.** Is a custom domain wanted (e.g. `inventory.<yourdomain>`), or is a free `*.workers.dev` address fine?
- **Q4.** Should an item be able to belong to **two seasons** (e.g. "Fall" and "Thanksgiving")? The plan assumes one season plus tags.
- **Q5.** Should value / insurance fields be hidden for decoration items to keep forms short (shown per category)?
