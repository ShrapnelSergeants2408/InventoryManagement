// Scan a manufacturer barcode into a form field (F7: "type it or scan it in"). Team QR labels
// are refused here: they identify items, they aren't barcodes.
import { useState } from 'preact/hooks';
import { QR_PREFIX, cleanCode } from '../../domain/scan';
import { Icon } from '../icons';
import { Dialog, DialogActions } from './Dialog';
import { Scanner, type CameraState } from './Scanner';

export function ScanDialog(props: { onCode: (code: string) => void; onClose: () => void }) {
  const [camera, setCamera] = useState<CameraState>('starting');
  const [note, setNote] = useState<string | null>(null);
  const detect = (raw: string) => {
    const code = cleanCode(raw);
    if (code.toLowerCase().startsWith(QR_PREFIX)) {
      setNote('That’s a team QR label, not a manufacturer barcode. Scan the barcode on the packaging.');
      return;
    }
    props.onCode(code);
  };
  return (
    <Dialog label="Scan a barcode" onClose={props.onClose}>
      <div class="scan-dlg">
        <h2 class="h2">Scan the barcode</h2>
        {camera === 'denied' || camera === 'nocamera' || camera === 'error' ? (
          <p class="dlg-p" role="alert">
            {camera === 'denied' ? 'The camera is blocked for this app. Allow it in Chrome’s Site settings › Camera, or type the barcode instead.' : 'The camera isn’t available. Type the barcode instead.'}
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
