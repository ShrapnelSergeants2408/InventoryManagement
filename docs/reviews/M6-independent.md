# M6 independent review — Mentor PIN & settings

**Reviewed:** commits `aa27471`, `375b8f0` and `cf35e44` (diff `cf9b665..cf35e44`). Written in a fresh session, as the earlier [M6 review](M6.md) and stage4-plan §4 recommended; the earlier review was not trusted. Checked against:
- SPEC v0.5 §6 and §17;
- the PIN parts of F8, F9, F17, F18, F23 and F25;
- spec-questions D6, S9 and Q2.

The standard is §6's: accident prevention, not security against someone with DevTools.

**Date:** 2026-10-18, 10:33–11:55 CDT · **Risk: High**

## How it was done

| What | Result |
|---|---|
| `npm test` before any change | 25 files, 339 tests, all pass |
| `scripts/m6-ui-check.mjs` before any change | 49/49, twice, with no console errors |
| A separate senior reviewer read the code against the SPEC in its own git worktree and wrote tests to prove each finding | 8 tests (`tests/m6-review.test.ts`) |
| The Director re-ran the reviewer's tests on the main checkout and read `DeleteItem.tsx` and `GateHost.tsx` for findings 1 and 2 | Both reproduced |

**No way past the PIN from a locked start was found.** Every write that needs the PIN goes through `gate()`. With no PIN pad registered (during setup), `gate()` says no. The findings are about what happens after the gate has said yes, and about error handling.

## Findings

| # | Severity | Finding | Outcome |
|---|---|---|---|
| 1 | **Medium-high** | **The delete confirmation outlived the unlock.** Delete asked for the PIN only to open the confirmation, and "Delete item" then deleted without checking again. A mentor could unlock, open the confirmation and walk away. Minutes after the pill showed "Locked", a student could still delete the item, which can't be undone. The supplier, category and location rename/remove dialogs and Change PIN behaved the same way. The earlier review accepted this for "short" dialogs (its finding 6), but didn't name Delete. | **Fixed.** A new hook, `useCloseOnRelock`, closes every dialog opened behind the PIN when mentor tools relock, whether by the timer or the lock button. That covers delete, add/rename/remove supplier, category and location rename/remove, and Change PIN. Dialogs that need no PIN (add location, add category or subcategory, Forgot PIN) stay open. Delete also calls `gate()` again when "Delete item" is tapped. That covers a tablet that slept past the unlock time before its timer fired. |
| 2 | **Medium** | **The PIN pad could freeze.** If checking the PIN threw an error (a closed database, or an unusable stored hash), `busy` stayed true for good. The keys, Cancel, Escape and tapping outside were all disabled, the gate never answered, and the pad covered the app until a reload. The recovery-code check had the same pattern. | **Fixed.** Both checks use try/finally. The pad says "Couldn't check the PIN: …", clears the digits, and the keys and Cancel work again. |
| 3 | Low | The 30-second wait is kept in memory only, so a reload clears it. The wrong-try count never decays. The wait follows the wall clock. | Open, by decision: D6 doesn't require the wait to survive a reload, and this is accident prevention. Tests F-C record the behaviour. |
| 4 | Low | **Settings limits are checked only on screen.** `setSettings` stores `unlockMinutes: 0`. With that value a right PIN reports success but nothing unlocks. Not reachable from the app today. | Open. Tests F-B. |
| 5 | Low | **Hardware keyboard:** Enter on a focused Cancel or "Forgot PIN?" submits the PIN. There is no focus trap, but any control reached behind the pad calls `gate()` again. | Open. |
| 6 | Low | **Forgot PIN inside the PIN pad:** the dialog checks the pad's busy flag, not the recovery flow's. If saving the new PIN succeeds but unlocking afterwards fails, the message says "Couldn't save the new PIN". | Open. |
| 7 | Test gap | The browser gate matrix confirms only that the pad appears. A bug that asks for the PIN but ignores the answer would pass it. | Partly closed: the new relock checks confirm the dialogs close and the item stays. Unit tests of `GateHost` and `PinPad` are still open. **Closed in M23** (2026-10-29) by a browser check instead (`scripts/m23-ui-check.mjs`): Cancel, a wrong PIN and the right PIN, each checked for what happens to the action (delete item, settings save), not only that the pad appears. `gate()` itself has unit tests in `tests/pin.test.ts`. |

**The 6 interface mutants the earlier review didn't run.** The reviewer judged these by reading `m6-ui-check.mjs`, not by running them:
- Each would be caught: the gate matrix catches delete without the PIN; Escape over stacked dialogs (line 242); the vendor save not re-checked (line 237); settings saved without the PIN (line 272); the unlocked lock button not locking (line 184); setup not comparing the two PINs (line 157, a script error).
- One exception: a delete mutant that still calls `gate()` but ignores its answer would not be caught (finding 7).

**Checked and sound:**
- The whole hash is compared in constant time.
- The algorithm, iteration count and salt are stored with each hash.
- The PIN and recovery code are saved in one `bulkPut`, and only after "I wrote it down".
- The app can't be used before a PIN is set.
- The relock is decided by the wall clock, so it's correct after the tablet sleeps.
- The recovery code is replaced on use.
- Restore leaves the PIN and settings untouched.
- The Editor and Settings re-check the lock at save.

## Fixes and their evidence

| Fix | Browser (`scripts/m6-ui-check.mjs`, now 54 checks) |
|---|---|
| Relock closes gated dialogs (finding 1) | **relock closes the delete confirmation; the item stays**; **relock closes Rename supplier, Remove supplier and Change PIN**; **a dialog that needs no PIN stays open on relock (Add location)** |
| The PIN pad recovers from a failed check (finding 2) | **PIN check error**: the stored hash is made unusable in IndexedDB. The message shows, the keys and Cancel work, and once the hash is put back the right PIN unlocks. **Recovery check error**: the same for the recovery code; the message shows and "Check the code" works again |

Unit tests F-A and F-D in `tests/m6-review.test.ts` record the data-layer behaviour behind findings 1 and 2. `tryPin` can throw, and `gate()` is decided once. The fixes are in the UI, and the browser checks above cover them.

**Knock-on change to the browser checks:** the M2–M5 checks lock again straight after each right PIN (`answerGate`), so that every later PIN step asks. That now closes the dialog the PIN just opened. `scripts/m3-ui-check.mjs` therefore answers with the tablet left unlocked and locks again (`relockNow`, in `scripts/pin-helpers.mjs`) before each PIN step. M3 is 50/50 again.

## Mutation check of the fixes

A third agent, separate from the one that wrote the fixes, undid each fix in turn and ran the tests and the browser check, restoring from a saved copy each time. One more mutant was run afterwards by the Director, on the check added for it.

| Mutant | Caught? |
|---|---|
| `useCloseOnRelock` never closes | ✅ m6: 2 checks fail |
| Delete: no close on relock **and** no second `gate()` at confirm | ✅ m6: "relock closes the delete confirmation" |
| Delete: second `gate()` at confirm removed (the close still works) | ❌ **not caught**. With the close working, no check can reach a confirm still open after relock. The second check only matters when the tablet sleeps through the relock, so it stays as backup protection without a test |
| PIN pad submit back to the pre-fix code | ✅ m6: "PIN check error" `[false,false,false,false]` |
| Recovery-code check back to the pre-fix code | ❌ at first (no check reached it). ✅ after adding the browser check **recovery check error**, which then fails `[false,false]` |

**From the verifier's code review:**
- No bugs in the fixes.
- Every `useCloseOnRelock` call comes before any early return.
- Each set of dialogs that close matches the dialogs opened behind `gate()`.
- The vendor fields the Editor opens after the PIN don't close on relock, but Save asks for the PIN again (Editor.tsx:167).

**One gap it raised, now fixed:**
- The dialogs closed only on the relock *event*, which a timer fires. After the tablet sleeps that timer can be late, and with a corrupt unlock length of 0 it never fires.
- `useCloseOnRelock` now also checks the wall clock once a second while a gated dialog is open.
- This is not covered by a browser check: it would need a sleep, or the clock moved, in headless Chrome.

## Regression

| Check | Result |
|---|---|
| `npm test` | **27 files, 357 tests, all pass** (339 + 18 from the two review test files) |
| `npm run build` | Clean |
| `scripts/m2-…` to `m6-ui-check.mjs` | 28/28, 50/50, 25/25, 39/39 and 54/54 (after the final change, m6 re-run: 54/54); no console errors |

## Remaining uncertainty

- **Open, low:** findings 3–7 above. Also untested: Delete's second PIN check at confirm, and the once-a-second wall-clock close.
- **By design (§6):** anyone with Chrome DevTools can clear the stored hash.
- **Stage 5:** how fast the PBKDF2 check runs on the Tab S8.
