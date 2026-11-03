# H2a: places, bins, seasons (the model)

**Branch:** `h2a-model`, stacked on `h1-version-0.1` (PR #3, not yet merged) · **SPEC:** v2.0 §15 H2a · **App version:** 0.1.2 · **Date:** 2026-11-02

## What was built

H2 is split in two (Dan, 2026-11-02). H2a gives the app the SPEC v2.0 data model and the screens to manage it. H2b adds Find and Browse (F1, F2), scanning bins and spots (F3), and bin and spot labels (F10).

**Decisions behind it (Dan, 2026-11-02):**
- The H1 data is upgraded in place.
- H1 locations become spots in an "Unsorted" area.
- Every §3 item field is stored now and most are shown.
- Versions: H2a is 0.1.2, H2b is 0.1.3.

All four are in SPEC "Built so far" and the decision log.

**Data (schema v2, `src/data/db.ts`):**
- Areas (with a letter), spots, bins (code, spot, season, tags, state, label fields), seasons (palette color, setup notes), tags, and items with every §3 field.
- Several photos per item, bin, spot or season, in a new `pictures` table: id, owner, kind, caption, order.
- The upgrade from H1 (v1) runs the first time 0.1.2 opens:
  - each H1 location becomes a spot in **Unsorted (U)**, in walk order, and a location only items named becomes a spot too;
  - items keep it as their spot;
  - each item photo becomes that item's first photo;
  - the 10 default seasons are added.
- The guard is kept: an older copy of the app that finds v2 shows "update needed" and writes nothing.

**Rules (`src/domain/`):**
- `places.ts`:
  - bin codes: "a4" is tidied to A-04, and a new bin gets the next number in its area;
  - an area's default letter;
  - an item's path ("Attic › Shelf B › A-04 Christmas 4") and season (its own, else its bin's);
  - a bin's contents summary (§4).
- `integrity.ts`: a whole household checked together before a restore or setup writes it:
  - every link points at a record that exists;
  - names, letters and codes are unique where §3 says so.
- `validate.ts`: item status, condition, money, dates and tags; areas, spots, bins, seasons.

**Data operations:**
- `places.ts`:
  - areas: add, edit, reorder, remove (its spots move to another area);
  - spots: add, rename, reorder, move to another area, remove (contents move to another spot or to none);
  - bins: add with an automatic code, edit, Move bin, delete (items move to the bin's spot, or are deleted).
- `items.ts`: add and edit (new subcategories and tags join their lists), Move (F7, one or many), Split a line, Duplicate.
- `lists.ts`: seasons and tags, each with add, rename, reorder and remove (cleared from the records that had it). Categories as before.
- `photos.ts`: add, reorder, caption and delete; the item's `hasPhoto` stays in step.

**Backup (§7):**
- The full backup holds areas.csv, spots.csv, bins.csv, items.csv, seasons.csv, tags.csv, categories.csv, files.csv, photos/ and manifest.json (with counts).
- Restore reads it, and also an **H1 (0.1.1) backup ZIP**, converted the same way as the upgrade.
- Data only (CSV) is items.csv with a readable path and season first.

**Screens:**
- **Item detail:**
  - a photo carousel (add, reorder, caption, delete);
  - tappable breadcrumbs;
  - status, condition, season and tag chips;
  - the stepper, details, and a collapsed Records section;
  - Edit and Move…; More… holds Split this line, Duplicate, Print QR label and Delete.
- **Item editor:**
  - name and category;
  - Home (a picker of areas, spots and bins, with recent picks and search);
  - barcode, quantity and "About this many";
  - condition and its note;
  - season ("Same as its bin (Christmas)"), tags (typed or picked), notes;
  - value, and Records (purchase date, warranty until, model, serial);
  - several photos, saved with Save.
- **Bin:**
  - large code, path, season and tags, what's in it, and its label summary;
  - Add item here, Move bin…, Edit bin, Delete bin…;
  - the bin editor suggests the next code.
- **Spot:** its bins and loose items; Add bin here, Add item here, Rename, Move to another area, Remove.
- **More › Areas & spots:**
  - areas with letters and their spots;
  - add (with suggestions while unused ones remain), edit, reorder, remove;
  - Move… a spot to another area;
  - bins with no spot.
- **More › Seasons:** color swatches, setup notes, reorder, remove with counts. **More › Tags:** rename everywhere, reorder, remove.
- **Inventory:**
  - rows show the path;
  - filters for category, area, season, status, "Needs attention" and tag;
  - Select › **Move to…** (a bin or spot) or **Category…**.
- **Labels:** item labels print the path; group by category or by area.
- **Setup:** Start fresh loads the categories and seasons, then opens Areas & spots.
- **Scan:** location-name scanning is gone. Bin and spot labels come with H2b.

## Evidence

- `npm test`: **29 files, 405 tests pass.**
  - New: `upgrade-h1` (the v1 → v2 upgrade on an H1-shaped database), `places`, `places-db`, `household-csv`.
  - Rewritten for the model: `backup-restore`, `backup-safety`, `backup-edge-cases`, `photos`, `edits-db`, `db`, `setup`, `filters`, `search`, `inventory-view`, `item-form`, `labels`, `router`.
  - The round trip covers every field, photos on all four owner types with captions and order, tricky text, a second round trip giving identical files, a re-zipped folder, and an H1 ZIP.
  - Restore refuses bad rows (with row numbers) and records that don't fit together. A failure inside the transaction leaves the phone unchanged.
- `npm run build`: type check clean, PWA built.
- `node scripts/h2a-ui-check.mjs`: **35/35 PASS**, no console errors or warnings. Real Chrome and IndexedDB:
  - it builds an **H1 database exactly as 0.1.1 declared it**, then opens 0.1.2: the upgrade, the Unsorted spots and the photo are checked;
  - it sorts a spot into a new area;
  - then from a fresh start it drives areas, spots, a bin, an item with every field and two photos, Move, Split, Duplicate, seasons, tags, delete bin, search, bulk Move, labels, Backup wording and the manifest.
- INFO from the same check: at iPhone width (390 px), Inventory, item, spot, Areas & spots and the editor don't scroll sideways. H3 restyles them.
- `scripts/h1-ui-check.mjs` was replaced by `h2a-ui-check.mjs`. What it checked was H1's flat locations, which no longer exist; the rest (first launch, typed scan, More, manifest, iPhone report) is in the H2a check.

## Details I decided (for Dan to confirm)

- **(a) Bin codes.** A new bin gets one more than the highest number used with its area's letter, so a deleted bin's code is never handed out again. Two digits minimum (A-04; A-100 after A-99). Typed codes are tidied ("a4" → A-04) and must be unique.
- **(b) Letters.** Changing an area's letter keeps existing bins' codes (§3: labels stay true). A bin with no spot takes its letter from an area chosen in the bin form.
- **(c) Seasons:**
  - The 10 defaults, with colors from a 10-color palette: Valentine's pink, St. Patrick's green, Easter purple, 4th of July navy, Fall brown, Halloween orange, Thanksgiving gold, Christmas red, Winter teal, New Year's blue.
  - An upgraded H1 phone gets them too.
  - A new season takes the first unused color.
- **(d) Photos:**
  - Photos are now about 1600 px and thumbnails 320 px (SPEC §3, §8, D10); H1 used 1024 px and 160 px.
  - The carousel order is kept on each photo, not as a `photoIds` list on the record.
  - Restored photos keep their ids.
- **(e) Removing places:**
  - An area with spots needs another area to move them to; its spots can't be deleted with it.
  - Removing a spot moves its bins and loose items to another spot, or to no spot.
  - Deleting a bin moves its items to the bin's spot by default, or deletes them after a choice.
- **(f) Restore takes only full-backup ZIPs** (H2a or H1). SPEC §7 says the data-only CSV isn't restorable; H1's data-only CSV is refused too. In an H1 ZIP, a photo named but missing is dropped, since there's no matching photo on the phone to keep.
- **(g) Backup columns:**
  - bins.csv adds `label_contents` (needed for "Label out of date").
  - A `tags.csv` keeps the Tags list order.
  - Data only adds a readable `season` beside the path.
  - SPEC §7 updated.
- **(h) Split and Duplicate:**
  - Split copies the details into the new line but not the photos or barcode.
  - Duplicate copies the photos, adds "(copy)" to the name, and leaves the barcode blank so a scan stays unambiguous.
- **(i) Status is read-only for now.** Out and lent show as chips and filters; the actions that change them are H5 (Unpack, Put back) and H6 (Lend, Returned).
- **(j) Inventory Select** has two actions: **Move to…** (a place, F7) and **Category…** (the H1 bulk move).
- **(k) Setup:** after Start fresh, the button is "Add your areas and spots". Area suggestions (§12.5) are chips on Areas & spots while unused ones remain.

## Not done here (on purpose)

- **H2b:**
  - Find with grouped results;
  - Browse by place and by season;
  - scanning `hhi:bn-`/`hhi:sp-` labels and typed bin codes;
  - bin and spot labels with the contents summary, and "Label out of date".
- **Recently viewed** records bins and spots already, but only items are listed until H2b's Find.
- **Attachments** (H6) and the **pantry** fields (H7) are stored but not shown.
- **Look:** the new chips and screens use the current styles; H3 restyles everything.
- **One thing to know:** adding a bin or spot photo first failed with Dexie's "transaction committed too early". It works now, after `applyPhotoEdits` was rewritten as direct database calls; the tests cover it. I couldn't reproduce the cause in a small test, so the comment there says so.

## Phone check (once merged and deployed)

1. **Before updating:** on the phone running 0.1.1, More › Backup & restore › **Full backup**, and save it to Files.
2. Open the app and wait for the Reload banner. More › App version should show **0.1.2**.
3. **Inventory:** each item shows "Unsorted › <its old location>", and photos are still there.
4. **More › Areas & spots:**
   - add Attic and Garage (tap the suggestions);
   - **Move…** each Unsorted spot to its real area;
   - remove Unsorted once it's empty.
5. On a spot, **Add bin here**: the code is suggested (e.g. A-01). Then **Add item here**: take two photos, set a tag and a value, and save.
6. On the item: swipe the photos, **Move…** it to another spot, then **More… › Split this line**.
7. Restore test on a spare install (not the main phone): **Restore a backup file** with the 0.1.1 backup from step 1. The locations come back as Unsorted spots.

## Outcome

_To be filled in when Dan confirms (a)–(k) and the phone check._
