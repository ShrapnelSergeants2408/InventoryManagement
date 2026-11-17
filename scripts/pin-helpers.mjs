// In-page helpers for the browser checks since M6: first-launch PIN setup and answering the
// real PIN pad. Needs $, $$, norm, byText and settle from the check's own helpers.
export const TEST_PIN = '2408';

export const PIN_H = `
  const pinDlg = () => $('[role=dialog][aria-label="Mentor PIN"]');
  const enterPin = async (pin) => {
    for (const d of pin) { $$('.pkey').find((b) => norm(b.textContent) === d).click(); await settle(40); }
    $('.pin-go').click();
    await settle(450);
  };
  // M16b (F22): a fresh device first asks what it is; builds before M16b go straight to the PIN.
  const pickShopTablet = async () => {
    for (let i = 0; i < 300 && !$('.setup'); i++) await settle(100);
    const shop = $$('.role-opt').find((b) => norm(b.textContent).includes('Set up the shop tablet'));
    if (!shop) return;
    shop.click();
    for (let i = 0; i < 100 && !$('.setup .pinpad'); i++) await settle(100);
  };
  // A button that may not be on screen yet when the machine is busy (checks run side by side).
  const waitBtn = async (sel, text) => {
    for (let i = 0; i < 100 && !byText(sel, text); i++) await settle(100);
    const b = byText(sel, text);
    if (!b) throw new Error('no button ' + text + ' in ' + sel);
    return b;
  };
  const doSetup = async (pin = '${TEST_PIN}') => {
    for (let i = 0; i < 300 && !$('.setup'); i++) await settle(100);
    if (!$('.setup')) throw new Error('first-launch setup did not appear');
    await pickShopTablet();
    await enterPin(pin);
    // Wait for the confirm step before typing again: on a busy machine (checks side by side) the
    // second PIN was once typed before it appeared and was lost (M31).
    for (let i = 0; i < 300 && !byText('.setup', 'Type the same PIN again'); i++) await settle(100);
    if (!byText('.setup', 'Type the same PIN again')) throw new Error('the confirm-PIN step did not appear within 30 s');
    await enterPin(pin);
    // Up to 30 s: setting the PIN hashes it slowly on purpose, and with several checks running at once
    // (npm run checks) the recovery step once took longer than the 10 s this used to wait (M31).
    for (let i = 0; i < 300 && !$('.recovery input[type=checkbox]'); i++) await settle(100);
    if (!$('.recovery input[type=checkbox]')) throw new Error('the recovery code step did not appear within 30 s');
    $('.recovery input[type=checkbox]').click();
    await settle(150);
    (await waitBtn('.recovery button', 'Next')).click();
    await finishStart();
  };
  // Setup step 3 (M10, 9h–9j): load the starter catalog, then Go to inventory.
  const finishStart = async () => {
    for (let i = 0; i < 100 && !$('.sopts'); i++) await settle(100);
    if (!$('.sopts')) throw new Error('setup step 3 did not appear');
    (await waitBtn('.setup-acts .btn', 'Load starter catalog')).click();
    for (let i = 0; i < 600 && !$('.sdone'); i++) await settle(100);
    if (!$('.sdone')) throw new Error('the starter catalog did not finish loading');
    (await waitBtn('.setup-acts .btn', 'Go to inventory')).click();
    await settle(800);
  };
  // yes: the PIN, then lock again at once (unless stay), so every later PIN step asks (as the
  // M3–M5 checks expect). no: Cancel.
  const answerGate = async (yes, stay = false) => {
    for (let i = 0; i < 30 && !pinDlg(); i++) await settle(100);
    if (!pinDlg()) throw new Error('the PIN pad did not appear');
    if (!yes) { byText('[aria-label="Mentor PIN"] button', 'Cancel').click(); await settle(450); return; }
    await enterPin('${TEST_PIN}');
    for (let i = 0; i < 30 && pinDlg(); i++) await settle(100);
    if (pinDlg()) throw new Error('the PIN pad stayed open: ' + norm(pinDlg().textContent));
    await settle(300);
    if (!stay) $('.lockpill.on')?.click();
    await settle(150);
  };
  // Locks if unlocked. Since the independent M6 review, dialogs opened behind the PIN close when
  // mentor tools relock, so a check that uses such a dialog answers with stay = true and
  // relocks with this before its next PIN step.
  const relockNow = async () => { $('.lockpill.on')?.click(); await settle(150); };
`;
