// Pieces shared by first-launch setup, the PIN pad's "Forgot PIN?" and More › Forgot the PIN
// (§6, D6, mockup 9g): showing a recovery code once, and using one to set a new PIN.
import { useEffect, useRef, useState } from 'preact/hooks';
import { checkRecoveryCode, savePinAndRecovery, unlockForSetting, waitRemaining, type CheckResult } from '../../data/pin';
import { formatRemaining } from '../../security/lock';
import { formatRecoveryCode, newRecoveryCode } from '../../security/pin';
import { NewPinPad } from '../components/PinPad';
import { useDb } from '../data-hooks';
import { Icon } from '../icons';

/** Re-renders every second while a wait after wrong tries runs; returns the ms left. */
export function useWait(): [number, () => void] {
  const [, tick] = useState(0);
  const left = waitRemaining();
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => tick((n) => n + 1), Math.min(1000, left));
    return () => clearTimeout(t);
  });
  return [left, () => tick((n) => n + 1)];
}

export function wrongMessage(r: Exclude<CheckResult, { ok: true }>, what: string): string {
  if (r.waitMs > 0) return `Too many wrong tries. Wait ${formatRemaining(r.waitMs)}, then try again.`;
  return `Wrong ${what}. Try again — ${r.wrong} wrong ${r.wrong === 1 ? 'try' : 'tries'} so far.`;
}

/** The code, shown once, and "I wrote it down" before going on (mockup 9g). */
export function RecoveryCodeCard(props: { code: string; next: string; busy?: boolean; onNext: () => void; heading?: boolean }) {
  const [wrote, setWrote] = useState(false);
  return (
    <div class="recovery">
      {props.heading !== false && <h2 class="h2">Write down this recovery code</h2>}
      <p class="dlg-p">
        If the PIN is ever forgotten, this code lets a mentor set a new one. It is shown <strong>only this once</strong>. Keep it away from the tablet — the mentor binder or a
        password manager.
      </p>
      <div class="rcode" aria-label={`Recovery code ${props.code.split('').join(' ')}`}>
        {formatRecoveryCode(props.code)}
      </div>
      <label class="tick">
        <input type="checkbox" checked={wrote} onChange={(e) => setWrote((e.currentTarget as HTMLInputElement).checked)} />
        <span>I wrote it down somewhere safe</span>
      </label>
      <div>
        <button type="button" class="btn pri xl" disabled={!wrote || props.busy} onClick={props.onNext}>
          {props.next}
          <Icon name="chevRight" />
        </button>
      </div>
    </div>
  );
}

/**
 * Forgot PIN: the recovery code → a new PIN (typed twice) → a new recovery code. Nothing is
 * saved until the new code has been written down; then the new PIN and code replace the old
 * ones together, so the old code no longer works, and mentor tools unlock.
 */
export function RecoveryFlow({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const db = useDb();
  const [step, setStep] = useState<'code' | 'pin' | 'show'>('code');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState('');
  const [code] = useState(newRecoveryCode);
  const [wait, refresh] = useWait();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (step === 'code') input.current?.focus();
  }, [step]);

  const check = async () => {
    if (busy || !typed.trim()) return;
    setBusy(true);
    let r: Awaited<ReturnType<typeof checkRecoveryCode>>;
    try {
      r = await checkRecoveryCode(db, typed);
    } catch (e) {
      setError(`Couldn’t check the code: ${e instanceof Error ? e.message : String(e)}`);
      return;
    } finally {
      setBusy(false);
      refresh();
    }
    if (r.ok) {
      setError(null);
      setStep('pin');
    } else setError(wrongMessage({ ...r, waitMs: 0 }, 'recovery code'));
  };

  const finish = async () => {
    setBusy(true);
    try {
      await savePinAndRecovery(db, pin, code);
      await unlockForSetting(db);
      onDone();
    } catch (e) {
      setBusy(false);
      setError(`Couldn’t save the new PIN: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (step === 'pin') {
    return (
      <NewPinPad
        title="Set a new mentor PIN"
        submitLabel="Next"
        onDone={(p) => {
          setPin(p);
          setStep('show');
        }}
        footer={(back) => (
          <button type="button" class="btn lg" onClick={back ?? onCancel}>
            {back ? 'Back' : 'Cancel'}
          </button>
        )}
      />
    );
  }
  if (step === 'show') {
    return (
      <>
        <div class="dlg-head">
          <span class="dlg-ic navy">
            <Icon name="shield" />
          </span>
          <h2 class="h2 grow">New recovery code</h2>
        </div>
        <p class="dlg-p">The old recovery code stops working once you go on.</p>
        <RecoveryCodeCard code={code} next="Save the new PIN" busy={busy} onNext={() => void finish()} heading={false} />
        {error && (
          <p class="pin-err" role="alert">
            {error}
          </p>
        )}
        <div class="pin-foot">
          <button type="button" class="btn lg" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </>
    );
  }
  const waiting = wait > 0;
  return (
    <form
      class="dlg-form"
      onSubmit={(e) => {
        e.preventDefault();
        void check();
      }}
    >
      <div class="dlg-head">
        <span class="dlg-ic navy">
          <Icon name="help" />
        </span>
        <div class="grow">
          <h2 class="h2">Forgot the PIN?</h2>
          <div class="pin-sub">Type the recovery code from setup</div>
        </div>
      </div>
      <p class="dlg-p">It’s 10 letters and digits, written down when the PIN was set — check the mentor binder. Capitals, spaces and the dash don’t matter.</p>
      <input
        ref={input}
        class="field rinput"
        aria-label="Recovery code"
        value={typed}
        autocomplete="off"
        autocapitalize="characters"
        spellcheck={false}
        maxLength={16}
        disabled={waiting}
        onInput={(e) => setTyped((e.currentTarget as HTMLInputElement).value)}
      />
      <p class="pin-err" role="alert">
        {waiting ? `Too many wrong tries. Wait ${formatRemaining(wait)}, then try again.` : (error ?? '')}
      </p>
      <div class="dlg-actions">
        <button type="button" class="btn lg" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" class="btn pri lg" disabled={busy || waiting || !typed.trim()}>
          Check the code
        </button>
      </div>
    </form>
  );
}
