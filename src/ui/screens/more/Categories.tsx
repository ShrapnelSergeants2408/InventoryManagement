// Categories (F9, mockups 7f–7g). Anyone can add and reorder; rename and remove need the
// mentor PIN, and a category or subcategory that still holds items must have them moved first.
import { useState } from 'preact/hooks';
import {
  addCategory,
  addSubcategory,
  moveCategory,
  moveSubcategory,
  removeCategory,
  removeSubcategory,
  renameCategory,
  renameSubcategory,
} from '../../../data/lists';
import { itemsIn, moveTargets, placeLabel, type CategoryPlace } from '../../../domain/lists';
import type { Category, Item } from '../../../domain/types';
import { gate } from '../../../security/gate';
import { BackButton, PinMark, StateMessage, TopBar, plural } from '../../components/common';
import { Dialog, DialogActions } from '../../components/Dialog';
import { useDb, useSnapshot } from '../../data-hooks';
import { Icon } from '../../icons';
import { href } from '../../shell/router';
import { showToast } from '../../shell/toast';
import { StorageError } from '../StorageError';
import { EntryDialog } from './EntryDialog';
import { heldText } from './Locations';

/** A category, or one subcategory in it. */
type Target = { category: string; subcategory?: string };

type Open =
  | { kind: 'addCategory' }
  | { kind: 'addSub'; category: string }
  | { kind: 'rename'; t: Target }
  | { kind: 'remove'; t: Target }
  | null;

const fail = (e: unknown) => showToast(e instanceof Error ? e.message : String(e));
const label = (t: Target) => (t.subcategory === undefined ? t.category : `${t.category} › ${t.subcategory}`);

export function CategoriesScreen() {
  const db = useDb();
  const live = useSnapshot();
  const [open, setOpen] = useState<Open>(null);
  const [reorder, setReorder] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const back = <BackButton label="More" fallback={href.tab('more')} />;

  if (live.state === 'error') {
    return (
      <>
        <TopBar title="Categories" back={back} />
        <StorageError error={live.error} />
      </>
    );
  }
  const snap = live.state === 'ready' ? live.value : null;
  const cats = snap?.categories ?? [];
  const items = snap?.items ?? [];
  const subCount = cats.reduce((n, c) => n + c.subcategories.length, 0);

  const toggle = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(name)) next.add(name);
      return next;
    });
  const withPin = async (reason: string, next: Open) => {
    if (await gate(reason)) setOpen(next);
  };

  return (
    <>
      <TopBar
        title="Categories"
        subtitle={snap ? `${plural(cats.length, 'category', 'categories')} · ${plural(subCount, 'subcategory', 'subcategories')} · ${plural(items.length, 'item')}` : 'Loading…'}
        back={back}
        actions={
          <>
            <button type="button" class={reorder ? 'btn on' : 'btn'} aria-pressed={reorder} disabled={!snap} onClick={() => setReorder(!reorder)}>
              <Icon name={reorder ? 'check' : 'reorder'} />
              {reorder ? 'Done' : 'Reorder'}
            </button>
            <button type="button" class="btn pri" disabled={!snap} onClick={() => setOpen({ kind: 'addCategory' })}>
              <Icon name="plus" />
              Add category
            </button>
          </>
        }
      />
      <div class="mlist">
        <p class="small muted lockline">
          Anyone can add or reorder.
          <Icon name="lock" />
          Rename and remove need the mentor PIN; a category must be empty (or its items moved) before it can be removed.
        </p>
        {!snap ? (
          <StateMessage icon="folder" title="Loading categories…" />
        ) : (
          cats.map((c, ci) => {
            const open = expanded.has(c.name);
            return (
              <div class="cgroup" key={c.name}>
                <div class="crow">
                  {reorder && (
                    <UpDown name={c.name} first={ci === 0} last={ci === cats.length - 1} onMove={(d) => void moveCategory(db, c.name, d).catch(fail)} />
                  )}
                  <button type="button" class="ib plain" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${c.name}`} onClick={() => toggle(c.name)}>
                    <Icon name={open ? 'chevDown' : 'chevRight'} />
                  </button>
                  <div class="grow">
                    <span class="cn">{c.name}</span>{' '}
                    <span class="small muted">
                      {plural(itemsIn(items, c.name).length, 'item')} · {plural(c.subcategories.length, 'subcategory', 'subcategories')}
                    </span>
                  </div>
                  {!reorder && (
                    <Actions
                      onRename={() => void withPin('Renaming a category needs the mentor PIN.', { kind: 'rename', t: { category: c.name } })}
                      onRemove={() => void withPin('Removing a category needs the mentor PIN.', { kind: 'remove', t: { category: c.name } })}
                    />
                  )}
                </div>
                {open && (
                  <>
                    {c.subcategories.map((s, si) => (
                      <div class="subrow" key={s}>
                        {reorder && (
                          <UpDown name={s} first={si === 0} last={si === c.subcategories.length - 1} onMove={(d) => void moveSubcategory(db, c.name, s, d).catch(fail)} />
                        )}
                        <div class="grow">
                          <strong>{s}</strong> <span class="small muted">{plural(itemsIn(items, c.name, s).length, 'item')}</span>
                        </div>
                        {!reorder && (
                          <Actions
                            onRename={() => void withPin('Renaming a subcategory needs the mentor PIN.', { kind: 'rename', t: { category: c.name, subcategory: s } })}
                            onRemove={() => void withPin('Removing a subcategory needs the mentor PIN.', { kind: 'remove', t: { category: c.name, subcategory: s } })}
                          />
                        )}
                      </div>
                    ))}
                    <div class="subrow last">
                      <button type="button" class="btn sm" onClick={() => setOpen({ kind: 'addSub', category: c.name })}>
                        <Icon name="plus" />
                        Add subcategory to {c.name}
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      {open?.kind === 'addCategory' && (
        <EntryDialog
          title="Add a category"
          what="Category"
          existing={cats.map((c) => c.name)}
          placeholder="e.g. Game pieces"
          explain="New categories go to the end of the list. Use Reorder to move them."
          submitLabel="Add category"
          onClose={() => setOpen(null)}
          onSubmit={async (v) => {
            const name = await addCategory(db, v.name);
            setOpen(null);
            showToast(`Added “${name}”.`);
          }}
        />
      )}
      {open?.kind === 'addSub' && (
        <EntryDialog
          title={`Add a subcategory to ${open.category}`}
          what="Subcategory"
          existing={cats.find((c) => c.name === open.category)?.subcategories ?? []}
          placeholder="e.g. Standoffs"
          submitLabel="Add subcategory"
          onClose={() => setOpen(null)}
          onSubmit={async (v) => {
            const name = await addSubcategory(db, open.category, v.name);
            setExpanded((prev) => new Set(prev).add(open.category));
            setOpen(null);
            showToast(`Added “${name}” to ${open.category}.`);
          }}
        />
      )}
      {open?.kind === 'rename' && (
        <RenameDialog
          t={open.t}
          cats={cats}
          items={items}
          onClose={() => setOpen(null)}
          onRename={async (name) => {
            const { category, subcategory } = open.t;
            if (subcategory === undefined) {
              const renamed = await renameCategory(db, category, name);
              setExpanded((prev) => {
                if (!prev.has(category)) return prev;
                const next = new Set(prev);
                next.delete(category);
                return next.add(renamed);
              });
            } else await renameSubcategory(db, category, subcategory, name);
            setOpen(null);
            showToast('Renamed.');
          }}
        />
      )}
      {open?.kind === 'remove' && (
        <RemoveDialog
          t={open.t}
          cats={cats}
          items={items}
          onClose={() => setOpen(null)}
          onRemove={async (to) => {
            const { category, subcategory } = open.t;
            const moved = subcategory === undefined ? await removeCategory(db, category, to) : await removeSubcategory(db, category, subcategory, to);
            setOpen(null);
            showToast(moved && to ? `Moved ${plural(moved, 'item')} to ${placeLabel(to)} and removed “${label(open.t)}”.` : `Removed “${label(open.t)}”.`);
          }}
        />
      )}
    </>
  );
}

function UpDown(props: { name: string; first: boolean; last: boolean; onMove: (delta: number) => void }) {
  return (
    <span class="updown">
      <button type="button" class="ib" aria-label={`Move ${props.name} up`} disabled={props.first} onClick={() => props.onMove(-1)}>
        <Icon name="chevUp" />
      </button>
      <button type="button" class="ib" aria-label={`Move ${props.name} down`} disabled={props.last} onClick={() => props.onMove(1)}>
        <Icon name="chevDown" />
      </button>
    </span>
  );
}

function Actions(props: { onRename: () => void; onRemove: () => void }) {
  return (
    <div class="acts">
      <button type="button" class="btn sm" onClick={props.onRename}>
        Rename
        <PinMark />
      </button>
      <button type="button" class="btn sm danger" onClick={props.onRemove}>
        Remove
        <PinMark />
      </button>
    </div>
  );
}

function RenameDialog(props: { t: Target; cats: Category[]; items: Item[]; onClose: () => void; onRename: (name: string) => Promise<void> }) {
  const { category, subcategory } = props.t;
  const isSub = subcategory !== undefined;
  const existing = isSub ? (props.cats.find((c) => c.name === category)?.subcategories ?? []) : props.cats.map((c) => c.name);
  const n = itemsIn(props.items, category, subcategory).length;
  return (
    <EntryDialog
      title={`Rename “${label(props.t)}”`}
      what={isSub ? 'Subcategory' : 'Category'}
      existing={existing}
      self={isSub ? subcategory : category}
      initial={{ name: isSub ? subcategory : category }}
      explain={n ? `Its ${plural(n, 'item')} move with it.` : undefined}
      submitLabel="Rename"
      onClose={props.onClose}
      onSubmit={(v) => props.onRename(v.name)}
    />
  );
}

function RemoveDialog(props: { t: Target; cats: Category[]; items: Item[]; onClose: () => void; onRemove: (to: CategoryPlace | null) => Promise<void> }) {
  const held = itemsIn(props.items, props.t.category, props.t.subcategory);
  const targets = moveTargets(props.cats, props.t);
  // Default: for a subcategory, its own category with no subcategory; for a category, the first other one.
  const [pick, setPick] = useState(() => {
    const sibling = targets.findIndex((p) => p.category === props.t.category);
    return sibling >= 0 ? sibling : 0;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = held.length;
  const to = targets[pick] ?? null;
  const go = async () => {
    setBusy(true);
    try {
      await props.onRemove(n > 0 ? to : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <Dialog label="Remove category" role="alertdialog" onClose={() => !busy && props.onClose()}>
      {n > 0 ? (
        <>
          <h2 class="h2">“{label(props.t)}” isn’t empty yet</h2>
          <p class="dlg-big">
            It holds <strong>{plural(n, 'item')}</strong>: {heldText(held.map((i) => i.name))}. Move {n === 1 ? 'it' : 'them'} somewhere else, then it will be removed.
          </p>
          {targets.length > 0 ? (
            <div>
              <label class="lbl" for="mv">
                Move to
              </label>
              <select id="mv" class="field" value={String(pick)} onChange={(e) => setPick(Number((e.currentTarget as HTMLSelectElement).value))}>
                {targets.map((p, i) => (
                  <option key={placeLabel(p)} value={String(i)}>
                    {placeLabel(p)}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p class="dlg-p">There is no other category to move them to. Add one first.</p>
          )}
        </>
      ) : (
        <>
          <h2 class="h2">Remove “{label(props.t)}”?</h2>
          <p class="dlg-big">It’s empty.</p>
        </>
      )}
      {error && (
        <div class="err" role="alert">
          {error}
        </div>
      )}
      <DialogActions>
        <button type="button" class="btn lg" disabled={busy} onClick={props.onClose}>
          Cancel
        </button>
        <button type="button" class="btn danger lg" disabled={busy || (n > 0 && !to)} onClick={() => void go()}>
          <Icon name="trash" />
          {n > 0 ? `Move ${plural(n, 'item')} and remove` : 'Remove'}
        </button>
      </DialogActions>
    </Dialog>
  );
}
