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
  const doSetup = async (pin = '${TEST_PIN}') => {
    for (let i = 0; i < 300 && !$('.setup'); i++) await settle(100);
    if (!$('.setup')) throw new Error('first-launch setup did not appear');
    await enterPin(pin);
    await enterPin(pin);
    $('.recovery input[type=checkbox]').click();
    await settle(150);
    byText('.recovery button', 'Finish setup').click();
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
