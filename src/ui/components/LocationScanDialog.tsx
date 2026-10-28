// Scan a bin's QR code to pick a location (F29). The code's text is the location name
// ("Electrical 15"). An unknown name shows "Location not found" and, where it makes sense,
// offers to add it (anyone) or rename an existing location to it (PIN, as F25).
import { useState } from 'preact/hooks';
import { addLocation, updateLocation } from '../../data/lists';
import { couldBeLocation, findLocation, locationText, QR_PREFIX } from '../../domain/scan';
import type { Location } from '../../domain/types';
import { gate } from '../../security/gate';
import { useDb } from '../data-hooks';
import { useHelper } from '../helper/session';
import { Icon } from '../icons';
import { useCloseOnRelock } from '../shell/LockPill';
import { showToast } from '../shell/toast';
import { PinMark } from './common';
import { Dialog, DialogActions } from './Dialog';
import { Scanner, type CameraState } from './Scanner';

export type PickedHow = 'found' | 'added' | 'renamed';

type Phase = { kind: 'scan' } | { kind: 'missing'; text: string; offer: boolean } | { kind: 'rename'; text: string };

export function LocationScanDialog(props: {
  locations: readonly Location[];
  /** 'offer': Add and Rename for an unknown name; 'report': only say it wasn't found. */
  notFound: 'offer' | 'report';
  title?: string;
  onPicked: (location: Location, how: PickedHow) => void;
  onClose: () => void;
}) {
  const db = useDb();
  // A helper has no PIN and can't rename locations (§18.3); adding one is allowed.
  const canRename = useHelper() === null;
  const [phase, setPhase] = useState<Phase>({ kind: 'scan' });
  const [camera, setCamera] = useState<CameraState>('starting');
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The rename step was opened behind the PIN: it closes when mentor tools relock.
  useCloseOnRelock(phase.kind === 'rename', () => phase.kind === 'rename' && setPhase({ kind: 'missing', text: phase.text, offer: true }));

  const find = (raw: string, format: string | null) => {
    const text = locationText(raw);
    if (text === '') return;
    const found = findLocation(text, props.locations);
    if (found) {
      props.onPicked(found, 'found');
      return;
    }
    if (text.toLowerCase().startsWith(QR_PREFIX)) {
      setNote('That’s a team item label, not a location. Scan the code on the bin or shelf.');
      return;
    }
    setNote(null);
    setError(null);
    setPhase({ kind: 'missing', text, offer: props.notFound === 'offer' && couldBeLocation(text, format) });
  };

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  const add = (text: string) =>
    run(async () => {
      const l = await addLocation(db, text);
      showToast(`Added location “${l.name}”.`);
      props.onPicked(l, 'added');
    });
  const startRename = async (text: string) => {
    if (await gate('Renaming a location needs the mentor PIN.')) setPhase({ kind: 'rename', text });
  };

  const blocked = camera === 'denied' || camera === 'nocamera' || camera === 'error';
  return (
    <Dialog label={props.title ?? 'Scan a location'} onClose={() => !busy && props.onClose()}>
      <div class="scan-dlg loc">
        {phase.kind === 'scan' && (
          <>
            <h2 class="h2">{props.title ?? 'Scan a location'}</h2>
            {blocked ? (
              <p class="dlg-p" role="alert">
                {camera === 'denied' ? 'The camera is blocked for this app. Allow it in Chrome’s Site settings › Camera, or type the location instead.' : 'The camera isn’t available. Type the location instead.'}
              </p>
            ) : (
              <Scanner paused={false} onDetect={find} onState={setCamera}>
                <div class="reticle" aria-hidden="true">
                  <span class="a" />
                  <span class="b" />
                  <span class="c" />
                  <span class="d" />
                  <span class="line" />
                </div>
              </Scanner>
            )}
            <p class="small muted m0">Hold the bin or shelf’s QR code in the square for a moment. Its text is the location’s name, e.g. Electrical 15.</p>
            {note && (
              <p class="small err" role="alert">
                <Icon name="short" />
                {note}
              </p>
            )}
            <form
              class="inline-add"
              onSubmit={(e) => {
                e.preventDefault();
                find(typed, null);
              }}
            >
              <input class="field" aria-label="Type the location" autoComplete="off" placeholder="Or type it — e.g. Tools 7" value={typed} onInput={(e) => setTyped((e.currentTarget as HTMLInputElement).value)} />
              <button type="submit" class="btn" disabled={typed.trim() === ''}>
                Find
              </button>
            </form>
          </>
        )}
        {phase.kind === 'missing' && (
          <>
            <div class="dlg-head">
              <span class="dlg-ic gray">
                <Icon name="pin" />
              </span>
              <h2 class="h2">Location not found</h2>
            </div>
            <div class="code-big loc-text">{phase.text}</div>
            <p class="dlg-p">
              {phase.offer
                ? canRename
                  ? 'No location has this name yet. Add it, or rename an existing location to match the code on the bin.'
                  : 'No location has this name yet. Add it as a new location; the shop tablet sees it when your counts arrive.'
                : props.notFound === 'offer'
                  ? 'This doesn’t look like a location name. Scan the QR code on the bin or shelf.'
                  : 'No location has this name. Add it in More › Locations first.'}
            </p>
          </>
        )}
        {phase.kind === 'rename' && (
          <RenameTo
            text={phase.text}
            locations={props.locations}
            busy={busy}
            onRename={(from) =>
              run(async () => {
                await updateLocation(db, from.name, phase.text, from.notes);
                showToast(`Renamed “${from.name}” to “${phase.text}”.`);
                props.onPicked({ ...from, name: phase.text }, 'renamed');
              })
            }
            onBack={() => setPhase({ kind: 'missing', text: phase.text, offer: true })}
          />
        )}
        {error && (
          <div class="err" role="alert">
            {error}
          </div>
        )}
      </div>
      {phase.kind === 'scan' && (
        <DialogActions>
          <button type="button" class="btn lg" data-autofocus onClick={props.onClose}>
            Cancel
          </button>
        </DialogActions>
      )}
      {phase.kind === 'missing' && (
        <DialogActions>
          <button type="button" class="btn lg" disabled={busy} onClick={() => setPhase({ kind: 'scan' })}>
            Scan again
          </button>
          {phase.offer && canRename && props.locations.length > 0 && (
            <button type="button" class="btn lg" disabled={busy} onClick={() => void startRename(phase.text)}>
              Rename a location to “{phase.text}”…
              <PinMark />
            </button>
          )}
          {phase.offer && (
            <button type="button" class="btn pri lg" data-autofocus disabled={busy} onClick={() => void add(phase.text)}>
              <Icon name="plus" />
              Add “{phase.text}” as a location
            </button>
          )}
        </DialogActions>
      )}
    </Dialog>
  );
}

/** Rename an existing location to the scanned name (F29, PIN already given). */
function RenameTo(props: { text: string; locations: readonly Location[]; busy: boolean; onRename: (from: Location) => void; onBack: () => void }) {
  const [from, setFrom] = useState(props.locations[0]?.name ?? '');
  const chosen = props.locations.find((l) => l.name === from) ?? null;
  return (
    <>
      <h2 class="h2">Rename a location to “{props.text}”</h2>
      <p class="dlg-p">Items in that location follow the new name.</p>
      <div>
        <label class="lbl" for="ren-from">
          Location to rename
        </label>
        <select id="ren-from" class="field" value={from} onChange={(e) => setFrom((e.currentTarget as HTMLSelectElement).value)}>
          {props.locations.map((l) => (
            <option key={l.name} value={l.name}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <DialogActions>
        <button type="button" class="btn lg" disabled={props.busy} onClick={props.onBack}>
          Back
        </button>
        <button type="button" class="btn pri lg" disabled={!chosen || props.busy} onClick={() => chosen && props.onRename(chosen)}>
          Rename {chosen ? `“${chosen.name}”` : ''}
        </button>
      </DialogActions>
    </>
  );
}
