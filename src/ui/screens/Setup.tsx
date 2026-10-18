// First-launch setup (§6, mockups 9f, 9g): set the mentor PIN (typed twice), then write down
// the recovery code. Both are saved together only after "I wrote it down", so closing the app
// part-way starts setup again. The starter-catalog step joins this flow in M10 (F22, Q2).
import { useState } from 'preact/hooks';
import logoUrl from '../../../assets/team-logo-512.png?url';
import { savePinAndRecovery } from '../../data/pin';
import { newRecoveryCode } from '../../security/pin';
import { NewPinPad } from '../components/PinPad';
import { useDb } from '../data-hooks';
import { Icon } from '../icons';
import { RecoveryCodeCard } from '../shell/PinFlows';

const STEPS = ['Set mentor PIN', 'Save recovery code'];

export function SetupScreen({ onDone }: { onDone: () => void }) {
  const db = useDb();
  const [pin, setPin] = useState<string | null>(null);
  const [code] = useState(newRecoveryCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const step = pin === null ? 0 : 1;

  const finish = async () => {
    if (pin === null) return;
    setBusy(true);
    try {
      await savePinAndRecovery(db, pin, code);
      onDone();
    } catch (e) {
      setBusy(false);
      setError(`Couldn’t save the PIN on this tablet: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div class="setup">
      <aside class="setup-side">
        <img class="setup-logo" src={logoUrl} alt="Shrapnel Sergeants, FRC Team 2408" />
        <h1 class="setup-title">FRC 2408 Inventory Management</h1>
        <p class="small">First-time setup · about 2 minutes · a mentor should do this</p>
        <ol class="setup-steps">
          {STEPS.map((s, i) => (
            <li key={s} class={i === step ? 'now' : i < step ? 'done' : undefined} aria-current={i === step ? 'step' : undefined}>
              <span class="sn">{i < step ? <Icon name="check" /> : i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </aside>
      <main class="setup-main">
        {step === 0 ? (
          <div class="setup-pin">
            <div class="setup-text">
              <h2 class="setup-h">Welcome! First, a mentor PIN.</h2>
              <p>
                Students can use almost everything without it. The PIN protects the few things that are hard to undo: deleting items, changing vendors and prices, managing
                suppliers, restoring backups and changing settings.
              </p>
              <p>Pick 4–6 digits. Once entered, it stays unlocked for 5 minutes.</p>
              <p class="small muted">This stops accidents, not a determined hacker. Don’t reuse a PIN that protects anything important.</p>
            </div>
            <div class="setup-card">
              <NewPinPad
                title="Set a mentor PIN"
                submitLabel="Next"
                onDone={setPin}
                footer={(back) =>
                  back && (
                    <button type="button" class="btn lg" onClick={back}>
                      Back
                    </button>
                  )
                }
              />
            </div>
          </div>
        ) : (
          <div class="setup-code">
            <RecoveryCodeCard code={code} next="Finish setup" busy={busy} onNext={() => void finish()} />
            {error && (
              <p class="pin-err" role="alert">
                {error}
              </p>
            )}
            <div>
              <button type="button" class="btn lg" disabled={busy} onClick={() => setPin(null)}>
                <Icon name="chevLeft" />
                Choose a different PIN
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
