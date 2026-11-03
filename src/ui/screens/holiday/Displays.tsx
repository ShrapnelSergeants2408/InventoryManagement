// Displays (SPEC v3.0 F22, F8): where Holiday decorations are put out. More › Displays adds,
// renames, reorders (the setup walk order) and removes them (confirming when in use). A display's
// screen shows its setup photos by season, the items that usually go there (with where they're
// stored), and the items on it now.
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { InventorySnapshot } from '../../../data/inventory';
import { addDisplay, moveDisplay, removeDisplay, updateDisplay } from '../../../data/holiday';
import { homeText } from '../../../domain/holiday';
import { checkName } from '../../../domain/lists';
import { partView } from '../../../domain/parts';
import { indexPlaces, itemSeasonId } from '../../../domain/places';
import { seasonCalendar } from '../../../domain/seasons';
import type { Display, Item } from '../../../domain/types';
import { BackButton, StateMessage, TopBar, plural } from '../../components/common';
import { Qty, StatusChip } from '../../components/chips';
import { Dialog, DialogActions } from '../../components/Dialog';
import { PhotoCarousel } from '../../components/PhotoCarousel';
import { useDb, useNow, usePartSnapshot, useSnapshot } from '../../data-hooks';
import { Icon } from '../../icons';
import { useRecordPart } from '../../part';
import { href } from '../../shell/router';
import { showToast } from '../../shell/toast';
import { Thumb } from '../inventory/ItemRow';
import { StorageError } from '../StorageError';
import { ListFrame, UpDown } from '../more/Seasons';

const fail = (e: unknown) => showToast(e instanceof Error ? e.message : String(e));

const use = (snap: Pick<InventorySnapshot, 'items'>, id: string) => ({
  usual: snap.items.filter((i) => i.displayId === id).length,
  on: snap.items.filter((i) => i.status === 'out' && i.outDisplayId === id).length,
});

export function DisplaysScreen() {
  const db = useDb();
  const { live, snap } = usePartSnapshot('holiday');
  const [open, setOpen] = useState<{ kind: 'edit'; display: Display | null } | { kind: 'remove'; display: Display } | null>(null);
  const [reorder, setReorder] = useState(false);
  useRecordPart('holiday');
  if (live.state === 'error') return <StorageError error={live.error} />;
  const list = snap?.displays ?? [];
  return (
    <ListFrame title="Displays" subtitle={snap ? `Holiday · ${plural(list.length, 'display')}` : 'Loading…'} addLabel="Add display" onAdd={() => setOpen({ kind: 'edit', display: null })} reorder={reorder} setReorder={setReorder} canReorder={list.length > 1}>
      <p class="small muted lockline">Where decorations go when they’re out: Mantel, Front porch, Dining table. The order is the setup walk-through. Nothing is stored on a display.</p>
      {!snap ? (
        <StateMessage icon="pin" title="Loading…" />
      ) : (
        <>
          {list.length === 0 && <div class="empty-card">No displays yet. Add the places you decorate.</div>}
          {list.map((d, i) => {
            const u = use(snap, d.id);
            return (
              <div class="lrow" key={d.id}>
                {reorder ? <UpDown name={d.name} first={i === 0} last={i === list.length - 1} move={(delta) => void moveDisplay(db, d.id, delta).catch(fail)} /> : <Icon name="pin" />}
                <a class="t" href={href.display(d.id)}>
                  <strong>{d.name}</strong>
                  <span>{u.usual || u.on ? [u.usual ? `${plural(u.usual, 'item')} usually` : '', u.on ? `${u.on} out now` : ''].filter(Boolean).join(' · ') : 'Nothing goes here yet'}</span>
                </a>
                {!reorder && (
                  <div class="acts">
                    <button type="button" class="btn sm" onClick={() => setOpen({ kind: 'edit', display: d })}>
                      Edit
                    </button>
                    <button type="button" class="btn sm danger" onClick={() => setOpen({ kind: 'remove', display: d })}>
                      Remove
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
      {open?.kind === 'edit' && <DisplayDialog display={open.display} displays={list} onClose={() => setOpen(null)} />}
      {open?.kind === 'remove' && snap && <RemoveDisplay display={open.display} snap={snap} onClose={() => setOpen(null)} />}
    </ListFrame>
  );
}

function RemoveDisplay({ display, snap, onClose }: { display: Display; snap: InventorySnapshot; onClose: () => void }) {
  const db = useDb();
  const [busy, setBusy] = useState(false);
  const u = use(snap, display.id);
  return (
    <Dialog label="Remove display" role="alertdialog" onClose={() => !busy && onClose()}>
      <h2 class="h2">Remove the display “{display.name}”?</h2>
      <p class="dlg-big">
        {u.usual || u.on
          ? `${[u.usual ? `${plural(u.usual, 'item')} usually go${u.usual === 1 ? 'es' : ''} there` : '', u.on ? `${plural(u.on, 'item')} ${u.on === 1 ? 'is' : 'are'} out on it` : ''].filter(Boolean).join(', and ')}. It’s cleared from them; items out there stay out. Its setup photos are deleted.`
          : 'Nothing goes there. Its setup photos are deleted.'}
      </p>
      <DialogActions>
        <button type="button" class="btn lg" data-autofocus disabled={busy} onClick={onClose}>
          Keep it
        </button>
        <button
          type="button"
          class="btn danger lg"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void removeDisplay(db, display.id).then(
              () => {
                showToast(`Removed “${display.name}”.`);
                onClose();
              },
              (e: unknown) => (fail(e), setBusy(false)),
            );
          }}
        >
          <Icon name="trash" />
          Remove display
        </button>
      </DialogActions>
    </Dialog>
  );
}

function DisplayDialog({ display, displays, onClose }: { display: Display | null; displays: readonly Display[]; onClose: () => void }) {
  const db = useDb();
  const [name, setName] = useState(display?.name ?? '');
  const [notes, setNotes] = useState(display?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = checkName(name, displays.map((d) => d.name), 'Display', display?.name);
  const save = async (e: Event) => {
    e.preventDefault();
    if (!check.ok || busy) return;
    setBusy(true);
    try {
      if (display) await updateDisplay(db, display.id, { name, notes });
      else await addDisplay(db, { name, notes });
      showToast(display ? 'Saved.' : `Added “${name.trim()}”.`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  return (
    <Dialog label={display ? `Edit ${display.name}` : 'Add a display'} onClose={() => !busy && onClose()}>
      <form class="dlg-form" onSubmit={(e) => void save(e)}>
        <h2 class="h2">{display ? `Edit “${display.name}”` : 'Add a display'}</h2>
        <div>
          <label class="lbl" for="dp-name">
            Name <span class="req">*</span>
          </label>
          <input id="dp-name" class={!check.ok && name.trim() ? 'field bad' : 'field'} value={name} placeholder="e.g. Mantel" autoComplete="off" onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} />
          {!check.ok && name.trim() !== '' && <div class="err">{check.error}</div>}
        </div>
        <div>
          <label class="lbl" for="dp-notes">
            Notes <span class="lbl-opt">(optional)</span>
          </label>
          <textarea id="dp-notes" class="field" value={notes} placeholder="e.g. Hooks under the shelf" onInput={(e) => setNotes((e.currentTarget as HTMLTextAreaElement).value)} />
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
          <button type="submit" class="btn pri lg" disabled={!check.ok || busy}>
            {display ? 'Save' : 'Add display'}
          </button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export function DisplayScreen({ id }: { id: string }) {
  const live = useSnapshot();
  const back = <BackButton fallback={href.list('displays')} />;
  useRecordPart('holiday');
  if (live.state === 'error') return <StorageError error={live.error} />;
  if (live.state === 'loading') return <TopBar title="Display" back={back} part="holiday" />;
  const display = live.value.displays.find((d) => d.id === id);
  if (!display)
    return (
      <>
        <TopBar title="Display not found" back={back} part="holiday" />
        <StateMessage icon="pin" title="This display isn’t on this phone">
          <p class="state-text">It may have been removed, or this phone was restored from an older backup.</p>
        </StateMessage>
      </>
    );
  return <DisplayDetail display={display} all={live.value} back={back} />;
}

function ItemList({ items, sub, empty }: { items: readonly Item[]; sub: (i: Item) => string; empty: string }) {
  if (items.length === 0) return <p class="muted m0">{empty}</p>;
  return (
    <div class="ilinks">
      {items.map((i) => (
        <a key={i.id} class="ilink" href={href.item(i.id)}>
          <Thumb itemId={i.id} hasPhoto={i.hasPhoto} />
          <span class="grow">
            <strong>{i.name}</strong> <Qty item={i} />
            <span class="small muted block">{sub(i)}</span>
            <span class="ilink-chips">
              <StatusChip item={i} />
            </span>
          </span>
          <Icon name="chevRight" />
        </a>
      ))}
    </div>
  );
}

function DisplayDetail({ display, all, back }: { display: Display; all: InventorySnapshot; back: ComponentChildren }) {
  const now = useNow(3_600_000);
  const snap = partView(all, 'holiday');
  const ix = indexPlaces(snap);
  const seasons = new Map(snap.seasons.map((s) => [s.id, s]));
  const cal = seasonCalendar(snap.seasons, new Date(now), 3, snap.seasonRuns);
  const [seasonId, setSeasonId] = useState(() => cal.lead?.season.id ?? snap.seasons[0]?.id ?? '');
  const [editing, setEditing] = useState(false);
  const byName = (a: Item, b: Item) => a.name.localeCompare(b.name, 'en-US', { sensitivity: 'base' });
  const usual = snap.items.filter((i) => i.displayId === display.id).sort(byName);
  const on = snap.items.filter((i) => i.status === 'out' && i.outDisplayId === display.id).sort(byName);
  const season = seasons.get(seasonId);
  return (
    <>
      <TopBar title={display.name} kicker="Display" back={back} part="holiday" />
      <div class="hsbody">
        <div class="links">
          {display.notes && <p class="notes m0 grow">{display.notes}</p>}
          <button type="button" class="btn sm" onClick={() => setEditing(true)}>
            <Icon name="pencil" />
            Name and notes
          </button>
        </div>
        <section class="card" aria-label="Setup photos">
          <h2 class="h2">Setup photos</h2>
          {snap.seasons.length === 0 ? (
            <p class="muted m0">Add seasons first (More › Seasons).</p>
          ) : (
            <>
              <div class="seasonpick" role="group" aria-label="Season">
                {snap.seasons.map((s) => (
                  <button key={s.id} type="button" class={`chip season c-${s.color}`} aria-pressed={s.id === seasonId} onClick={() => setSeasonId(s.id)}>
                    {s.name}
                  </button>
                ))}
              </div>
              {season && <PhotoCarousel key={season.id} ownerType="display" ownerId={display.id} name={`${display.name}, ${season.name}`} setup={{ seasonId: season.id, seasonName: season.name }} />}
            </>
          )}
        </section>
        <section class="card" aria-label="On it now">
          <h2 class="h2">On it now · {on.length}</h2>
          <ItemList items={on} sub={(i) => `from ${homeText(i, ix)}`} empty="Nothing is out on it." />
        </section>
        <section class="card" aria-label="Usually goes here">
          <h2 class="h2">Usually goes here · {usual.length}</h2>
          <ItemList items={usual} sub={(i) => [seasons.get(itemSeasonId(i, ix))?.name, `stored in ${homeText(i, ix)}`].filter(Boolean).join(' · ')} empty="No item has it as its usual display. Choose it in an item’s editor." />
        </section>
      </div>
      {editing && <DisplayDialog display={display} displays={snap.displays} onClose={() => setEditing(false)} />}
    </>
  );
}
