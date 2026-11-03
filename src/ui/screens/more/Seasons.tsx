// More › Seasons and More › Tags (F11): add, rename, reorder (▲/▼) and remove. A season or tag
// in use asks to confirm, naming how many items and bins have it, and is cleared from them.
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { InventorySnapshot } from '../../../data/inventory';
import { addSeason, addTag, moveSeason, moveTag, nextSeasonColor, removeSeason, removeTag, renameTag, updateSeason } from '../../../data/lists';
import { checkName } from '../../../domain/lists';
import { SEASON_COLORS, nameKey, type Season, type SeasonColor } from '../../../domain/types';
import { tagProblem } from '../../../domain/validate';
import { BackButton, StateMessage, TopBar, plural } from '../../components/common';
import { Dialog, DialogActions } from '../../components/Dialog';
import { useDb, useSnapshot } from '../../data-hooks';
import { Icon } from '../../icons';
import { href } from '../../shell/router';
import { showToast } from '../../shell/toast';
import { StorageError } from '../StorageError';
import { EntryDialog } from './EntryDialog';

const fail = (e: unknown) => showToast(e instanceof Error ? e.message : String(e));

function ListFrame(props: { title: string; subtitle: string; addLabel: string; onAdd: () => void; reorder: boolean; setReorder: (on: boolean) => void; canReorder: boolean; children: ComponentChildren }) {
  return (
    <>
      <TopBar
        title={props.title}
        subtitle={props.subtitle}
        back={<BackButton label="More" fallback={href.tab('more')} />}
        actions={
          <button type="button" class="btn pri" onClick={props.onAdd}>
            <Icon name="plus" />
            {props.addLabel}
          </button>
        }
      >
        <button type="button" class={props.reorder ? 'btn on' : 'btn'} aria-pressed={props.reorder} disabled={!props.canReorder} onClick={() => props.setReorder(!props.reorder)}>
          <Icon name={props.reorder ? 'check' : 'reorder'} />
          {props.reorder ? 'Done' : 'Reorder'}
        </button>
      </TopBar>
      <div class="mlist">{props.children}</div>
    </>
  );
}

function UpDown(props: { name: string; first: boolean; last: boolean; move: (delta: number) => void }) {
  return (
    <span class="updown">
      <button type="button" class="ib" aria-label={`Move ${props.name} up`} disabled={props.first} onClick={() => props.move(-1)}>
        <Icon name="chevUp" />
      </button>
      <button type="button" class="ib" aria-label={`Move ${props.name} down`} disabled={props.last} onClick={() => props.move(1)}>
        <Icon name="chevDown" />
      </button>
    </span>
  );
}

/** Confirm removing a season or tag that's in use (§6). */
function ConfirmRemove(props: { what: string; name: string; items: number; bins: number; onClose: () => void; onRemove: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const used = [props.items ? plural(props.items, 'item') : '', props.bins ? plural(props.bins, 'bin') : ''].filter(Boolean).join(' and ');
  return (
    <Dialog label={`Remove ${props.what}`} role="alertdialog" onClose={() => !busy && props.onClose()}>
      <h2 class="h2">
        Remove the {props.what} “{props.name}”?
      </h2>
      <p class="dlg-big">{used ? `${used} ${props.items + props.bins === 1 ? 'has' : 'have'} it. It’s cleared from them; nothing else changes.` : 'Nothing has it.'}</p>
      <DialogActions>
        <button type="button" class="btn lg" data-autofocus disabled={busy} onClick={props.onClose}>
          Keep it
        </button>
        <button
          type="button"
          class="btn danger lg"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void props.onRemove().catch((e: unknown) => (fail(e), setBusy(false)));
          }}
        >
          <Icon name="trash" />
          Remove {props.what}
        </button>
      </DialogActions>
    </Dialog>
  );
}

const seasonUse = (snap: InventorySnapshot, id: string) => ({ items: snap.items.filter((i) => i.seasonId === id).length, bins: snap.bins.filter((b) => b.seasonId === id).length });

export function SeasonsScreen() {
  const db = useDb();
  const live = useSnapshot();
  const [open, setOpen] = useState<{ kind: 'edit'; season: Season | null } | { kind: 'remove'; season: Season } | null>(null);
  const [reorder, setReorder] = useState(false);
  if (live.state === 'error') return <StorageError error={live.error} />;
  const snap = live.state === 'ready' ? live.value : null;
  const list = snap?.seasons ?? [];
  return (
    <ListFrame title="Seasons" subtitle={snap ? plural(list.length, 'season') : 'Loading…'} addLabel="Add season" onAdd={() => setOpen({ kind: 'edit', season: null })} reorder={reorder} setReorder={setReorder} canReorder={list.length > 1}>
      <p class="small muted lockline">Each item and bin has at most one season. The order here is the order seasons are shown in.</p>
      {!snap ? (
        <StateMessage icon="season" title="Loading…" />
      ) : (
        <>
          {list.length === 0 && <div class="empty-card">No seasons yet. Add the holidays and times of year you store things for.</div>}
          {list.map((s, i) => {
            const use = seasonUse(snap, s.id);
            return (
              <div class="lrow" key={s.id}>
                {reorder ? <UpDown name={s.name} first={i === 0} last={i === list.length - 1} move={(d) => void moveSeason(db, s.id, d).catch(fail)} /> : <span class={`swatch c-${s.color}`} aria-hidden="true" />}
                <div class="grow">
                  <span class={`chip season c-${s.color}`}>{s.name}</span> <span class="small muted">{use.items + use.bins ? [use.items ? plural(use.items, 'item') : '', use.bins ? plural(use.bins, 'bin') : ''].filter(Boolean).join(' · ') : 'Not used yet'}</span>
                  {s.setupNotes && <div class="small muted">{s.setupNotes}</div>}
                </div>
                {!reorder && (
                  <div class="acts">
                    <button type="button" class="btn sm" onClick={() => setOpen({ kind: 'edit', season: s })}>
                      Edit
                    </button>
                    <button type="button" class="btn sm danger" onClick={() => setOpen({ kind: 'remove', season: s })}>
                      Remove
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
      {open?.kind === 'edit' && <SeasonDialog season={open.season} seasons={list} onClose={() => setOpen(null)} />}
      {open?.kind === 'remove' && snap && (
        <ConfirmRemove
          what="season"
          name={open.season.name}
          {...seasonUse(snap, open.season.id)}
          onClose={() => setOpen(null)}
          onRemove={async () => {
            await removeSeason(db, open.season.id);
            setOpen(null);
            showToast(`Removed “${open.season.name}”.`);
          }}
        />
      )}
    </ListFrame>
  );
}

function SeasonDialog({ season, seasons, onClose }: { season: Season | null; seasons: readonly Season[]; onClose: () => void }) {
  const db = useDb();
  const [name, setName] = useState(season?.name ?? '');
  const [color, setColor] = useState<SeasonColor>(season?.color ?? nextSeasonColor(seasons.map((s) => s.color)));
  const [notes, setNotes] = useState(season?.setupNotes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = checkName(name, seasons.map((s) => s.name), 'Season', season?.name);
  const save = async (e: Event) => {
    e.preventDefault();
    if (!check.ok || busy) return;
    setBusy(true);
    try {
      if (season) await updateSeason(db, season.id, { name, color, setupNotes: notes });
      else {
        const s = await addSeason(db, { name, color });
        if (notes.trim()) await updateSeason(db, s.id, { name: s.name, color, setupNotes: notes });
      }
      showToast(season ? 'Saved.' : `Added “${name.trim()}”.`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  return (
    <Dialog label={season ? `Edit ${season.name}` : 'Add a season'} onClose={() => !busy && onClose()}>
      <form class="dlg-form" onSubmit={(e) => void save(e)}>
        <h2 class="h2">{season ? `Edit “${season.name}”` : 'Add a season'}</h2>
        <div>
          <label class="lbl" for="se-name">
            Name <span class="req">*</span>
          </label>
          <input id="se-name" class={!check.ok && name.trim() ? 'field bad' : 'field'} value={name} placeholder="e.g. Easter" autoComplete="off" onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} />
          {!check.ok && name.trim() !== '' && <div class="err">{check.error}</div>}
        </div>
        <div>
          <span class="lbl">Color</span>
          <div class="swatches" role="radiogroup" aria-label="Color">
            {SEASON_COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} class={`swatch c-${c}${color === c ? ' on' : ''}`} onClick={() => setColor(c)} />
            ))}
          </div>
          <span class={`chip season c-${color}`}>{name.trim() || 'Preview'}</span>
        </div>
        <div>
          <label class="lbl" for="se-notes">
            Setup notes <span class="lbl-opt">(optional)</span>
          </label>
          <textarea id="se-notes" class="field" value={notes} placeholder="e.g. Mantel: garland left to right, stockings in age order" onInput={(e) => setNotes((e.currentTarget as HTMLTextAreaElement).value)} />
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
            {season ? 'Save' : 'Add season'}
          </button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

const tagUse = (snap: InventorySnapshot, name: string) => {
  const has = (tags: readonly string[]) => tags.some((t) => nameKey(t) === nameKey(name));
  return { items: snap.items.filter((i) => has(i.tags)).length, bins: snap.bins.filter((b) => has(b.tags)).length };
};

export function TagsScreen() {
  const db = useDb();
  const live = useSnapshot();
  const [open, setOpen] = useState<{ kind: 'add' } | { kind: 'rename'; name: string } | { kind: 'remove'; name: string } | null>(null);
  const [reorder, setReorder] = useState(false);
  if (live.state === 'error') return <StorageError error={live.error} />;
  const snap = live.state === 'ready' ? live.value : null;
  const list = snap?.tags ?? [];
  const names = list.map((t) => t.name);
  return (
    <ListFrame title="Tags" subtitle={snap ? plural(list.length, 'tag') : 'Loading…'} addLabel="Add tag" onAdd={() => setOpen({ kind: 'add' })} reorder={reorder} setReorder={setReorder} canReorder={list.length > 1}>
      <p class="small muted lockline">Free labels for items and bins (Fragile, Outdoor, Kids’ room…). A tag typed on an item or bin is added here too.</p>
      {!snap ? (
        <StateMessage icon="tag" title="Loading…" />
      ) : (
        <>
          {list.length === 0 && <div class="empty-card">No tags yet.</div>}
          {list.map((t, i) => {
            const use = tagUse(snap, t.name);
            return (
              <div class="lrow" key={t.name}>
                {reorder ? <UpDown name={t.name} first={i === 0} last={i === list.length - 1} move={(d) => void moveTag(db, t.name, d).catch(fail)} /> : <Icon name="tag" />}
                <div class="grow">
                  <span class="ln">{t.name}</span> <span class="small muted">{use.items + use.bins ? [use.items ? plural(use.items, 'item') : '', use.bins ? plural(use.bins, 'bin') : ''].filter(Boolean).join(' · ') : 'Not used yet'}</span>
                </div>
                {!reorder && (
                  <div class="acts">
                    <button type="button" class="btn sm" onClick={() => setOpen({ kind: 'rename', name: t.name })}>
                      Rename
                    </button>
                    <button type="button" class="btn sm danger" onClick={() => setOpen({ kind: 'remove', name: t.name })}>
                      Remove
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
      {(open?.kind === 'add' || open?.kind === 'rename') && (
        <EntryDialog
          title={open.kind === 'add' ? 'Add a tag' : `Rename “${open.name}”`}
          what="Tag"
          existing={names}
          self={open.kind === 'rename' ? open.name : undefined}
          initial={open.kind === 'rename' ? { name: open.name } : undefined}
          placeholder="e.g. Fragile"
          explain={open.kind === 'rename' ? 'Every item and bin with it follows the new name.' : 'A tag can’t contain “;”.'}
          submitLabel={open.kind === 'add' ? 'Add tag' : 'Save'}
          onClose={() => setOpen(null)}
          onSubmit={async (v) => {
            const p = tagProblem(v.name);
            if (p) throw new Error(p.charAt(0).toUpperCase() + p.slice(1) + '.');
            if (open.kind === 'add') await addTag(db, v.name);
            else await renameTag(db, open.name, v.name);
            setOpen(null);
            showToast(open.kind === 'add' ? `Added “${v.name}”.` : 'Saved.');
          }}
        />
      )}
      {open?.kind === 'remove' && snap && (
        <ConfirmRemove
          what="tag"
          name={open.name}
          {...tagUse(snap, open.name)}
          onClose={() => setOpen(null)}
          onRemove={async () => {
            await removeTag(db, open.name);
            setOpen(null);
            showToast(`Removed “${open.name}”.`);
          }}
        />
      )}
    </ListFrame>
  );
}
