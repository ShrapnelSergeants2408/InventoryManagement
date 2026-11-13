// Choosing a count kit file (§18.2 Joining): first launch › Join as a helper, and Send ›
// Open a new kit. The kit is read and checked here; nothing is saved until the caller says so.
import { useRef, useState } from 'preact/hooks';
import { checkFolderUrl } from '../../domain/folder-links';
import { plural } from '../components/common';
import { Dialog, DialogActions } from '../components/Dialog';
import { Scanner, type CameraState } from '../components/Scanner';
import { groupLabels } from '../../domain/helpers';
import { readCountKit, type ReadKit } from '../../io/count-kit';
import { Icon } from '../icons';

/** Where "Open Google Drive" goes when the helper doesn't know the team's Kits folder yet. */
const DRIVE_HOME = 'https://drive.google.com/';

// A ZIP-only filter keeps iOS from offering Photo Library and Take Photo (v0.24); a file that isn't a kit is still refused with a message.
const KIT_ACCEPT = '.zip,application/zip,application/x-zip-compressed';

export function KitPicker(props: {
  label: string;
  primary?: boolean;
  onRead: (read: ReadKit, fileName: string) => void;
  /** The team's Kits folder link when the device already has a kit (v0.23). */
  kitsFolderUrl?: string;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [refused, setRefused] = useState<{ name: string; newer: boolean; problems: string[] } | null>(null);

  const picked = async (f: File) => {
    setRefused(null);
    setBusy(f.name);
    try {
      const r = await readCountKit(new Uint8Array(await f.arrayBuffer()));
      if (r.ok) props.onRead(r.read, f.name);
      else setRefused({ name: f.name, newer: r.newer, problems: r.problems });
    } catch (e) {
      setRefused({ name: f.name, newer: false, problems: [`This file couldn’t be read: ${e instanceof Error ? e.message : String(e)}`] });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div class="kitpick">
      <button type="button" class={props.primary ? 'btn pri lg' : 'btn lg'} disabled={busy !== null} onClick={() => file.current?.click()}>
        <Icon name="upload" />
        {busy ? `Reading ${busy}…` : props.label}
      </button>
      <input
        ref={file}
        type="file"
        accept={KIT_ACCEPT}
        class="vh"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const f = (e.currentTarget as HTMLInputElement).files?.[0];
          (e.currentTarget as HTMLInputElement).value = '';
          if (f) void picked(f);
        }}
      />
      <div class="kitfind">
        <div class="small muted">
          The kit is in the team’s Google Drive. If the file list doesn’t show Google Drive (an iPhone often doesn’t), open the Kits folder in Drive, download your kit, then choose it here from Downloads.
        </div>
        <div class="kitfind-acts">
          <a class="btn lg" href={props.kitsFolderUrl || DRIVE_HOME} target="_blank" rel="noopener noreferrer">
            <Icon name="external" />
            {props.kitsFolderUrl ? 'Open the Kits folder' : 'Open Google Drive'}
          </a>
          <button type="button" class="btn lg" disabled={busy !== null} onClick={() => setScanning(true)}>
            <Icon name="scan" />
            Scan the Kits QR code
          </button>
        </div>
      </div>
      {scanning && <KitFolderScan onClose={() => setScanning(false)} />}
      {refused && (
        <div class="card sfile" role="alert">
          <strong class="mono">{refused.name}</strong>
          <ul class="small swarn">
            {refused.problems.slice(0, 8).map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          {refused.problems.length > 8 && <span class="small muted">and {plural(refused.problems.length - 8, 'more problem')}</span>}
          {refused.newer ? (
            <button type="button" class="btn pri lg" onClick={() => location.reload()}>
              <Icon name="retry" />
              Reload the app
            </button>
          ) : (
            <span class="small muted">Nothing was changed. Ask the shop tablet for a new count kit (Count › Helper devices › Send count kit).</span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Scan the Kits QR code on the shop tablet (Helper devices) and open the folder it points to in the
 * browser, so the kit can be downloaded from Google Drive (v0.23). Only an https link is opened.
 */
function KitFolderScan({ onClose }: { onClose: () => void }) {
  const [camera, setCamera] = useState<CameraState>('starting');
  const [url, setUrl] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const blocked = camera === 'denied' || camera === 'nocamera' || camera === 'error';

  const detect = (raw: string) => {
    const r = checkFolderUrl(raw, 'The code');
    if (!r.ok || r.url === '') {
      setNote('That code isn’t a web link. Scan the Kits code on the shop tablet (Count › Helper devices).');
      return;
    }
    setNote(null);
    setUrl(r.url);
  };

  return (
    <Dialog label="Scan the Kits QR code" onClose={onClose}>
      <div class="scan-dlg">
        <h2 class="h2">Scan the Kits QR code</h2>
        {url === null ? (
          <>
            {blocked ? (
              <p class="dlg-p" role="alert">
                {camera === 'denied' ? 'The camera is blocked for this app. Allow it in the browser’s site settings, or scan the code with the phone’s Camera app instead.' : 'The camera isn’t available. Scan the code with the phone’s Camera app instead.'}
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
            <p class="small muted m0">Hold the shop tablet’s <strong>Kits</strong> code in the square for a moment.</p>
            {note && (
              <p class="small err" role="alert">
                <Icon name="short" />
                {note}
              </p>
            )}
          </>
        ) : (
          <>
            <p class="dlg-p">Found the Kits folder:</p>
            <div class="mono kitfind-url">{url.replace(/^https:\/\//, '')}</div>
            <p class="small muted m0">Open it, download your kit (the one with your helper’s name), then come back and choose it from Downloads.</p>
          </>
        )}
      </div>
      <DialogActions>
        <button type="button" class="btn lg" data-autofocus={url === null} onClick={onClose}>
          {url === null ? 'Cancel' : 'Close'}
        </button>
        {url !== null && (
          <>
            <button type="button" class="btn lg" onClick={() => setUrl(null)}>
              Scan again
            </button>
            <a class="btn pri lg" data-autofocus href={url} target="_blank" rel="noopener noreferrer">
              <Icon name="external" />
              Open the Kits folder
            </a>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

/** What the kit holds, before joining. */
export function KitSummary({ read }: { read: ReadKit }) {
  const k = read.kit;
  return (
    <div class="card sfile">
      <strong>{k.helperName}</strong>
      <span>
        {k.kind === 'category' ? 'Categories' : 'Locations'}: {groupLabels(k).join(', ')}
      </span>
      <span class="small muted">
        {plural(read.data.items.length, 'item')} · {plural(read.data.photos.size, 'photo')} · {k.allowNewItems ? 'new items allowed' : 'no new items'}
      </span>
    </div>
  );
}
