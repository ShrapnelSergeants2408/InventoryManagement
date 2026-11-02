// More › Areas & spots (F11): areas in walk order with their letters, each with its spots.
// Add, rename, reorder (▲/▼) and remove; removing an area asks where its spots go. A spot can
// move to another area (sorting the H1 "Unsorted" spots). Bins with no spot are listed last.
import { useState } from 'preact/hooks';
import type { InventorySnapshot } from '../../../data/inventory';
import { addArea, addSpot, moveArea, moveSpot, removeArea, updateArea } from '../../../data/places';
import { SUGGESTED_AREAS } from '../../../data/setup';
import { checkName } from '../../../domain/lists';
import { binLabel, defaultLetter } from '../../../domain/places';
import { nameKey, type Area, type Spot } from '../../../domain/types';
import { isAreaLetter } from '../../../domain/validate';
import { BackButton, StateMessage, TopBar, plural } from '../../components/common';
import { Dialog, DialogActions } from '../../components/Dialog';
import { useDb, useSnapshot } from '../../data-hooks';
import { Icon } from '../../icons';
import { href } from '../../shell/router';
import { showToast } from '../../shell/toast';
import { MoveSpot, RemoveSpot } from '../places/Spot';
import { StorageError } from '../StorageError';
import { EntryDialog } from './EntryDialog';

type Open =
  | { kind: 'area'; area: Area | null }
  | { kind: 'remove-area'; area: Area }
  | { kind: 'add-spot'; area: Area }
  | { kind: 'move-spot'; spot: Spot }
  | { kind: 'remove-spot'; spot: Spot }
  | null;

const fail = (e: unknown) => showToast(e instanceof Error ? e.message : String(e));

export function PlacesScreen() {
  const db = useDb();
  const live = useSnapshot();
  const [open, setOpen] = useState<Open>(null);
  const [reorder, setReorder] = useState(false);
  const back = <BackButton label="More" fallback={href.tab('more')} />;
  if (live.state === 'error') {
    return (
      <>
        <TopBar title="Areas & spots" back={back} />
        <StorageError error={live.error} />
      </>
    );
  }
  const snap = live.state === 'ready' ? live.value : null;
  const areas = snap ? [...snap.areas].sort((a, b) => a.order - b.order) : [];
  const spotsIn = (areaId: string) => (snap?.spots ?? []).filter((s) => s.areaId === areaId).sort((a, b) => a.order - b.order);
  const binsOn = (spotId: string) => (snap?.bins ?? []).filter((b) => b.spotId === spotId).length;
  const looseOn = (spotId: string) => (snap?.items ?? []).filter((i) => i.spotId === spotId).length;
  const noSpot = (snap?.bins ?? []).filter((b) => b.spotId === '').sort((a, b) => a.code.localeCompare(b.code, 'en-US', { numeric: true }));
  const unused = SUGGESTED_AREAS.filter((n) => !areas.some((a) => nameKey(a.name) === nameKey(n)));
  const quickAdd = async (name: string) => {
    try {
      const a = await addArea(db, { name });
      showToast(`Added ${a.name} (${a.letter}).`);
    } catch (e) {
      fail(e);
    }
  };

  return (
    <>
      <TopBar
        title="Areas & spots"
        subtitle={snap ? `${plural(areas.length, 'area')} · ${plural(snap.spots.length, 'spot')} · ${plural(snap.bins.length, 'bin')}` : 'Loading…'}
        back={back}
        actions={
          <button type="button" class="btn pri" disabled={!snap} onClick={() => setOpen({ kind: 'area', area: null })}>
            <Icon name="plus" />
            Add area
          </button>
        }
      >
        <button type="button" class={reorder ? 'btn on' : 'btn'} aria-pressed={reorder} disabled={areas.length === 0} onClick={() => setReorder(!reorder)}>
          <Icon name={reorder ? 'check' : 'reorder'} />
          {reorder ? 'Done' : 'Reorder'}
        </button>
      </TopBar>
      <div class="mlist">
        <p class="small muted lockline">
          The order is the <strong>walk order</strong>. An area’s letter starts the codes of bins made there (A-01, A-02…).
        </p>
        {!snap ? (
          <StateMessage icon="area" title="Loading…" />
        ) : (
          <>
            {areas.length === 0 && (
              <div class="empty-card">
                <strong>No areas yet.</strong> Add the rooms and zones where things are stored. Tap one to add it:
                <div class="chips-row">
                  {SUGGESTED_AREAS.map((n) => (
                    <button key={n} type="button" class="fchip" onClick={() => void quickAdd(n)}>
                      <Icon name="plus" />
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {areas.map((a, i) => {
              const spots = spotsIn(a.id);
              return (
                <section class="area-card" key={a.id}>
                  <div class="lrow area-row">
                    {reorder ? (
                      <span class="updown">
                        <button type="button" class="ib" aria-label={`Move ${a.name} up`} disabled={i === 0} onClick={() => void moveArea(db, a.id, -1).catch(fail)}>
                          <Icon name="chevUp" />
                        </button>
                        <button type="button" class="ib" aria-label={`Move ${a.name} down`} disabled={i === areas.length - 1} onClick={() => void moveArea(db, a.id, 1).catch(fail)}>
                          <Icon name="chevDown" />
                        </button>
                      </span>
                    ) : (
                      <span class="letter" aria-label={`Letter ${a.letter}`}>
                        {a.letter}
                      </span>
                    )}
                    <div class="grow">
                      <span class="ln">{a.name}</span> <span class="small muted">{spots.length ? plural(spots.length, 'spot') : 'No spots'}</span>
                      {a.notes && <div class="small muted">{a.notes}</div>}
                    </div>
                    {!reorder && (
                      <div class="acts">
                        <button type="button" class="btn sm" onClick={() => setOpen({ kind: 'add-spot', area: a })}>
                          <Icon name="plus" />
                          Spot
                        </button>
                        <button type="button" class="btn sm" onClick={() => setOpen({ kind: 'area', area: a })}>
                          Edit
                        </button>
                        <button type="button" class="btn sm danger" onClick={() => setOpen({ kind: 'remove-area', area: a })}>
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                  {spots.map((s, k) => (
                    <div class="lrow spot-row" key={s.id}>
                      {reorder ? (
                        <span class="updown">
                          <button type="button" class="ib" aria-label={`Move ${s.name} up`} disabled={k === 0} onClick={() => void moveSpot(db, s.id, -1).catch(fail)}>
                            <Icon name="chevUp" />
                          </button>
                          <button type="button" class="ib" aria-label={`Move ${s.name} down`} disabled={k === spots.length - 1} onClick={() => void moveSpot(db, s.id, 1).catch(fail)}>
                            <Icon name="chevDown" />
                          </button>
                        </span>
                      ) : (
                        <Icon name="pin" />
                      )}
                      <a class="grow spot-link" href={href.spot(s.id)}>
                        <span class="sname">{s.name}</span>{' '}
                        <span class="small muted">
                          {[binsOn(s.id) ? plural(binsOn(s.id), 'bin') : '', looseOn(s.id) ? plural(looseOn(s.id), 'loose item') : ''].filter(Boolean).join(' · ') || 'Empty'}
                        </span>
                      </a>
                      {!reorder && (
                        <div class="acts">
                          <button type="button" class="btn sm" disabled={areas.length < 2} onClick={() => setOpen({ kind: 'move-spot', spot: s })}>
                            Move…
                          </button>
                          <button type="button" class="btn sm danger" onClick={() => setOpen({ kind: 'remove-spot', spot: s })}>
                            Remove
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </section>
              );
            })}
            {areas.length > 0 && unused.length > 0 && (
              <div class="chips-row">
                <span class="small muted">Add another:</span>
                {unused.map((n) => (
                  <button key={n} type="button" class="fchip" onClick={() => void quickAdd(n)}>
                    <Icon name="plus" />
                    {n}
                  </button>
                ))}
              </div>
            )}
            {areas.length > 0 && (
              <section class="area-card">
                <div class="lrow none">
                  <span class="letter">—</span>
                  <div class="grow">
                    <span class="ln">Bins with no spot</span> <span class="small muted">{noSpot.length ? plural(noSpot.length, 'bin') : 'None'}</span>
                  </div>
                  <a class="btn sm" href={href.binAdd({ area: areas[0]!.id })}>
                    <Icon name="plus" />
                    Bin
                  </a>
                </div>
                {noSpot.map((b) => (
                  <a class="lrow spot-row" key={b.id} href={href.bin(b.id)}>
                    <Icon name="inventory" />
                    <span class="grow sname">{binLabel(b)}</span>
                    <Icon name="chevRight" />
                  </a>
                ))}
              </section>
            )}
          </>
        )}
      </div>

      {open?.kind === 'area' && snap && <AreaDialog area={open.area} areas={areas} onClose={() => setOpen(null)} />}
      {open?.kind === 'remove-area' && snap && <RemoveArea area={open.area} snap={snap} onClose={() => setOpen(null)} />}
      {open?.kind === 'add-spot' && snap && (
        <EntryDialog
          title={`Add a spot in ${open.area.name}`}
          what="Spot"
          existing={spotsIn(open.area.id).map((s) => s.name)}
          notes
          placeholder="e.g. Shelf B, Pegboard, Cabinet over washer"
          notesPlaceholder="e.g. behind the furnace"
          explain="New spots go to the end of the area’s walk order."
          submitLabel="Add spot"
          onClose={() => setOpen(null)}
          onSubmit={async (v) => {
            const s = await addSpot(db, open.area.id, { name: v.name, notes: v.notes });
            setOpen(null);
            showToast(`Added “${s.name}”.`);
          }}
        />
      )}
      {open?.kind === 'move-spot' && snap && <MoveSpot spot={open.spot} areas={snap.areas} onClose={() => setOpen(null)} />}
      {open?.kind === 'remove-spot' && snap && <RemoveSpot spot={open.spot} snap={snap} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Add or edit an area: name, letter (defaults to the first free one in the name) and notes. */
function AreaDialog({ area, areas, onClose }: { area: Area | null; areas: readonly Area[]; onClose: () => void }) {
  const db = useDb();
  const [name, setName] = useState(area?.name ?? '');
  const [letter, setLetter] = useState(area?.letter ?? '');
  const [notes, setNotes] = useState(area?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const others = areas.filter((a) => a.id !== area?.id);
  const check = checkName(name, others.map((a) => a.name), 'Area');
  const shownLetter = letter.trim().toUpperCase() || defaultLetter(name, others.map((a) => a.letter)) || '';
  const letterTaken = others.find((a) => a.letter === shownLetter);
  const letterBad = shownLetter !== '' && !isAreaLetter(shownLetter);
  const ok = check.ok && shownLetter !== '' && !letterTaken && !letterBad;
  const save = async (e: Event) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    try {
      if (area) await updateArea(db, area.id, { name, letter: shownLetter, notes });
      else await addArea(db, { name, letter: shownLetter, notes });
      showToast(area ? 'Saved.' : `Added ${name.trim()} (${shownLetter}).`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  return (
    <Dialog label={area ? `Edit ${area.name}` : 'Add an area'} onClose={() => !busy && onClose()}>
      <form class="dlg-form" onSubmit={(e) => void save(e)}>
        <h2 class="h2">{area ? `Edit “${area.name}”` : 'Add an area'}</h2>
        <div>
          <label class="lbl" for="ar-name">
            Name <span class="req">*</span>
          </label>
          <input id="ar-name" class={!check.ok && name.trim() ? 'field bad' : 'field'} value={name} placeholder="e.g. Attic, Garage, Utility room" autoComplete="off" onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} />
          {!check.ok && name.trim() !== '' && <div class="err">{check.error}</div>}
        </div>
        <div>
          <label class="lbl" for="ar-letter">
            Letter <span class="lbl-opt">(starts its bin codes)</span>
          </label>
          <input id="ar-letter" class={letterTaken || letterBad ? 'field bad mono' : 'field mono'} maxLength={1} value={letter} placeholder={shownLetter || 'A'} autoComplete="off" onInput={(e) => setLetter((e.currentTarget as HTMLInputElement).value)} />
          {letterTaken && <div class="err">{shownLetter} is already used by “{letterTaken.name}”.</div>}
          {letterBad && <div class="err">One letter A–Z.</div>}
          {area && nameKey(shownLetter) !== nameKey(area.letter) && <div class="small muted">Bins made here from now on get {shownLetter}-codes; existing bins keep their codes.</div>}
        </div>
        <div>
          <label class="lbl" for="ar-notes">
            Notes <span class="lbl-opt">(optional)</span>
          </label>
          <input id="ar-notes" class="field" value={notes} autoComplete="off" onInput={(e) => setNotes((e.currentTarget as HTMLInputElement).value)} />
        </div>
        {error && (
          <div class="err" role="alert">
            {error}
          </div>
        )}
        <DialogActions>
          <button type="button" class="btn lg" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" class="btn pri lg" disabled={!ok || busy}>
            {area ? 'Save' : 'Add area'}
          </button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

/** Remove an area (F11): one with spots asks which area they move to. */
function RemoveArea({ area, snap, onClose }: { area: Area; snap: InventorySnapshot; onClose: () => void }) {
  const db = useDb();
  const spots = snap.spots.filter((s) => s.areaId === area.id);
  const others = [...snap.areas].sort((a, b) => a.order - b.order).filter((a) => a.id !== area.id);
  const [to, setTo] = useState(others[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    try {
      const n = await removeArea(db, area.id, spots.length ? to : null);
      showToast(n ? `Removed “${area.name}”; ${plural(n, 'spot')} moved to ${others.find((a) => a.id === to)?.name}.` : `Removed “${area.name}”.`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  const blocked = spots.length > 0 && others.length === 0;
  return (
    <Dialog label="Remove area" role="alertdialog" onClose={() => !busy && onClose()}>
      <h2 class="h2">Remove “{area.name}”?</h2>
      {spots.length > 0 ? (
        blocked ? (
          <p class="dlg-big">It has {plural(spots.length, 'spot')} and there’s no other area to move them to. Add another area first, or remove its spots.</p>
        ) : (
          <>
            <p class="dlg-big">
              It has <strong>{plural(spots.length, 'spot')}</strong> ({spots.slice(0, 3).map((s) => s.name).join(', ')}
              {spots.length > 3 ? '…' : ''}). They move, with their bins and items, to:
            </p>
            <select class="field" aria-label="Move its spots to" value={to} onChange={(e) => setTo((e.currentTarget as HTMLSelectElement).value)}>
              {others.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.letter})
                </option>
              ))}
            </select>
          </>
        )
      ) : (
        <p class="dlg-big">It has no spots.</p>
      )}
      {error && (
        <div class="err" role="alert">
          {error}
        </div>
      )}
      <DialogActions>
        <button type="button" class="btn lg" data-autofocus disabled={busy} onClick={onClose}>
          Keep it
        </button>
        <button type="button" class="btn danger lg" disabled={busy || blocked} onClick={() => void go()}>
          <Icon name="trash" />
          {spots.length ? 'Move spots and remove' : 'Remove'}
        </button>
      </DialogActions>
    </Dialog>
  );
}
