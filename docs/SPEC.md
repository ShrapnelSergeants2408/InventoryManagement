# Hiebert Home Inventory: Specification v2.0

**Owner:** Dan · **Users:** Dan and Ann (2 people) · **Devices:** iPhones, the app added to the home screen from Safari
**Status:** Draft, 2026-11-02 · **Based on:** `docs/proposals/2026-11-02-household-conversion-plan.md` (interview and decisions)
**Previous:** this repository is a fork of FRC 2408 Inventory Management (SPEC v0.18, app 1.0.0). That spec is in git history (tag or commit `925a75f`) and upstream at `ShrapnelSergeants2408/InventoryManagement`. v2.0 replaces it: nothing from v0.18 applies unless this document says so.

**Changes in v2.0:** a new household spec built from the FRC app.
- **Removed:** purchasing, helpers, the PIN and the starter catalog.
- **Added:** areas, spots, bins and seasons; a phone-first layout; sync between phones through Cloudflare; the holiday workflow; garage records. The pantry follows in a later phase.

**Built so far:** H1 (app 0.1.1, `docs/reviews/H1.md`). The FRC features are gone and the app is rebranded, but it still uses an interim model until H2:
- items have a flat location (no areas, spots or bins yet) and a quantity;
- the backup holds `inventory.csv`, `locations.csv`, `categories.csv` and the photos, not the §7 files.

H2 replaces both, and must still restore an H1 backup.

**H2 is delivered in two parts** (Dan, 2026-11-02):
- **H2a** (app 0.1.2): the §3 data model with every item field stored, the in-place upgrade from H1, the §7 backup, F11 lists (areas and spots, seasons, tags, categories), bin and spot screens, F16 item editing and F7 move.
- **H2b** (app 0.1.3): F1 Find, F2 Browse, F3 Scan for bins and spots, F10 labels for bins and spots with contents.

**Upgrading an H1 phone** (Dan, 2026-11-02: upgrade in place). Schema v2 converts the H1 data the first time H2a opens:
- every H1 location becomes a spot in one area called **Unsorted** (letter U), in the same walk order. **Move spot to another area** (F11) sorts them later;
- items keep their location as their spot;
- the default seasons are added;
- photos are kept.

A Full backup before installing is still advised (HANDOFF §5). Restore also reads an H1 backup ZIP, converting it the same way.

**Item fields in H2a** (Dan, 2026-11-02: store all, show most). Every §3 item field is stored and backed up now, so later milestones need no schema change for them. The editor shows:
- name, category, home, quantity and approx, season, tags, condition and its note;
- barcode, notes and value;
- a collapsed **Records** section (purchase date, model, serial, warranty until);
- several photos.

Status (out, lent) is shown but changed only by H5 and H6 actions. Attachments come with H6, and keepAtLeast with H7.

---

## 1. Purpose and users

A household inventory that answers "where is it?" and "what's in this bin?". Holiday decorations come first. The utility room, garage (including tools) and attic come next, and the pantry, kitchen and laundry in a later phase.

- Two people (Dan and Ann) each use their own iPhone. Both can do everything.
- Every change is attributed to the person who made it and appears in a shared activity log.
- No PIN: sign-in identifies people, and confirmations prevent accidents (Dan, 2026-11-02).

## 2. Platform and stack

| Decision | Choice | Why |
|---|---|---|
| App type | PWA, added to the home screen from **iPhone Safari** | No App Store; the FRC app's code base |
| Language/build | TypeScript, Preact, Vite (unchanged) | Existing code and tooling |
| Storage on the phone | IndexedDB via Dexie, database `home-inventory`, schema v2 (H2a; v1 was H1) | **Local-first:** works with no signal in the attic or garage |
| Server | One Cloudflare **Worker** (API + static app), **D1** (data), **R2** (photos and files) | Free tier, never sleeps, ~$0 for 2 people (§14) |
| Sign-in | Cloudflare Access, one-time email code, a policy allowing the two email addresses. **Fallback** (§12.4) if it misbehaves in an iOS home-screen app | Real identity without passwords |
| Address | `https://<name>.workers.dev`. A custom domain (~$10–12/yr) can be added later with no code change (Dan, 2026-11-02: free address for now) | |
| Deploy | GitHub Actions on every merge to `main`: test, build, `wrangler deploy` | Replaces GitHub Pages: the app must share an origin with the API, or Safari blocks the sign-in cookie |
| CSV, ZIP, QR, scanning | Papa Parse, JSZip, qrcode-generator, barcode-detector with the zxing WASM fallback (unchanged) | Safari has no native BarcodeDetector, so zxing is the main scanner |
| Tests | Vitest for app and Worker; headless browser checks (`scripts/`) | As in the FRC app |

**Additional requirements**
- Fully usable offline after the first sign-in and sync. Changes made offline are queued and sent when the phone is online (§12).
- **Layout:** iPhone portrait, 360–430 CSS px wide, nothing scrolls sideways. Respect safe-area insets (notch, home indicator) and use dynamic viewport height.
- Request persistent storage. If iOS clears the app's storage, the next sign-in pulls everything back from the server, so nothing is lost except changes that hadn't synced yet. The sync status (§12.3) shows those.

## 3. Data model

Every stored record (except local caches) has these sync fields:

| Field | Notes |
|---|---|
| `id` | Random, made on the phone: a prefix plus 8 characters from the id alphabet (`src/domain/ids.ts`) |
| `updatedAt` | ms since epoch, **set by the server** when it accepts the change |
| `updatedBy` | Person id |
| `deleted` | Tombstone flag (§12.2). Deleted records are hidden everywhere |

### Area (`ar-`)
A room or zone: Attic, Garage, Utility room, Kitchen, Laundry, Basement…

| Field | Required | Notes |
|---|---|---|
| name | yes | Unique, ignoring capitals |
| letter | yes | One letter A–Z, unique. The bin-code prefix (§3, Bin). Defaults to the name's first free letter |
| order | yes | Walk order |
| notes | no | |

### Spot (`sp-`)
A place inside an area: "Shelf B", "Pegboard", "Cabinet over washer", "Floor by the furnace".

| Field | Required | Notes |
|---|---|---|
| areaId | yes | |
| name | yes | Unique within its area, ignoring capitals |
| order | yes | Walk order within the area |
| notes, photoIds | no | |

### Bin (`bn-`)
A container with a QR label.

| Field | Required | Notes |
|---|---|---|
| code | yes | Area letter + 2-digit number ("A-04"), the next free number in that area, assigned automatically and editable (D4). Unique. Printed large on the label. **Kept when the bin moves** to another area, so labels stay true |
| name | yes | "Christmas 4: lights & garland" |
| spotId | no | Where it's stored. Blank = "No spot" |
| seasonId | no | One season |
| tags | no | Free tags |
| state | yes | `stored` or `out` (unpacked, e.g. sitting empty in the living room) |
| notes, photoIds | no | Outside view, contents view… |
| labelPrintedAt, labelContents | no | When its label was last printed, and the contents summary printed on it (§9) |

### Item (`it-`)

| Field | Required | Notes |
|---|---|---|
| name | yes | |
| category, subcategory | yes / no | Managed list (F11) |
| binId **or** spotId | one of them, or neither | Its home. An item in a bin is wherever the bin is; a loose item sits on a spot. Neither = "No home yet" |
| quantity | yes | Whole number ≥ 0, default 1 |
| approx | yes | Default no. Yes shows "~40" for bulk lines (Dan: mix of individual and bulk lines) |
| seasonId | no | **One season only** (Dan, 2026-11-02). Blank means it follows its bin's season |
| tags | no | Free tags (Fragile, Outdoor, Kids' room…) |
| status | yes | `stored` · `out` · `lent` |
| outWhere | no | While `out`: free text with recent suggestions ("Mantel", "Front yard") (D7) |
| outSince | no | Date-time the item went out |
| lentTo, lentOn | no | While `lent`: typed name, date |
| condition | yes | `ok` · `needs repair` · `replace` · `toss` |
| conditionNote | no | "Left strand dead" |
| barcode | no | Product barcode (UPC/EAN) |
| notes | no | |
| value | no | Integer cents. **Shown for every item** (Dan, 2026-11-02) |
| purchaseDate, model, serial, warrantyUntil | no | Shown for every item, in a collapsed "Records" section |
| photoIds, attachmentIds | no | Several of each |
| keepAtLeast | no | **Pantry phase (F18).** Not shown before then |

### Season (`se-`)
| Field | Required | Notes |
|---|---|---|
| name | yes | Unique, ignoring capitals |
| order | yes | Display order. Defaults to calendar order: Valentine's, St. Patrick's, Easter, 4th of July, Fall, Halloween, Thanksgiving, Christmas, Winter, New Year's |
| color | yes | From a fixed palette of 10 (chips only, never a condition color) |
| setupNotes, setupPhotoIds | no | How things were arranged (F8) |

### Category
As FRC F9: name, order, subcategories. Household defaults: Decorations, Lights, Tools, Hardware, Yard & garden, Sports & outdoors, Seasonal clothing, Kitchen, Pantry, Cleaning & laundry, Electronics, Documents & keepsakes, Other.

### Photo / Attachment (`ph-`, `at-`)
| Field | Notes |
|---|---|
| ownerType, ownerId | item, bin, spot or season |
| kind | Photo: `photo` or `setup`. Attachment: `manual`, `receipt`, `warranty` or `other` |
| caption | Optional |
| r2Key, contentType, bytes | Set once uploaded |
| order | Position in the owner's carousel. The first photo is the thumbnail |

The phone keeps a thumbnail (about 320 px) for every photo, and the full image (about 1600 px long side, JPEG, D10) for photos taken on this phone or opened before. Attachments (PDF or image, up to 15 MB) are downloaded when opened.

### Person (`pp-`)
name, email. Created by the server on first sign-in for an allowed email; the name can be edited in More. Two people (Dan, 2026-11-02).

### Activity (`ac-`, written by the server)
at, personId, summary ("Ann moved Snowman lights to A-04 Christmas 4"), recordType, recordId. Kept 2 years (D8).

## 4. Rules and calculations

- **An item's location:** the item's home spot or bin. For a bin, the bin's spot and its area. Shown as a path: *Attic › Shelf B › A-04 Christmas 4*. If the bin has no spot: *A-04 Christmas 4 (no spot)*.
- **An item's season:** the item's own season, else its bin's.
- **Out of place:** an item with status `out` or `lent` still keeps its home. Repacking returns it there.
- **Bin contents summary** (labels, bin cards): items in the bin with status `stored`, the largest quantities first, then A–Z. Each is shown as "Name ×3" or "Name ~40". Bulk lines come first when tied.
- **Label out of date:** a bin whose current contents summary differs from `labelContents` shows "Label out of date" with **Reprint**.
- **Ids in QR codes** (§9): `hhi:` + the record id.

## 5. Features

### 5.1 Decorations and storage

| # | Feature | Acceptance criteria |
|---|---|---|
| F1 | Find | One search box over item names, notes, tags, barcode, model/serial, bin codes and names, spots, areas, seasons and categories. Results update as you type, grouped Items / Bins / Spots, each with its path (§4) and a thumbnail. With the box empty and focused: the 8 records most recently opened on this phone (FRC F4) |
| F2 | Browse | Three views, remembered: **By place** (Area › Spot › Bin, collapsible, walk order; loose items under their spot; "No home yet" last), **By season** (season › bin › item, plus "Not in a bin"), **By category** (FRC F1). Filters: season, area, status (stored / out / lent), condition (not OK), tag |
| F3 | Scan | Aim-and-hold scanner (FRC F21 rules: center square, 0.6 s hold). `hhi:bn-…` opens the bin. `hhi:sp-…` opens the spot. `hhi:it-…` opens the item. Any other code is matched against item barcodes, and an unknown one offers **Attach to an item** or **Add item with this barcode**. Codes can also be typed (a bin code like "A-04" works). Torch button |
| F4 | Pack a bin | On a bin, **Pack**: a list of what's in it, and four ways to add. (a) **Scan** an item label or barcode. (b) **Search**. (c) **From "out"**: items of the bin's season that are out, with their home in this bin first, then others, ticked to put in. (d) **Quick add**: camera first, then name, quantity (with "approx"), category. The season defaults to the bin's. Items added get status `stored` and this bin as home. Moving an item from another bin asks first ("Snowman lights is in A-07. Move it here?") |
| F5 | Unpack | On a bin, **Unpack**: **Take everything out** or tick items. Each chosen item becomes `out` with an optional "where" (recent suggestions), asked once for the batch and changeable per item. The bin can be set to `out` too. The season's setup photos (F8) are offered |
| F6 | Repack checklist | **Seasons** tab: per season, the items still `out`, grouped by their home bin ("A-04 Christmas 4 · 3 still out"). Tap an item → **Put back** (status `stored`). Scanning a bin in this view shows that bin's missing items. When a season has nothing out, it shows "All packed" and offers to set its bins back to `stored` |
| F7 | Move | Item: change its home (bin or spot) from its detail screen, by picking or scanning. Bin: **Move bin** → scan or pick the new spot. Bulk: Select mode in lists (FRC F28) → **Move to…** a bin or spot. The activity log records each move |
| F8 | Setup photos | On a season (and optionally a bin): photos with captions plus setup notes ("Mantel: garland left to right, stockings in age order"). Shown first when unpacking that season (F5) |
| F9 | Repair / replace list | **Seasons** tab › **Needs attention**: every item whose condition isn't `ok`, grouped by season (then "No season"), with its note. Actions: **Fixed** (→ ok), **Replaced** (→ ok, note cleared, optional new value), **Tossed** (deletes the item after confirming). The condition can be set from the item detail, from a Pack or Unpack line, and from Put back |
| F10 | Labels | Layouts from FRC §9 (5160, 5163, 22805, plain paper) for **bins, spots and items**. §9 has the content rules. Printing via the iOS share sheet: AirPrint, or Save to Files (PDF). Start position, alignment nudge (per layout, per phone), test print and the 100% reminder are kept |
| F11 | Manage lists | **More › Areas & spots, Seasons, Categories, Tags.** Add, rename, reorder (FRC ▲/▼ reorder mode). Remove: an area or spot holding anything asks where its contents go first (FRC F25 rule). A season or tag in use asks to confirm and is cleared from those records. Duplicate names are rejected, ignoring capitals |

### 5.2 Garage, tools and records

| # | Feature | Acceptance criteria |
|---|---|---|
| F12 | Lent out | Item › **Lend…** → a name (recent names offered) and date (default today). Status `lent`. **Lists › Out on loan**: name, item, how long. **Returned** sets it back to `stored`. Lending a bulk line lends the whole line (split it first to lend part, F16) |
| F13 | Records | Item › **Records** section: value, purchase date, model, serial, warranty until, and attachments (manual, receipt, warranty: camera, Photos or Files). **Lists › Warranties ending**: within 60 days, and ended in the last 30 |
| F14 | Insurance export | **More › Export › Insurance inventory**: every item with a value or a photo, by area. A ZIP with `insurance.csv` (path, name, category, quantity, value, purchase date, model, serial, notes, photo files), and the photos. **Print summary** opens a printable page (totals by area and overall, one photo per item) for AirPrint or Save to Files as a PDF |

### 5.3 Everyone

| # | Feature | Acceptance criteria |
|---|---|---|
| F15 | Sign-in and sync | §12. The top bar shows sync state: "Synced 2 min ago", "Offline · 3 changes waiting", "Syncing…", or an attention banner if a change was refused |
| F16 | Item editing | Detail screen: photo carousel, path breadcrumbs, quantity stepper (FRC F3 sizes), status and condition chips, and actions in the thumb zone (Move, Lend, Edit, More…). **Split a line**: take n out of a bulk line into a new item (e.g. 6 of ~40 ornaments to another bin). **Duplicate** an item. **Delete** asks to confirm, naming the item |
| F17 | Activity | **More › Activity**, newest first. Filter by person, area, season. Each item, bin and spot detail shows its last 10 entries |
| F18 | Backup and restore | **More › Export › Full backup (ZIP)** (§7). The reminder is monthly (setting; off allowed), because the server holds the main copy. **Restore** replaces everything on the server with a backup: the confirmation compares server and backup, offers "Back up first", and needs an "I understand this replaces everything" tick (FRC F17). The other phone picks the result up on its next sync. Logged in the activity |

### 5.4 Later phase: pantry, kitchen and laundry (not in the first release)

| # | Feature | Acceptance criteria |
|---|---|---|
| F19 | Keep at least and shopping list | Item `keepAtLeast`. When quantity < keepAtLeast, the item is on the shared **Lists › Shopping** list, grouped by area, with the amount needed. Ticking it when bought adds the amount bought. Typed one-off lines can be added. Live on both phones through sync. Reuses the FRC order-quantity code |
| F20 | Grocery barcode lookup | Scanning an unknown product barcode while online offers **Look it up**: Open Food Facts (free, no key) prefills name, category guess and photo. Offline, it says lookup needs a signal |

## 6. Confirmations instead of a PIN

There's no PIN, because both users can do everything (Dan, 2026-11-02). Destructive actions ask to confirm, naming what is affected:

- deleting an item, bin, spot or area (and where contents go);
- deleting a season or tag in use;
- **Tossed** on the repair list;
- Restore, which also needs the tick box.

Deleting a bin asks whether its items move to the bin's spot (the default) or are deleted too. Deleted records stay recoverable on the server for 90 days (D6), by restoring a backup or by hand. There is no undo button.

## 7. Backup formats

### Full backup (ZIP): `home-inventory-backup-<yyyy-mm-dd-hhmm>.zip`

| File | Contents |
|---|---|
| `areas.csv` | id, name, letter, order, notes |
| `spots.csv` | id, area_id, name, order, notes |
| `bins.csv` | id, code, name, spot_id, season_id, tags, state, notes, label_printed_at, label_contents |
| `items.csv` | id, name, category, subcategory, bin_id, spot_id, quantity, approx, season_id, tags, status, out_where, out_since, lent_to, lent_on, condition, condition_note, barcode, notes, value, purchase_date, model, serial, warranty_until, keep_at_least |
| `seasons.csv` | id, name, order, color, setup_notes |
| `tags.csv` | name, order (the Tags list, F11) |
| `categories.csv` | As FRC §7 |
| `files.csv` | id, owner_type, owner_id, kind, caption, order, path |
| `photos/`, `files/` | Every photo and attachment at full size |
| `manifest.json` | App name and version, savedAt, record counts |

**Rules**
- Tags are separated by `;`, and a tag can't contain `;`.
- Money is written as dollars with 2 decimals. Dates are ISO.
- Columns are matched by header name. CSV quoting and the UTF-8 / Windows-1252 rules are as in FRC §7.
- Export → restore must round-trip with nothing lost (tested). People and activity aren't in backups. They're kept on the server.
- **Data only (CSV):** `items.csv` with the path added as a readable column, for opening in Excel or Sheets. It isn't restorable.

## 8. Photos

- Several per item, bin, spot and season. Take one with the camera or choose from Photos.
- Resized on the phone to about 1600 px on the long side (JPEG, ~250 KB) plus a ~320 px thumbnail.
- Uploaded in the background. "1 photo waiting to upload" appears in the sync state.
- Reorder (the first is the thumbnail), caption and delete from the carousel. Delete asks to confirm.

## 9. QR labels

- **Payload:** `hhi:` + the record id (`hhi:bn-a1b2c3d4`). The `hhi:` prefix separates household labels from product barcodes. Old FRC `2408:` labels are not recognized.
- Labels use the id, so a rename never breaks a label. A bin's code stays the same when it moves (§3).

| Layout | Bin label | Spot label | Item label |
|---|---|---|---|
| Avery 5163 (2"×4", 10/sheet), **default for bins** | QR, **code large**, name, season chip, **contents summary** (up to 6 lines, then "+ n more") | QR, area › spot name | QR, name, path |
| Avery 5160 (1"×2⅝", 30/sheet) | QR, code, name | QR, spot name | QR, name |
| Avery 22805 (1½" square, 24/sheet) | QR, code | QR, spot name | QR, short name |
| Plain paper grid | QR (1", 1½" or 2"), code, name, cut lines | Same | Same |

- Printing a bin label stores `labelPrintedAt` and `labelContents` (§4, "Label out of date").
- **Labels screen** (More › Labels): pick bins, spots or items (or "all bins in a season / area", or "bins with out-of-date labels"), then a layout, then print.
- **Printing from an iPhone:** the print page opens the share sheet. **Print** uses AirPrint. **Save to Files** makes a PDF to print from a computer at **Actual size / 100%**.

## 10. Screens and navigation

**Bottom tab bar** (5, always visible, labels under icons):

| Tab | Shows |
|---|---|
| **Find** | Home. Search box, recently viewed, Browse (F2) |
| **Scan** | Large center button. The scanner, then the result |
| **Seasons** | The current season first (by today's date in the season order, changeable), its out / repack list (F6), setup photos (F8), Needs attention (F9) |
| **Lists** | Out on loan (F12), Warranties ending (F13), later Shopping (F19) |
| **More** | Areas & spots, Seasons, Categories, Tags, Labels, Export & backup, Activity, Settings, About, Sign out |

Detail screens (item, bin, spot):
- a photo carousel at the top;
- breadcrumbs (tap a level to open it);
- status, condition and season chips;
- the contents (bin or spot);
- recent activity;
- a sticky bottom action bar with at most 3 buttons plus "More…".

Mockups of Find, Scan result, Bin detail, Item detail, Pack, Unpack, Seasons and Labels come before H3 code (§16).

## 11. UI conventions

Adapted from FRC §17.

- **Theme:** light. The ground, card, text and fonts are as FRC (Atkinson Hyperlegible body text, Barlow Condensed for headings and numbers). A new brand color and icon are chosen at H3 mockups. The brand color is for chrome and primary buttons only.
- **Status chips** use word + icon, never color alone:
  - **Out:** filled blue-gray, arrow-out icon, "OUT · Mantel".
  - **Lent:** outline, hand icon, "LENT · Mike".
  - **Stored:** no chip.
- **Condition chips:**
  - **Needs repair:** amber fill, wrench icon.
  - **Replace:** amber outline, swap icon.
  - **Toss:** black with a red outline, trash icon.
  - **OK:** no chip.
- **Season chips** use the season's palette color with its name. These colors are never used for condition.
- **Destructive buttons:** black with a red outline and the action spelled out (FRC rule).
- **Banners:** navy for information (sync, backup reminder), light amber for attention (a refused change, labels out of date). Never red.
- **Toasts:** one line under the top bar, tap-through, 6 s (FRC v0.16).
- **Sizes:** touch targets ≥ 48 px, primary actions 56 px, steppers 64 px. Text ≥ 16 px (stops iOS zooming into inputs). Item names 19 px.
- **Reach:** primary actions sit at the bottom of the screen, within thumb reach. Nothing important is only at the top.
- **States:** every list has empty, loading and error states with one clear next step.

## 12. Sync

### 12.1 Model

- **Local-first.** Every change is written to the phone's database at once and added to the **outbox** (record type, id, full new record).
- **Push** sends the outbox in order, in batches. The server assigns `updatedAt` and `updatedBy`, writes the activity entry, and returns the accepted records.
- **Pull:** `GET /api/sync?since=<cursor>` returns every record changed after the cursor (including tombstones) plus a new cursor. It runs at launch, after every push, when the app returns to the foreground, and every 2 minutes while open and online.
- **Conflicts:** last write wins per record, in the order the server accepts them (D3, D5). Before a push, the phone pulls first. If a record it's about to push changed on the server since this phone last saw it, the push still wins, but the activity entry notes "overwrote Dan's change from 3:12 PM". Expected to be rare with two people.
- **Validation:** the server rejects malformed records, e.g. an item with both binId and spotId, or a duplicate bin code. A refused change is reverted on the phone to the server's version, with an attention banner naming it.
- **Bin codes** are assigned on the phone. If two phones offline create the same code, the server keeps the first and gives the second the next free number, with an attention banner ("A-05 was taken; your new bin is A-06; reprint its label").

### 12.2 Deletes

- A delete is a tombstone (`deleted: true`) that syncs like any change.
- The server purges tombstones and their R2 files after 90 days (D6).
- A phone whose cursor is older than 90 days does a full re-download instead of a pull.

### 12.3 Files

- Photos and attachments upload to `PUT /api/files/<id>` after their record syncs, retrying with backoff.
- They're downloaded on demand (thumbnails during pull).
- Their record shows "waiting to upload" on the phone that took them. The other phone shows a placeholder until the upload arrives.

### 12.4 Sign-in

- Cloudflare Access protects the Worker's origin, with an email one-time code and a policy listing Dan's and Ann's emails.
- The Worker reads the Access identity header, maps it to a Person, and creates the Person on first sign-in.
- **H4 starts with a spike on a real iPhone.** It tests sign-in from the home-screen app, the session lasting at least 30 days, and a sync after an offline week.
- **Fallback if the spike fails:**
  - The Worker serves its own sign-in: the email gets a 6-digit code, and the Worker issues a long-lived device token.
  - The token is stored in IndexedDB and sent as `Authorization: Bearer`. It's revocable from More › Settings › Devices.
  - Sending the email code then needs an email service. Cloudflare Email Routing can't send arbitrary mail, so the spike also confirms which free sender to use.
- **Signed out or offline:** the app keeps working on local data. Changes wait in the outbox until the person signs in again.

### 12.5 First launch

1. **Welcome**, then **Sign in** (Access).
2. A full download, with a progress bar ("Downloading 412 items, 960 photos (thumbnails)").
3. The app opens on Find.
4. On a brand-new server (no areas), a short **Set up** step:
   - Add your areas, with suggestions: Attic, Garage, Utility room, Kitchen, Pantry, Laundry, Basement.
   - Load the default seasons and categories (editable).

There is no starter catalog: start fresh (Dan, 2026-11-02).

## 13. Out of scope (first release)

- Expiration dates (not chosen).
- Maintenance reminders (not chosen).
- Items in two seasons (Dan: one season).
- More than 2 users (supported up to 5 by adding emails, but not designed for).
- Owner or member roles.
- Sharing with people outside the household.
- Android-specific features.
- Importing an existing spreadsheet (start fresh).
- Undo for deletions (recovery is by backup).
- Purchasing, suppliers, prices and budgets (FRC features, removed).

## 14. Hosting and cost

| Resource | Free allowance (approx., to recheck at H4) | Expected use |
|---|---|---|
| Workers requests | 100,000 / day | Hundreds / day |
| D1 storage | 5 GB | < 50 MB |
| R2 storage | 10 GB / month | 1–3 GB |
| Access | 50 users | 2 |
| Domain | `*.workers.dev` free | Custom domain optional, ~$10–12/yr at cost through Cloudflare Registrar |

Nothing pauses when unused. If the free tier ever changes, the full backup (F18) is the way out.

## 15. Milestones

Same routine as HANDOFF §5: spec first, a branch per milestone, tests, a review file, a PR.

| # | Milestone | Contents |
|---|---|---|
| H0 | Spec | This document |
| H1 | Strip and rebrand | Remove purchasing, helpers, PIN, starter catalog, FRC docs (D9) and their tests and checks. New name, manifest, icon placeholder, DB name, `hhi:` prefix |
| H2a | Places, bins, seasons: model | §3, §7, F7, F11, F16 (local only); upgrade from H1 |
| H2b | Places, bins, seasons: find and labels | F1–F3, F10 (local only) |
| H3 | Phone UI | Mockups (Dan approves), then §10 and §11 on every screen, iPhone checks |
| H4 | Sync and sign-in | Sign-in spike, then §12, F15, F17, F18, Cloudflare deploy. **Independent review in a fresh session** |
| H5 | Holiday workflow | F4–F6, F8, F9 |
| H6 | Garage records | F12–F14 |
| H7 | Pantry (later) | F19, F20 |

Order: H4 comes before H5, because both phones must be updating when this season's decorations are packed up (Dan, 2026-11-02).

## 16. Decision log

| Date | Decision | Who |
|---|---|---|
| 2026-11-02 | All iPhone; Cloudflare free tier; Area › Spot › Bin › Item; must work offline | Dan |
| 2026-11-02 | Holiday: out/packed, setup photos, repair/replace list, contents on labels; one season plus tags; mixed item/bulk lines; Avery sheets | Dan |
| 2026-11-02 | Pantry later (keep at least + shopping list, UPC lookup); tools: lent out, records and attachments, value for insurance; everyone equal, no PIN; activity log | Dan |
| 2026-11-02 | Several photos; pack by scanning the bin then adding items; start fresh; name "Hiebert Home Inventory" | Dan |
| 2026-11-02 | D1–D10 confirmed (plan §8) | Dan |
| 2026-11-02 | Sync before the holiday workflow (Christmas packing); 2 users only; free `workers.dev` address for now; one season per item; value and records fields on every item | Dan |
| 2026-11-02 | H1 details (a)–(h) accepted (`docs/reviews/H1.md`); app version numbering restarts at 0.1 for the new build | Dan |
| 2026-11-02 | Version scheme: no milestone suffix; the milestone number is the third position (H1 = 0.1.1, H2 = 0.1.2, …) | Dan |
| 2026-11-02 | H2 in two PRs: H2a 0.1.2 and H2b 0.1.3, so each installed build has its own number; later milestones follow on (H3 = 0.1.4) | Dan |
| 2026-11-02 | H1 data is upgraded in place; H1 locations become spots in an "Unsorted" area; every §3 item field is stored from H2a | Dan |

## 17. Open questions

None blocking H1. To settle during the work:
- Brand color and icon (H3 mockups).
- The free email sender, only if the §12.4 fallback is needed (H4 spike).
