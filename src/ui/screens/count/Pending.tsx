// Pending from helpers (§18.5; mockup 11f): new items students added on helper devices. Accept
// opens the Add item form filled in; Same as existing uses or adds the count; Discard asks
// first. Likely duplicates are flagged and two pending items can be combined. No PIN (§6).
import { useEffect, useMemo, useState } from 'preact/hooks';
import { combinePendingItems, discardPending, matchPending, pendingPhoto } from '../../../data/pending';
import { formatDateTime } from '../../../domain/dates';
import type { PendingRecord } from '../../../domain/helper-mode';
import { findDuplicates, stampMs, type Duplicate } from '../../../domain/import-counts';
import { matchesQuery } from '../../../domain/search';
import type { Item } from '../../../domain/types';
import { BackButton, StateMessage, TopBar, plural } from '../../components/common';
import { Dialog, DialogActions } from '../../components/Dialog';
import { useDb, usePending, useSnapshot } from '../../data-hooks';
import { Icon } from '../../icons';
import { href } from '../../shell/router';
import { showToast } from '../../shell/toast';
import { StorageError } from '../StorageError';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
type Open = { kind: 'match'; p: PendingRecord } | { kind: 'discard'; p: PendingRecord } | { kind: 'combine'; p: PendingRecord; other: PendingRecord } | null;

export function PendingScreen() {
  const live = usePending();
  const snap = useSnapshot();
  const [open, setOpen] = useState<Open>(null);
  const back = <BackButton label="Count-in" fallback={href.tab('count')} />;
  if (live.state === 'error') return <StorageError error={live.error} />;
  if (snap.state === 'error') return <StorageError error={snap.error} />;
  if (live.state === 'loading' || snap.state === 'loading') {
    return (
      <>
        <TopBar title="Pending from helpers" subtitle="Loading…" back={back} />
        <div class="state" aria-busy="true" />
      </>
    );
  }
  const pending = live.value;
  const items = snap.value.items;
  const dups = findDuplicates(pending, items);
  return (
    <>
      <TopBar title="Pending from helpers" subtitle="New items students added on helper devices" back={back} />
      <div class="cbody imp">
        {pending.length === 0 ? (
          <StateMessage icon="check" title="Nothing waiting" actions={<a class="btn lg" href={href.tab('count')}>Back to count-in</a>}>
            <p class="state-text muted">New items from helpers appear here after Import counts.</p>
          </StateMessage>
        ) : (
          <>
            <p class="m0 muted">New items students added on helpers. They aren’t in the inventory, order list or labels until accepted. They can wait here and are kept in full backups.</p>
            {pending.map((p) => (
              <PendingCard
                key={p.id}
                p={p}
                dups={dups.filter((d) => d.pendingId === p.id)}
                onMatch={() => setOpen({ kind: 'match', p })}
                onDiscard={() => setOpen({ kind: 'discard', p })}
                onCombine={(other) => setOpen({ kind: 'combine', p, other })}
                pending={pending}
              />
            ))}
          </>
        )}
      </div>
      {open?.kind === 'match' && <MatchDialog p={open.p} items={items} onClose={() => setOpen(null)} />}
      {open?.kind === 'discard' && <DiscardDialog p={open.p} onClose={() => setOpen(null)} />}
      {open?.kind === 'combine' && <CombineDialog p={open.p} other={open.other} onClose={() => setOpen(null)} />}
    </>
  );
}

function usePendingPhoto(id: string, has: boolean): string | null {
  const db = useDb();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!has) return;
    let u: string | null = null;
    let alive = true;
    void pendingPhoto(db, id).then((b) => {
      if (!alive || !b) return;
      u = URL.createObjectURL(b);
      setUrl(u);
    });
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [db, id, has]);
  return url;
}

function PendingCard(props: { p: PendingRecord; dups: Duplicate[]; pending: PendingRecord[]; onMatch: () => void; onDiscard: () => void; onCombine: (other: PendingRecord) => void }) {
  const { p } = props;
  const photo = usePendingPhoto(p.id, p.hasPhoto);
  return (
    <div class="card pcard">
      {photo ? <img class="pcard-ph" src={photo} alt={`${p.name}, the student’s photo`} /> : <span class="pcard-ph nophoto">No photo</span>}
      <div class="pcard-t">
        <div class="pcard-h">
          <h2 class="h2">{p.name}</h2>
          <span class="chip pend">PENDING</span>
        </div>
        <div class="small muted">
          From {p.helperName} · counted {p.countedAt ? formatDateTime(new Date(stampMs(p.countedAt))) : 'at an unknown time'} · {p.subcategory ? `${p.category} › ${p.subcategory}` : p.category} · {p.unit}
        </div>
        <div>
          <strong>On hand</strong> {p.onHand} · <strong>Location</strong> {p.location || 'none'} · <strong>Desired</strong> {p.desired}
          {p.barcode && (
            <>
              {' '}
              · <strong>Barcode</strong> <span class="mono">{p.barcode}</span>
            </>
          )}
        </div>
        {p.vendor && (
          <div class="small">
            {p.vendor.supplier} {p.vendor.partNo}
            {p.vendor.packSize > 1 ? ` · pack of ${p.vendor.packSize}` : ''}
          </div>
        )}
        {p.notes && <div class="small pcard-notes">“{p.notes}”</div>}
        {props.dups.map((d) => {
          const other = d.other.kind === 'pending' ? props.pending.find((x) => x.id === d.other.id) : null;
          return (
            <div key={d.other.kind + d.other.id} class="hwarn pdup">
              <Icon name="low" />
              <span class="grow">
                Likely the same as {d.other.kind === 'item' ? 'the inventory item' : ''} “{d.other.name}”{d.other.kind === 'pending' ? ` from ${d.other.helperName}` : ''} ({d.why === 'barcode' ? 'same barcode' : 'similar name'}).
              </span>
              {other ? (
                <button type="button" class="btn" onClick={() => props.onCombine(other)}>
                  Combine…
                </button>
              ) : (
                <button type="button" class="btn" onClick={props.onMatch}>
                  Same as existing…
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div class="pcard-acts">
        <a class="btn pri lg" href={href.accept(p.id)}>
          Accept…
        </a>
        <button type="button" class="btn lg" onClick={props.onMatch}>
          Same as existing…
        </button>
        <button type="button" class="btn danger lg" onClick={props.onDiscard}>
          <Icon name="trash" />
          Discard
        </button>
      </div>
    </div>
  );
}

function MatchDialog({ p, items, onClose }: { p: PendingRecord; items: readonly Item[]; onClose: () => void }) {
  const db = useDb();
  const [q, setQ] = useState(p.name.split(/\s+/)[0] ?? '');
  const [chosen, setChosen] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);
  const matches = useMemo(() => (q.trim() ? items.filter((i) => matchesQuery(i, q)).slice(0, 12) : []), [q, items]);
  const go = async (how: 'use' | 'add') => {
    if (!chosen || busy) return;
    setBusy(true);
    try {
      await matchPending(db, p.id, chosen.id, how);
      showToast(`“${chosen.name}” now has ${how === 'use' ? p.onHand : chosen.onHand + p.onHand} ${chosen.unit}. The pending item was removed.`);
      onClose();
    } catch (e) {
      setBusy(false);
      showToast(message(e));
    }
  };
  return (
    <Dialog label="Same as an existing item" onClose={() => !busy && onClose()}>
      <div class="dlg-form">
        <h2 class="h2">“{p.name}” is the same as…</h2>
        <input class="field" type="search" aria-label="Find the item" autoComplete="off" placeholder="Name, part # or supplier" value={q} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
        <div class="picks">
          {matches.map((i) => (
            <button key={i.id} type="button" class={chosen?.id === i.id ? 'pick on' : 'pick'} aria-pressed={chosen?.id === i.id} onClick={() => setChosen(i)}>
              <span class="pick-t">
                <strong>{i.name}</strong>
                <span class="small muted">
                  {i.category} · on hand {i.onHand} {i.unit}
                </span>
              </span>
            </button>
          ))}
          {q.trim() !== '' && matches.length === 0 && <p class="muted m0">No items match. Try another word.</p>}
        </div>
        {chosen && (
          <p class="dlg-p">
            The helper counted <strong>{p.onHand}</strong>. <strong>Use as the count</strong> sets on hand to {p.onHand}; <strong>Add to the count</strong> (when they’re stored in two places) makes it {chosen.onHand + p.onHand}.
          </p>
        )}
        <DialogActions>
          <button type="button" class="btn lg" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" class="btn lg" disabled={!chosen || busy} onClick={() => void go('add')}>
            Add to the count
          </button>
          <button type="button" class="btn pri lg" disabled={!chosen || busy} onClick={() => void go('use')}>
            Use as the count
          </button>
        </DialogActions>
      </div>
    </Dialog>
  );
}

function DiscardDialog({ p, onClose }: { p: PendingRecord; onClose: () => void }) {
  const db = useDb();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await discardPending(db, p.id);
      showToast(`Discarded “${p.name}”.`);
      onClose();
    } catch (e) {
      setBusy(false);
      showToast(message(e));
    }
  };
  return (
    <Dialog label="Discard pending item" role="alertdialog" onClose={() => !busy && onClose()}>
      <div class="dlg-form">
        <h2 class="h2">Discard “{p.name}”?</h2>
        <p class="dlg-p">
          From {p.helperName}, on hand {p.onHand}. It won’t join the inventory, and importing the same counts file again won’t bring it back.
        </p>
        <DialogActions>
          <button type="button" class="btn lg" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" class="btn danger lg" disabled={busy} onClick={() => void go()}>
            <Icon name="trash" />
            Discard
          </button>
        </DialogActions>
      </div>
    </Dialog>
  );
}

function CombineDialog({ p, other, onClose }: { p: PendingRecord; other: PendingRecord; onClose: () => void }) {
  const db = useDb();
  const [keep, setKeep] = useState(p.id);
  const [busy, setBusy] = useState(false);
  const [a, b] = keep === p.id ? [p, other] : [other, p];
  const go = async (how: 'add' | 'keep') => {
    setBusy(true);
    try {
      const merged = await combinePendingItems(db, a.id, b.id, how);
      showToast(`Combined into “${merged.name}”, on hand ${merged.onHand}.`);
      onClose();
    } catch (e) {
      setBusy(false);
      showToast(message(e));
    }
  };
  return (
    <Dialog label="Combine pending items" onClose={() => !busy && onClose()}>
      <div class="dlg-form">
        <h2 class="h2">Combine into one pending item</h2>
        <div class="choices" role="radiogroup" aria-label="Which one to keep">
          {[p, other].map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={keep === x.id} class={keep === x.id ? 'choice on' : 'choice'} onClick={() => setKeep(x.id)}>
              <span class="dot" />
              Keep “{x.name}” from {x.helperName} ({x.onHand})
            </button>
          ))}
        </div>
        <p class="dlg-p">
          <strong>Add counts</strong> ({a.onHand} + {b.onHand} = {a.onHand + b.onHand}) when they were in two places; <strong>Keep one</strong> ({a.onHand}) when both counted the same parts. The other is removed.
        </p>
        <DialogActions>
          <button type="button" class="btn lg" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" class="btn lg" disabled={busy} onClick={() => void go('keep')}>
            Keep one ({a.onHand})
          </button>
          <button type="button" class="btn pri lg" disabled={busy} onClick={() => void go('add')}>
            Add counts ({a.onHand + b.onHand})
          </button>
        </DialogActions>
      </div>
    </Dialog>
  );
}

