// Locations (F25, mockups 7i–7j). Anyone can add and reorder (the order is the walk order
// for count-in and labels by location); rename and remove need the mentor PIN.
import { useState } from 'preact/hooks';
import { addLocation, moveLocation, removeLocation, updateLocation } from '../../../data/lists';
import { locationUsage, takenLocationNames } from '../../../domain/lists';
import { nameKey, type Location } from '../../../domain/types';
import { gate } from '../../../security/gate';
import { BackButton, PinMark, StateMessage, TopBar, plural } from '../../components/common';
import { Dialog, DialogActions } from '../../components/Dialog';
import { useDb, useSnapshot } from '../../data-hooks';
import { Icon } from '../../icons';
import { useCloseOnRelock } from '../../shell/LockPill';
import { href } from '../../shell/router';
import { showToast } from '../../shell/toast';
import { StorageError } from '../StorageError';
import { EntryDialog } from './EntryDialog';

type Open = { kind: 'add' } | { kind: 'edit'; l: Location } | { kind: 'remove'; l: Location } | null;

const fail = (e: unknown) => showToast(e instanceof Error ? e.message : String(e));

/** "1 item: 10-32 x 3/4 in. …" or "3 items: A, B and 1 more" (mockups 7g, 7j). */
export function heldText(names: readonly string[]): string {
  const shown = names.slice(0, 2).join(', ');
  return names.length > 2 ? `${shown} and ${names.length - 2} more` : shown;
}

export function LocationsScreen() {
  const db = useDb();
  const live = useSnapshot();
  const [open, setOpen] = useState<Open>(null);
  // Dialogs opened behind the PIN close when mentor tools relock.
  useCloseOnRelock(open?.kind === 'edit' || open?.kind === 'remove', () => setOpen(null));
  const [reorder, setReorder] = useState(false);
  const back = <BackButton label="More" fallback={href.tab('more')} />;

  if (live.state === 'error') {
    return (
      <>
        <TopBar title="Locations" back={back} />
        <StorageError error={live.error} />
      </>
    );
  }
  const snap = live.state === 'ready' ? live.value : null;
  const usage = snap ? locationUsage(snap.items) : new Map();
  const list = snap?.locations ?? [];
  const names = list.map((l) => l.name);
  const unplaced = usage.get('')?.length ?? 0;
  const placed = (snap?.items.length ?? 0) - unplaced;

  const withPin = async (reason: string, next: Open) => {
    if (await gate(reason)) setOpen(next);
  };

  return (
    <>
      <TopBar
        title="Locations"
        subtitle={snap ? `${plural(list.length, 'location')} · ${plural(placed, 'item')} placed · ${unplaced} with no location` : 'Loading…'}
        back={back}
        actions={
          <>
            <button type="button" class={reorder ? 'btn on' : 'btn'} aria-pressed={reorder} disabled={list.length < 2} onClick={() => setReorder(!reorder)}>
              <Icon name={reorder ? 'check' : 'reorder'} />
              {reorder ? 'Done' : 'Reorder'}
            </button>
            <button type="button" class="btn pri" disabled={!snap} onClick={() => setOpen({ kind: 'add' })}>
              <Icon name="plus" />
              Add location
            </button>
          </>
        }
      />
      <div class="mlist">
        <p class="small muted lockline">
          The list order is the <strong>walk order</strong> for count-in by location and labels by location. Anyone can add or reorder.{' '}
          <Icon name="lock" />
          Rename and remove need the mentor PIN.
        </p>
        {!snap ? (
          <StateMessage icon="pin" title="Loading locations…" />
        ) : (
          <>
            {list.length === 0 && (
              <div class="empty-card">
                <strong>No locations yet.</strong> Add the bins, totes and shelves where parts live, in the order you walk past them. Items can also stay without a location.
              </div>
            )}
            {list.map((l, i) => {
              const held: { name: string }[] = usage.get(nameKey(l.name)) ?? [];
              return (
                <div class="lrow" key={l.name}>
                  {reorder ? (
                    <span class="updown">
                      <button type="button" class="ib" aria-label={`Move ${l.name} up`} disabled={i === 0} onClick={() => void moveLocation(db, l.name, -1).catch(fail)}>
                        <Icon name="chevUp" />
                      </button>
                      <button type="button" class="ib" aria-label={`Move ${l.name} down`} disabled={i === list.length - 1} onClick={() => void moveLocation(db, l.name, 1).catch(fail)}>
                        <Icon name="chevDown" />
                      </button>
                    </span>
                  ) : (
                    <span class="ord">{i + 1}</span>
                  )}
                  <div class="grow">
                    <span class="ln">{l.name}</span> <span class="small muted">{held.length ? plural(held.length, 'item') : 'No items'}</span>
                    {l.notes && <div class="small muted">{l.notes}</div>}
                  </div>
                  {!reorder && (
                    <div class="acts">
                      <button type="button" class="btn sm" onClick={() => void withPin('Renaming a location needs the mentor PIN.', { kind: 'edit', l })}>
                        Rename
                        <PinMark />
                      </button>
                      <button type="button" class="btn sm danger" onClick={() => void withPin('Removing a location needs the mentor PIN.', { kind: 'remove', l })}>
                        Remove
                        <PinMark />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            <div class="lrow none">
              <span class="ord">—</span>
              <div class="grow">
                <span class="ln">No location</span> <span class="small muted">{unplaced ? plural(unplaced, 'item') : 'No items'}</span>
              </div>
              <span class="small muted">Always last; can’t be removed</span>
            </div>
          </>
        )}
      </div>

      {open?.kind === 'add' && (
        <EntryDialog
          title="Add a location"
          what="Location"
          existing={takenLocationNames(names)}
          notes
          placeholder="e.g. Bin F17, Shelf C2, Pit cart"
          notesPlaceholder="e.g. blue tote under the workbench"
          explain="New locations go to the end of the walk order. Use Reorder to move them."
          submitLabel="Add location"
          onClose={() => setOpen(null)}
          onSubmit={async (v) => {
            const l = await addLocation(db, v.name, v.notes);
            setOpen(null);
            showToast(`Added “${l.name}”.`);
          }}
        />
      )}
      {open?.kind === 'edit' && (
        <EntryDialog
          title={`Rename “${open.l.name}”`}
          what="Location"
          existing={takenLocationNames(names)}
          self={open.l.name}
          initial={open.l}
          notes
          explain={`Updates ${plural(usage.get(nameKey(open.l.name))?.length ?? 0, 'item')} that use it.`}
          submitLabel="Save"
          onClose={() => setOpen(null)}
          onSubmit={async (v) => {
            await updateLocation(db, open.l.name, v.name, v.notes);
            setOpen(null);
            showToast('Saved.');
          }}
        />
      )}
      {open?.kind === 'remove' && (
        <RemoveLocation
          l={open.l}
          held={(usage.get(nameKey(open.l.name)) ?? []).map((i: { name: string }) => i.name)}
          others={names.filter((n) => n !== open.l.name)}
          onClose={() => setOpen(null)}
          onRemove={async (to) => {
            const moved = await removeLocation(db, open.l.name, to);
            setOpen(null);
            showToast(moved ? `Removed “${open.l.name}”; ${plural(moved, 'item')} moved to ${to || 'No location'}.` : `Removed “${open.l.name}”.`);
          }}
        />
      )}
    </>
  );
}

function RemoveLocation(props: { l: Location; held: string[]; others: string[]; onClose: () => void; onRemove: (to: string) => Promise<void> }) {
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = props.held.length;
  const go = async () => {
    setBusy(true);
    try {
      await props.onRemove(to);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <Dialog label="Remove location" role="alertdialog" onClose={() => !busy && props.onClose()}>
      <h2 class="h2">Remove “{props.l.name}”?</h2>
      {n > 0 ? (
        <>
          <p class="dlg-big">
            It holds <strong>{plural(n, 'item')}</strong>: {heldText(props.held)}. Choose where {n === 1 ? 'it goes' : 'they go'} first.
          </p>
          <div>
            <label class="lbl" for="mv">
              Move to
            </label>
            <select id="mv" class="field" value={to} onChange={(e) => setTo((e.currentTarget as HTMLSelectElement).value)}>
              <option value="">No location</option>
              {props.others.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
        </>
      ) : (
        <p class="dlg-big">No items use it.</p>
      )}
      {error && (
        <div class="err" role="alert">
          {error}
        </div>
      )}
      <DialogActions>
        <button type="button" class="btn lg" disabled={busy} onClick={props.onClose}>
          Keep it
        </button>
        <button type="button" class="btn danger lg" disabled={busy} onClick={() => void go()}>
          <Icon name="trash" />
          {n > 0 ? `Move to ${to || 'No location'} and remove` : 'Remove'}
        </button>
      </DialogActions>
    </Dialog>
  );
}
