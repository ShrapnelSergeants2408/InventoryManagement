// More › Change PIN (after the PIN) and Forgot the PIN? (recovery code), mockup 9d.
import { useState } from 'preact/hooks';
import { savePin } from '../../../data/pin';
import { Dialog } from '../../components/Dialog';
import { NewPinPad } from '../../components/PinPad';
import { useDb } from '../../data-hooks';
import { RecoveryFlow } from '../../shell/PinFlows';
import { showToast } from '../../shell/toast';

export function ChangePinDialog({ onClose }: { onClose: () => void }) {
  const db = useDb();
  const [busy, setBusy] = useState(false);
  const done = async (pin: string) => {
    setBusy(true);
    try {
      await savePin(db, pin);
      showToast('PIN changed. The recovery code stays the same.');
      onClose();
    } catch (e) {
      setBusy(false);
      showToast(`Couldn’t change the PIN: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  return (
    <Dialog label="Change PIN" onClose={() => !busy && onClose()}>
      <NewPinPad
        title="Change PIN"
        submitLabel="Save the new PIN"
        disabled={busy}
        onDone={(pin) => void done(pin)}
        footer={(back) => (
          <button type="button" class="btn lg" disabled={busy} onClick={back ?? onClose}>
            {back ? 'Back' : 'Cancel'}
          </button>
        )}
      />
    </Dialog>
  );
}

export function ForgotPinDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog label="Forgot the PIN?" onClose={onClose}>
      <RecoveryFlow
        onDone={() => {
          showToast('New PIN saved. Mentor tools are unlocked.');
          onClose();
        }}
        onCancel={onClose}
      />
    </Dialog>
  );
}
