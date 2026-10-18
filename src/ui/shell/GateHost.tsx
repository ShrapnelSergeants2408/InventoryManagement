// Answers gate(reason) (§6). TEMPORARY until the mentor PIN (M6): a stand-in that says why
// the PIN would be needed and asks for a confirmation instead. It never stays unlocked, so
// every PIN step asks again — the same places the real PIN pad will appear.
import { useEffect, useState } from 'preact/hooks';
import { setGateAsk } from '../../security/gate';
import { Dialog, DialogActions } from '../components/Dialog';
import { Icon } from '../icons';

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
  return (
    <Dialog label="Mentor PIN needed" onClose={() => answer(false)}>
      <div class="dlg-head">
        <span class="dlg-ic navy">
          <Icon name="lock" />
        </span>
        <h2 class="h2">Mentor PIN needed</h2>
      </div>
      <p class="dlg-big">{pending.reason}</p>
      <p class="note-box">
        The mentor PIN pad arrives in a later build (M6). Until then, this stand-in asks you to confirm instead of entering a PIN.
      </p>
      <DialogActions>
        <button type="button" class="btn lg" onClick={() => answer(false)}>
          Cancel
        </button>
        <button type="button" class="btn navy lg" data-autofocus onClick={() => answer(true)}>
          <Icon name="unlock" />
          Continue
        </button>
      </DialogActions>
    </Dialog>
  );
}
