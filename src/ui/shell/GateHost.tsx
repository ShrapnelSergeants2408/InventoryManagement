// Answers gate(reason) (§6, mockups 0b, 9b, 9c): the PIN pad says why the PIN is needed, and
// a right PIN unlocks mentor tools for the unlock length and carries on with the action.
// "Forgot PIN?" switches to the recovery code in the same dialog.
import { useEffect, useState } from 'preact/hooks';
import { tryPin } from '../../data/pin';
import { setGateAsk } from '../../security/gate';
import { Dialog } from '../components/Dialog';
import { PinPad } from '../components/PinPad';
import { useDb, useSettings } from '../data-hooks';
import { RecoveryFlow, useWait, wrongMessage } from './PinFlows';

interface Pending {
  reason: string;
  resolve: (ok: boolean) => void;
}

export function GateHost() {
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    setGateAsk(
      (reason) =>
        new Promise<boolean>((resolve) => {
          setPending((prev) => {
            prev?.resolve(false);
            return { reason, resolve };
          });
        }),
    );
    return () => setGateAsk(null);
  }, []);

  if (!pending) return null;
  const answer = (ok: boolean) => {
    pending.resolve(ok);
    setPending(null);
  };
  return <PinDialog key={pending.reason} reason={pending.reason} answer={answer} />;
}

function PinDialog({ reason, answer }: { reason: string; answer: (ok: boolean) => void }) {
  const db = useDb();
  const { unlockMinutes } = useSettings();
  const [mode, setMode] = useState<'pin' | 'recover'>('pin');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clearKey, setClearKey] = useState(0);
  const [wait, refresh] = useWait();

  const submit = async (pin: string) => {
    setBusy(true);
    const r = await tryPin(db, pin);
    setBusy(false);
    refresh();
    if (r.ok) answer(true);
    else {
      setClearKey((k) => k + 1);
      setError(wrongMessage({ ...r, waitMs: 0 }, 'PIN'));
    }
  };

  return (
    <Dialog label="Mentor PIN" onClose={() => !busy && answer(false)}>
      {mode === 'recover' ? (
        <RecoveryFlow onDone={() => answer(true)} onCancel={() => answer(false)} />
      ) : (
        <PinPad
          title="Mentor PIN"
          sub={reason}
          submitLabel={`Unlock for ${unlockMinutes} minute${unlockMinutes === 1 ? '' : 's'}`}
          error={wait > 0 ? wrongMessage({ ok: false, wrong: 0, waitMs: wait }, 'PIN') : error}
          disabled={busy || wait > 0}
          clearKey={clearKey}
          onSubmit={(pin) => void submit(pin)}
          footer={
            <>
              <button type="button" class="btn lg" disabled={busy} onClick={() => answer(false)}>
                Cancel
              </button>
              <button type="button" class="linkbtn" onClick={() => setMode('recover')}>
                Forgot PIN?
              </button>
            </>
          }
        />
      )}
    </Dialog>
  );
}
