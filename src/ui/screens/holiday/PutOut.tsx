// Putting Holiday items out (SPEC v3.0 F5, F22): Unpack a bin — take everything out or tick
// items, each going on its usual display unless a place is chosen for the batch (displays first,
// then typed text) or for the item — and Put out for a single item.
import { useState } from 'preact/hooks';
import { putOut, unpackBin, type OutPlace } from '../../../data/holiday';
import type { Bin, Display, Item } from '../../../domain/types';
import { plural } from '../../components/common';
import { Qty } from '../../components/chips';
import { Dialog, DialogActions } from '../../components/Dialog';
import { useDb } from '../../data-hooks';
import { Icon } from '../../icons';
import { href } from '../../shell/router';
import { showToast } from '../../shell/toast';

/** The batch choice: each item's usual display, one display for all, or typed text. */
type Batch = { kind: 'usual' } | { kind: 'display'; id: string } | { kind: 'where' };

const USUAL = '__usual';
const WHERE = '__where';
const SAME = '';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function BatchPicker(props: { displays: readonly Display[]; batch: Batch; where: string; one: boolean; usualLabel: string; onBatch: (b: Batch) => void; onWhere: (w: string) => void }) {
  const value = props.batch.kind === 'usual' ? USUAL : props.batch.kind === 'where' ? WHERE : props.batch.id;
  return (
    <div>
      <label class="lbl" for="po-to">
        Put {props.one ? 'it' : 'them'} on
      </label>
      <select
        id="po-to"
        class="field"
        value={value}
        onChange={(e) => {
          const v = (e.currentTarget as HTMLSelectElement).value;
          props.onBatch(v === USUAL ? { kind: 'usual' } : v === WHERE ? { kind: 'where' } : { kind: 'display', id: v });
        }}
      >
        <option value={USUAL}>{props.usualLabel || 'Its usual display'}</option>
        {props.displays.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
        <option value={WHERE}>Somewhere else (type it)…</option>
      </select>
      {props.batch.kind === 'where' && (
        <input class="field" style={{ marginTop: '8px' }} aria-label="Where" value={props.where} placeholder="e.g. Front yard" autoComplete="off" onInput={(e) => props.onWhere((e.currentTarget as HTMLInputElement).value)} />
      )}
    </div>
  );
}

/** The place an item goes: its own choice, else the batch's, else its usual display (none: no display). */
function placeFor(item: Item, own: string, batch: Batch, where: string): OutPlace | undefined {
  if (own !== SAME) return { displayId: own };
  if (batch.kind === 'display') return { displayId: batch.id };
  if (batch.kind === 'where') return { where };
  return undefined;
}

function placeName(item: Item, own: string, batch: Batch, where: string, displays: ReadonlyMap<string, Display>): string {
  const to = placeFor(item, own, batch, where);
  if (!to) return displays.get(item.displayId)?.name ?? 'No display';
  return 'displayId' in to ? (displays.get(to.displayId)?.name ?? 'No display') : to.where.trim() || 'Out';
}

/** Unpack (F5) a Holiday bin: its stored items out, and the bin out too. */
export function UnpackDialog(props: { bin: Bin; items: readonly Item[]; displays: readonly Display[]; onClose: () => void; onDone?: () => void }) {
  const db = useDb();
  const stored = props.items.filter((i) => i.binId === props.bin.id && i.status === 'stored').sort((a, b) => a.name.localeCompare(b.name, 'en-US', { sensitivity: 'base' }));
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(stored.map((i) => i.id)));
  const [batch, setBatch] = useState<Batch>({ kind: 'usual' });
  const [where, setWhere] = useState('');
  const [own, setOwn] = useState<Record<string, string>>({});
  const [binOut, setBinOut] = useState(props.bin.state !== 'out');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byId = new Map(props.displays.map((d) => [d.id, d]));
  const chosen = stored.filter((i) => ticked.has(i.id));
  const all = chosen.length === stored.length;
  const targets = [...new Set(chosen.map((i) => placeFor(i, own[i.id] ?? SAME, batch, where) ?? { displayId: i.displayId }).flatMap((t) => ('displayId' in t && byId.has(t.displayId) ? [t.displayId] : [])))];

  const go = async () => {
    if (batch.kind === 'where' && where.trim() === '' && chosen.some((i) => (own[i.id] ?? SAME) === SAME)) {
      setError('Type where they go, or choose a display.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const n = await unpackBin(
        db,
        props.bin.id,
        chosen.map((i) => ({ id: i.id, to: placeFor(i, own[i.id] ?? SAME, batch, where) })),
        binOut,
      );
      showToast(`${n ? `${plural(n, 'item')} out` : 'Nothing taken out'}${binOut ? `; ${props.bin.code} is out` : ''}.`);
      props.onDone?.();
      props.onClose();
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };

  return (
    <Dialog label={`Unpack ${props.bin.code}`} onClose={() => !busy && props.onClose()}>
      <div class="dlg-form">
        <h2 class="h2">
          Unpack {props.bin.code} {props.bin.name}
        </h2>
        {stored.length === 0 ? (
          <p class="dlg-p">Nothing in it is stored: everything is already out.</p>
        ) : (
          <>
            <BatchPicker displays={props.displays} batch={batch} where={where} one={false} usualLabel="Each on its usual display" onBatch={setBatch} onWhere={setWhere} />
            <div class="links">
              <button type="button" class="btn sm" onClick={() => setTicked(new Set(all ? [] : stored.map((i) => i.id)))}>
                {all ? 'Untick all' : 'Tick all'}
              </button>
              <span class="small muted">{`${chosen.length} of ${stored.length} ticked`}</span>
            </div>
            <div class="uplist" role="group" aria-label="Items to take out">
              {stored.map((i) => {
                const on = ticked.has(i.id);
                return (
                  <div class="uprow" key={i.id}>
                    <button
                      type="button"
                      class="tbox"
                      role="checkbox"
                      aria-checked={on}
                      aria-label={`Take out ${i.name}`}
                      onClick={() => {
                        const next = new Set(ticked);
                        if (on) next.delete(i.id);
                        else next.add(i.id);
                        setTicked(next);
                      }}
                    >
                      <span>{on && <Icon name="check" />}</span>
                    </button>
                    <span class="rt">
                      <strong>
                        {i.name} <Qty item={i} />
                      </strong>
                      <span class="small muted">→ {placeName(i, own[i.id] ?? SAME, batch, where, byId)}</span>
                    </span>
                    {on && props.displays.length > 0 && (
                      <select class="field" aria-label={`Where ${i.name} goes`} value={own[i.id] ?? SAME} onChange={(e) => setOwn({ ...own, [i.id]: (e.currentTarget as HTMLSelectElement).value })}>
                        <option value={SAME}>As above</option>
                        {props.displays.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
        {props.bin.state !== 'out' && (
          <label class="tick">
            <input type="checkbox" checked={binOut} onChange={(e) => setBinOut((e.currentTarget as HTMLInputElement).checked)} />
            <span>Set {props.bin.code} out too (the bin is out of storage)</span>
          </label>
        )}
        {targets.length > 0 && (
          <div class="links">
            <span class="small muted">Setup photos:</span>
            {targets.map((id) => (
              <a key={id} class="btn sm" href={href.display(id)}>
                <Icon name="photo" />
                {byId.get(id)!.name}
              </a>
            ))}
          </div>
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
          <button type="button" class="btn pri lg" disabled={busy || (chosen.length === 0 && !(binOut && props.bin.state !== 'out'))} onClick={() => void go()}>
            <Icon name="arrowOut" />
            {chosen.length === 0 ? `Set ${props.bin.code} out` : all ? (stored.length === 1 ? 'Take it out' : `Take all ${stored.length} out`) : `Take ${chosen.length} out`}
          </button>
        </DialogActions>
      </div>
    </Dialog>
  );
}

/** Put out a single Holiday item (from its detail screen): on a display, or typed text. */
export function PutOutDialog(props: { item: Item; displays: readonly Display[]; onClose: () => void }) {
  const db = useDb();
  const usual = props.displays.find((d) => d.id === props.item.displayId);
  const [batch, setBatch] = useState<Batch>(usual || props.displays.length === 0 ? { kind: usual ? 'usual' : 'where' } : { kind: 'display', id: props.displays[0]!.id });
  const [where, setWhere] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    if (batch.kind === 'where' && where.trim() === '') {
      setError('Type where it goes, or choose a display.');
      return;
    }
    setBusy(true);
    try {
      await putOut(db, [{ id: props.item.id, to: placeFor(props.item, SAME, batch, where) }]);
      showToast(`${props.item.name} is out.`);
      props.onClose();
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };
  return (
    <Dialog label={`Put out ${props.item.name}`} onClose={() => !busy && props.onClose()}>
      <div class="dlg-form">
        <h2 class="h2">Put out {props.item.name}</h2>
        <BatchPicker displays={props.displays} batch={batch} where={where} one usualLabel={usual ? `${usual.name} (its usual display)` : ''} onBatch={setBatch} onWhere={setWhere} />
        {error && (
          <div class="err" role="alert">
            {error}
          </div>
        )}
        <DialogActions>
          <button type="button" class="btn lg" disabled={busy} onClick={props.onClose}>
            Cancel
          </button>
          <button type="button" class="btn pri lg" disabled={busy} onClick={() => void go()}>
            <Icon name="arrowOut" />
            Put out
          </button>
        </DialogActions>
      </div>
    </Dialog>
  );
}

