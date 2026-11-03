// Scan a manufacturer barcode into a form field (F7: "type it or scan it in"). Household QR labels
// are refused there: they identify records, they aren't barcodes. With `labels`, it scans a label
// instead (the setup list's Scan a bin, F25) and hands on whatever it reads.
import { useState } from 'preact/hooks';
import { QR_PREFIX, cleanCode } from '../../domain/scan';
import { Icon } from '../icons';
import { Dialog, DialogActions } from './Dialog';
import { Scanner, type CameraState } from './Scanner';

export function ScanDialog(props: { onCode: (code: string) => void; onClose: () => void; labels?: boolean; title?: string }) {
  const [camera, setCamera] = useState<CameraState>('starting');
  const [note, setNote] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const detect = (raw: string) => {
    const code = cleanCode(raw);
    if (!props.labels && code.toLowerCase().startsWith(QR_PREFIX)) {
      setNote('That’s a team QR label, not a manufacturer barcode. Scan the barcode on the packaging.');
      return;
    }
    props.onCode(code);
  };
  return (
    <Dialog label={props.title ?? 'Scan a barcode'} onClose={props.onClose}>
      <div class="scan-dlg">
        <h2 class="h2">{props.title ?? 'Scan the barcode'}</h2>
        {camera === 'denied' || camera === 'nocamera' || camera === 'error' ? (
          <p class="dlg-p" role="alert">
            {camera === 'denied' ? `The camera is blocked for this app. Allow it in Settings › Safari › Camera, or type the ${props.labels ? 'code' : 'barcode'} instead.` : `The camera isn’t available. Type the ${props.labels ? 'code' : 'barcode'} instead.`}
          </p>
        ) : (
          <Scanner paused={false} onDetect={detect} onState={setCamera}>
            <div class="reticle" aria-hidden="true">
              <span class="a" />
              <span class="b" />
              <span class="c" />
              <span class="d" />
              <span class="line" />
            </div>
          </Scanner>
        )}
        {props.labels && (
          <form
            class="inline-add"
            onSubmit={(e) => {
              e.preventDefault();
              if (typed.trim()) props.onCode(cleanCode(typed));
            }}
          >
            <input class="field mono" aria-label="Type a bin code" value={typed} placeholder="Or type a code, e.g. storage4" autoComplete="off" onInput={(e) => setTyped((e.currentTarget as HTMLInputElement).value)} />
            <button type="submit" class="btn" disabled={typed.trim() === ''}>
              Go
            </button>
          </form>
        )}
        {note && (
          <p class="small err" role="alert">
            <Icon name="short" />
            {note}
          </p>
        )}
      </div>
      <DialogActions>
        <button type="button" class="btn lg" data-autofocus onClick={props.onClose}>
          Cancel
        </button>
      </DialogActions>
    </Dialog>
  );
}
