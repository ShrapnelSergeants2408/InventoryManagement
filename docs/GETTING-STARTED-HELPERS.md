# Getting started: counting with helper devices

For the first full count, with the shop tablet as the main device and students' Android phones, iPhones and spare tablets as helpers. Files move through one shared Google Drive folder owned by the team account.

Written 2026-11-10, updated 2026-11-12 for app version 1.2.0 (More › About shows the version). The full rules are in `docs/SPEC.md` §18.

**How it works:** the shop tablet makes a **count kit** file for each helper. The helper opens the kit, counts, and makes a **counts file**. The tablet imports the counts files. Nothing syncs by itself: a count reaches the tablet only when its counts file is imported.

---

## Rules that prevent lost counts

1. **One kit, one device.** Don't open the same kit on two phones. Both count as the same helper. The import warns when it sees this, both phones' new items are kept, and where they counted the same item with different numbers you are asked which to keep. Still, a second phone should have its own helper and its own kit.
2. **Saved to Downloads isn't sent.** On Android, **Send my counts** only saves the file to the phone's Downloads. The Send screen says "Saved to Downloads" and "Not on the shop tablet yet" until the student uploads the file to the Drive folder and taps **I've sent it**.
3. **Send at the end of every session.** A phone can clear a website's data after a few days without use (iPhones especially). Counts not yet sent are lost with it.
4. **Use the normal browser:** Chrome on Android, Safari on iPhone. Not a private or incognito tab, and not the browser built into another app (a link opened inside a chat app). Each of those keeps its own data, and some erase it.
5. **Don't count a helper's groups on the shop tablet** while that helper is out. Two different numbers for one item become a conflict you settle by hand at import.
6. **A new kit replaces everything on the device.** Send a helper another kit only when you changed its groups or its data was lost, and have the student send their counts first. The new kit keeps the tablet's count round, so items already counted this round stay counted.

---

## Before the session (mentor, about 15 minutes)

**0. Check the version.** More › About should show **1.2.0** or later. If it shows 1.0.0, update the tablet first (`docs/HANDOFF.md` §7). A phone that opens the app for the first time gets the current version by itself.

**1. Back up the tablet.** More › **Backup, restore & price import** › **Full backup (ZIP)**, and put it in Drive.

**2. Make the Drive folder.** In the team account's Drive, make a folder such as `Inventory count` with two folders inside: `Kits` and `Counts`. Share it so students can add files (Editor). Students need a Google account on their phone to upload.

Then copy each folder's link (Drive › the folder › Share › Copy link) into **More › Reminders & limits › Shared Drive folders** on the tablet (mentor PIN): **Kits folder link** and **Counts folder link**. Helper devices then shows a QR code for the Kits folder that students can scan to reach their kit, and each kit carries both links, so a student's Send tab has **Open the Counts folder** (and **Open the Kits folder**) buttons. Import counts has **Open the Counts folder** too. Set the links before sending the kits.

**3. Check the helpers.** Count › **Helper devices**.
- One helper for each device, named so the student knows which is theirs.
- Under **Categories** (or **Locations**), anything marked **Not assigned** has nobody counting it. Give it to a helper, or count it yourself on the tablet.

**4. Send each kit.** On each helper card: **Send count kit** › **Send count kit**. Leave **Include photos** on (photos help students recognize parts).
- The tablet saves `<name>_Helper.zip` (e.g. `Bin_A-B_Helper.zip`) to its Downloads (with several helpers, **Send all kits…** makes every helper's kit in one go; Helper devices shows each helper's last import and how many items it has counted) and says "Saved to Downloads, not sent yet". It doesn't open the share menu for this kind of file. Tap **Done**.
- When all kits are saved, open the Drive app › **+** › **Upload**, choose the kit files from Downloads, and put them in `Kits`.

**5. Give students two things:**
- the app: they scan the QR code at the top of Count › **Helper devices** on the tablet, or type `team2408.com/InventoryManagement/`
- the link to the Drive folder (team chat, or on the board)

**6. Try it once** with one phone before the session: join, count one item, send, import. It takes five minutes and shows whether the Drive sharing works for students' accounts.

---

## During the session (students)

The student card at the end has these steps in short form.

**Join (once per device)**
1. Open the Drive folder › `Kits`, and download the kit with your helper's name to the phone.
2. Open the app in Chrome (Android) or Safari (iPhone): scan the QR code on the shop tablet, or type the address. It asks **What is this device?**
3. Tap **Join as a helper** › **Choose the count kit…** and pick the kit you downloaded.
4. Check the name and groups shown, then **Start counting**.

A navy **HELPER · name** bar stays at the top, with three tabs: **Count**, **Scan**, **Send**. After this the app works without internet until it's time to send.

**Count**
- **Count** tab: tap **Start** on a group. For each item, type how many are in the shop and tap **Save & next**. Not sure? **Skip for now**. **Pause** goes back to the group list; progress is kept.
- Turn on **Ask for a bin/shelf location while counting** to record where each part lives as you go.
- **Scan** tab: scan a QR label or barcode to count that item, or type its ID or name and tap **Find**. This reaches any item, including ones outside your groups.
- Found something that isn't in the list? **Add item not on the list**, fill in the name, category and how many, and **Save as pending**. A mentor reviews it on the tablet later.

**Send (end of every session)**
1. **Send** tab › **Send my counts**.
2. **Android:** the file `counts-<name>-<date>-<time>.zip` is saved to Downloads. Tap **Open the Counts folder** on the Send tab (or open the Drive folder › `Counts`) › **+** › **Upload** and choose it. Then go back to the app and tap **I've sent it**.
   **iPhone:** the share menu opens. Choose **Drive** and the `Counts` folder, or **Save to Files** and then upload it from the Drive app.
3. Tell the mentor it's uploaded.

Every counts file holds everything since the kit was opened, so sending again is always safe and only the newest file from each helper matters.

---

## Bringing counts into the tablet (mentor)

1. Count › **Import counts** › **Choose counts files…**. Pick the files from Drive. Picking every helper's file in one go is simplest; if you import in several rounds, each import has its own **Undo this import**, newest first.
2. Read the preview. Nothing is saved yet.
   - **Will apply:** new counts.
   - **Conflicts:** an item counted twice with different numbers. Choose **Keep this tablet's**, **Use helper's** or **Add together** (for parts stored in two places). **Use newest for all** settles them all, and trusts each phone's clock.
   - **Outside groups:** counted by a helper it wasn't assigned to. Worth a glance.
3. Tap **Apply n counts**. Everything saves together.
4. On the summary: **Review new items** if there are any, then **Back up now**. If the import looks wrong, **Undo this import** puts everything back.

**New items from students:** Count › **Pending from helpers**. For each one: **Accept…** (opens the Add item form filled in), **Same as existing…** (it was already in the list; use or add its count) or **Discard**.

Importing the same file twice changes nothing, so when in doubt, import again.

---

## Between sessions and at the end

- **Next session:** students open the app and carry on. No new kit is needed. They send again at the end; you import the newer files.
- **A device needs different groups?** Have the student send first and import that file. Then edit the helper, send it a new kit, and have the student open it from Send › **Open a new kit…**. The new kit carries the numbers already imported, and items already counted this round show as counted.
- **Count finished:** check that each helper's last file is imported, then on each device Send › **Leave helper mode**. Make a full backup on the tablet.
- **Progress:** the tablet's Count screen shows each group's count and its helper. It moves only after an import.

## If something goes wrong

| What you see | What to do |
|---|---|
| The phone doesn't ask "What is this device?" or looks out of date | Reload the page. On an iPhone, if that doesn't help, clear Safari's data for the site (send counts first if there are any) |
| "This file isn't a count kit", "This is a counts file…" or "This is an inventory backup…" | The student picked the wrong file. Pick the one named after the helper, like `Bin_A-B_Helper.zip` |
| The kit file is greyed out in the picker | Download it to the phone first, then pick it from Downloads or Files |
| A phone lost its data mid-count | Import the last file it sent, then send that helper a new kit. Only what wasn't sent needs recounting; items imported earlier this round show as counted, so the student can pick up where they stopped |
| Import warns a kit "was opened on 2 devices, or opened again on one" | Two phones used one kit, or a phone opened its kit a second time. Nothing is lost. Where two people counted the same item with different numbers, the preview asks which to keep (Keep the earlier / Use the later / Add together). Recount anything that looks wrong |
| Import warns the file is "from a count kit this tablet didn't send" | It can still be imported. Check the preview with more care |
| A student opened someone else's kit | Have them stop. Send › **Leave helper mode** (choose **Discard and leave** if it asks), then join with the right kit and recount |

---

## Student card

**Counting parts with your phone**

1. Scan the **Kits folder** QR code on the shop tablet (or open the Drive folder › **Kits**). Download the kit with **your helper's name**. Only you use this kit.
2. Scan the QR code on the shop tablet, or open **team2408.com/InventoryManagement** in Chrome (Android) or Safari (iPhone). Not a private tab.
3. Tap **Join as a helper** › **Choose the count kit…** › your kit › **Start counting**.
4. **Count** tab: tap **Start** on a group. Type how many are really there, then **Save & next**. Unsure? **Skip for now**.
5. A part that isn't in the list: **Add item not on the list**.
6. **Before you leave, every time:** **Send** tab › **Send my counts**, then upload the `counts-…zip` file to the Drive folder › **Counts**. If the app says "Saved to Downloads", tap **I've sent it** once it's uploaded. Tell a mentor.
7. Next time, just open the app again and keep counting.

Don't clear your browser data until the count is finished.
