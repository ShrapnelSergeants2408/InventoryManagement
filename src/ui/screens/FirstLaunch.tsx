// First launch on a fresh device (F22): what is this device? The shop tablet goes on to the
// PIN, the recovery code and the starter catalog (Setup.tsx). A helper chooses a count kit
// (§18.2) and starts counting: no PIN, no catalog. A device that already has an inventory
// never sees this (§18.7). The helper's database is made only once a kit has been chosen.
import { useState } from 'preact/hooks';
import logoUrl from '../../../assets/team-logo-512.png?url';
import { HelperDb, joinKit } from '../../data/helper-db';
import type { ReadKit } from '../../io/count-kit';
import { Icon } from '../icons';
import { KitPicker, KitSummary } from '../helper/KitPicker';
import { countPrefsForKit } from '../helper/session';

export function FirstLaunch(props: { onShop: () => void; onJoined: (db: HelperDb) => void }) {
  const [step, setStep] = useState<'choose' | 'join'>('choose');
  const [read, setRead] = useState<ReadKit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    if (!read || busy) return;
    setBusy(true);
    setError(null);
    const db = new HelperDb();
    try {
      await joinKit(db, read);
      countPrefsForKit(read.kit);
      location.hash = '#/count';
      props.onJoined(db);
    } catch (e) {
      db.close();
      setBusy(false);
      setError(`Couldn’t open the kit on this device: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div class="setup">
      <aside class="setup-side">
        <img class="setup-logo" src={logoUrl} alt="Shrapnel Sergeants, FRC Team 2408" />
        <h1 class="setup-title">FRC 2408 Inventory Management</h1>
        <p class="small">{step === 'choose' ? 'First launch on this device' : 'Join as a helper · count, then send your counts back'}</p>
      </aside>
      <main class="setup-main">
        {step === 'choose' ? (
          <div class="setup-start">
            <h2 class="setup-h">What is this device?</h2>
            <div class="sopts">
              <button type="button" class="sopt role-opt" onClick={props.onShop}>
                <Icon name="inventory" class="ic xl" />
                <span class="sopt-t">
                  <span class="sopt-h">Set up the shop tablet</span>
                  <span class="small muted">The team’s main tablet: the whole inventory, the order list, backups and the mentor PIN. A mentor should do this.</span>
                </span>
              </button>
              <button type="button" class="sopt role-opt" onClick={() => setStep('join')}>
                <Icon name="phone" class="ic xl" />
                <span class="sopt-t">
                  <span class="sopt-h">Join as a helper</span>
                  <span class="small muted">A phone or tablet that helps count. Open the count kit the shop tablet sent you, count your groups, then send your counts back. No PIN.</span>
                </span>
              </button>
            </div>
          </div>
        ) : (
          <div class="setup-start">
            <h2 class="setup-h">Open your count kit</h2>
            <p class="m0">
              The shop tablet sends it from <strong>Count › Helper devices › Send count kit</strong>, by Quick Share, Drive, email or Bluetooth. It’s called <span class="mono">count-kit-…zip</span>.
            </p>
            {read ? (
              <>
                <KitSummary read={read} />
                {error && (
                  <p class="pin-err" role="alert">
                    {error}
                  </p>
                )}
                <div class="setup-acts">
                  <button type="button" class="btn pri lg" disabled={busy} onClick={() => void join()}>
                    {busy ? 'Opening…' : 'Start counting'}
                    <Icon name="chevRight" />
                  </button>
                  <button type="button" class="btn lg" disabled={busy} onClick={() => setRead(null)}>
                    Choose another file
                  </button>
                </div>
              </>
            ) : (
              <KitPicker label="Choose the count kit…" primary onRead={(r) => setRead(r)} />
            )}
            <div>
              <button
                type="button"
                class="btn lg"
                disabled={busy}
                onClick={() => {
                  setRead(null);
                  setStep('choose');
                }}
              >
                <Icon name="chevLeft" />
                Back
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
