// Helper devices (§18.1), from the count-in start screen: add, edit and remove helpers, see
// which groups each counts (unassigned ones highlighted), and send each a count kit (§18.2).
// No PIN anywhere here (§6).
import { useEffect, useState } from 'preact/hooks';
import { addHelper, buildKit, editHelper, recordKit, removeHelper } from '../../../data/helpers';
import type { InventorySnapshot } from '../../../data/inventory';
import { formatBytes, formatDateTime } from '../../../domain/dates';
import {
  KIND_LABEL,
  MAX_HELPER_NAME,
  checkHelper,
  coverage,
  groupChoices,
  lastKit,
  missingGroups,
  nameLocked,
  sharedGroups,
  type GroupKind,
  type Helper,
  type HelperDraft,
} from '../../../domain/helpers';
import { nameKey } from '../../../domain/types';
import { kitFileName } from '../../../io/count-kit';
import { shareOrDownload } from '../../../io/share';
import { BackButton, CheckBox, StateMessage, Toggle, TopBar, plural } from '../../components/common';
import { Dialog, DialogActions } from '../../components/Dialog';
import { useDb, useHelpers, useSnapshot } from '../../data-hooks';
import { Icon } from '../../icons';
import { href } from '../../shell/router';
import { showToast } from '../../shell/toast';
import { StorageError } from '../StorageError';

type Open = { kind: 'add' } | { kind: 'edit'; h: Helper } | { kind: 'send'; h: Helper } | { kind: 'remove'; h: Helper } | null;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** "Oct 24, 2026 6:50 PM" for a kit's created_at; the stamp itself if it can't be read. */
const kitTime = (stamp: string) => {
  const ms = Date.parse(stamp);
  return Number.isNaN(ms) ? stamp : formatDateTime(new Date(ms));
};

export function HelpersScreen() {
  const snap = useSnapshot();
  const helpers = useHelpers();
  const [open, setOpen] = useState<Open>(null);
  const back = <BackButton label="Count-in" fallback={href.tab('count')} />;

  const failed = snap.state === 'error' ? snap.error : helpers.state === 'error' ? helpers.error : null;
  if (failed !== null) {
    return (
      <>
        <TopBar title="Helper devices" back={back} />
        <StorageError error={failed} />
      </>
    );
  }
  const ready = snap.state === 'ready' && helpers.state === 'ready';
  const list = helpers.state === 'ready' ? helpers.value : [];
  const sent = list.filter((h) => h.kits.length > 0).length;

  return (
    <>
      <TopBar
        title="Helper devices"
        subtitle={ready ? `${plural(list.length, 'helper')} · ${sent} sent a kit` : 'Loading…'}
        back={back}
        actions={
          <button type="button" class="btn pri" disabled={!ready} onClick={() => setOpen({ kind: 'add' })}>
            <Icon name="plus" />
            Add helper
          </button>
        }
      />
      {!ready ? (
        <div class="cbody">
          <StateMessage icon="phone" title="Loading helpers…" />
        </div>
      ) : (
        <div class="cbody">
          <p class="small muted lockline">
            Helpers are other phones or tablets that count at the same time as this one. Give each a name and the groups it counts, then <strong>send it a count kit</strong>. Counts come back
            to this tablet with Import counts. No PIN needed.
          </p>
          {list.length === 0 && (
            <div class="empty-card">
              <strong>No helpers yet.</strong> Add one for each device that will count, e.g. “Tablet 2 · Alex &amp; Jordan” or “Maya’s phone”.
            </div>
          )}
          {list.map((h) => (
            <HelperCard key={h.id} h={h} snap={snap.value} onOpen={setOpen} />
          ))}
          <Coverage helpers={list} snap={snap.value} />
        </div>
      )}
      {ready && (open?.kind === 'add' || open?.kind === 'edit') && (
        <HelperDialog editing={open.kind === 'edit' ? open.h : null} helpers={list} snap={snap.value} onClose={() => setOpen(null)} />
      )}
      {open?.kind === 'send' && <SendKitDialog h={open.h} items={snap.state === 'ready' ? snap.value.items.length : 0} onClose={() => setOpen(null)} />}
      {open?.kind === 'remove' && <RemoveHelper h={open.h} onClose={() => setOpen(null)} />}
    </>
  );
}

function HelperCard(props: { h: Helper; snap: InventorySnapshot; onOpen: (o: Open) => void }) {
  const h = props.h;
  const kit = lastKit(h);
  const gone = missingGroups(h, groupChoices(h.kind, props.snap.categories, props.snap.locations));
  return (
    <div class="card hcard" aria-label={`Helper ${h.name}`}>
      <div class="hcard-h">
        <Icon name="phone" class="ic xl" />
        <div class="grow">
          <h2 class="h2">{h.name}</h2>
          <div class="small muted">
            {kit ? `Last kit sent ${kitTime(kit.createdAt)}${h.kits.length > 1 ? ` · ${plural(h.kits.length, 'kit')} sent` : ''}` : 'No kit sent yet'}
            {nameLocked(h) && ' · name locked'}
          </div>
        </div>
        <div class="acts">
          <button type="button" class="btn pri" onClick={() => props.onOpen({ kind: 'send', h })}>
            <Icon name="upload" />
            Send count kit
          </button>
          <button type="button" class="btn sm" onClick={() => props.onOpen({ kind: 'edit', h })}>
            Edit
          </button>
          <button type="button" class="btn sm danger" onClick={() => props.onOpen({ kind: 'remove', h })}>
            Remove
          </button>
        </div>
      </div>
      <div class="hcard-b">
        <div>
          <span class="small muted">
            Counts {plural(h.groups.length, KIND_LABEL[h.kind].one, KIND_LABEL[h.kind].many)}:
          </span>{' '}
          <strong>{h.groups.join(', ')}</strong>
        </div>
        <div class="small">New items: {h.allowNewItems ? 'allowed (saved as pending for review here)' : 'not allowed'}</div>
        {gone.length > 0 && (
          <div class="hnote" role="status">
            <Icon name="low" />
            No longer in the list: {gone.join(', ')}. Edit this helper before sending a kit.
          </div>
        )}
      </div>
    </div>
  );
}

/** Every group with its helpers; unassigned ones highlighted (§18.1). */
function Coverage(props: { helpers: Helper[]; snap: InventorySnapshot }) {
  const kinds: GroupKind[] = props.snap.locations.length > 0 || props.helpers.some((h) => h.kind === 'location') ? ['category', 'location'] : ['category'];
  return (
    <>
      {kinds.map((kind) => {
        const rows = coverage(props.helpers, kind, groupChoices(kind, props.snap.categories, props.snap.locations));
        const open = rows.filter((r) => r.helpers.length === 0).length;
        return (
          <div key={kind} class="card cgroups" aria-label={`Who counts which ${KIND_LABEL[kind].one}`}>
            <div class="cg-h">
              <h2 class="h2 grow">{kind === 'category' ? 'Categories' : 'Locations'}</h2>
              <span class="small muted">{open === 0 ? 'Every one has a helper' : `${open} without a helper`}</span>
            </div>
            {rows.map((r) => (
              <div key={r.group} class={r.helpers.length === 0 ? 'cov-row open' : 'cov-row'}>
                <strong class="grow">{r.group}</strong>
                {r.helpers.length === 0 ? (
                  <span class="chip np">Not assigned</span>
                ) : (
                  <span class="small">
                    {r.helpers.join(', ')}
                    {r.helpers.length > 1 && <span class="muted"> · both count it; settle differences on import</span>}
                  </span>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

function HelperDialog(props: { editing: Helper | null; helpers: Helper[]; snap: InventorySnapshot; onClose: () => void }) {
  const db = useDb();
  const e = props.editing;
  const [d, setD] = useState<HelperDraft>(() => (e ? { name: e.name, kind: e.kind, groups: [...e.groups], allowNewItems: e.allowNewItems } : { name: '', kind: 'category', groups: [], allowNewItems: true }));
  const [errors, setErrors] = useState<Partial<Record<'name' | 'groups', string>>>({});
  const [confirmShared, setConfirmShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const locked = e !== null && nameLocked(e);
  const choices = groupChoices(d.kind, props.snap.categories, props.snap.locations);
  const noLocations = groupChoices('location', props.snap.categories, props.snap.locations).length === 0;
  const chosen = new Set(d.groups.map(nameKey));
  const others = props.helpers.filter((h) => h.id !== e?.id && h.kind === d.kind);
  // Only groups this edit adds: a share that was already accepted isn't asked about again.
  const had = new Set((e?.kind === d.kind ? e.groups : []).map(nameKey));
  const shared = sharedGroups(d, props.helpers, e?.id).filter((s) => !had.has(nameKey(s.group)));

  const patch = (p: Partial<HelperDraft>) => {
    setD({ ...d, ...p });
    setConfirmShared(false);
  };
  const toggle = (g: string) => patch({ groups: chosen.has(nameKey(g)) ? d.groups.filter((x) => nameKey(x) !== nameKey(g)) : [...d.groups, g] });

  const submit = async (ev: Event) => {
    ev.preventDefault();
    if (busy) return;
    const r = checkHelper(d, props.helpers, choices, e);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors({});
    // "Both will count it": shown once, then Save anyway (§18.1).
    if (shared.length > 0 && !confirmShared) {
      setConfirmShared(true);
      return;
    }
    setBusy(true);
    try {
      const saved = e ? await editHelper(db, e.id, r.draft) : await addHelper(db, r.draft);
      showToast(e ? `Saved “${saved.name}”. Changes go out with the next kit.` : `Added “${saved.name}”. Send it a count kit next.`);
      props.onClose();
    } catch (err) {
      setFailure(message(err));
      setBusy(false);
    }
  };

  return (
    <Dialog label={e ? 'Edit helper' : 'Add a helper'} onClose={() => !busy && props.onClose()}>
      <form class="dlg-form" onSubmit={(ev) => void submit(ev)}>
        <h2 class="h2">{e ? `Edit “${e.name}”` : 'Add a helper'}</h2>
        <div>
          <label class="lbl" for="hname">
            Name {locked && <Icon name="lock" />}
          </label>
          <input
            id="hname"
            class={errors.name ? 'field bad' : 'field'}
            disabled={locked}
            maxLength={MAX_HELPER_NAME}
            autoComplete="off"
            placeholder="e.g. Tablet 2 · Alex & Jordan"
            value={d.name}
            onInput={(ev) => patch({ name: (ev.currentTarget as HTMLInputElement).value })}
          />
          {locked && <div class="small muted">Locked: a kit was sent, and imports use the name to recognize this helper’s counts. Add a new helper to use another name.</div>}
          {errors.name && (
            <div class="err" role="alert">
              {errors.name}
            </div>
          )}
        </div>
        <div>
          <div class="lbl" id="hkind">
            Counts
          </div>
          <div class="choices hkinds" role="radiogroup" aria-labelledby="hkind">
            {(['category', 'location'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={d.kind === k}
                class={d.kind === k ? 'choice on' : 'choice'}
                disabled={k === 'location' && noLocations}
                onClick={() => d.kind !== k && patch({ kind: k, groups: [] })}
              >
                <span class="dot" />
                {k === 'category' ? 'Categories' : noLocations ? 'Locations (none yet: add them in More › Locations)' : 'Locations'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div class="hgroups-h">
            <span class="lbl" id="hgroups">
              Which {KIND_LABEL[d.kind].many}
            </span>
            <button type="button" class="btn sm" onClick={() => patch({ groups: chosen.size === choices.length ? [] : [...choices] })}>
              {chosen.size === choices.length ? 'Clear' : 'Select all'}
            </button>
          </div>
          <div class="hgroups" role="group" aria-labelledby="hgroups">
            {choices.map((g) => {
              const also = others.filter((h) => h.groups.some((x) => nameKey(x) === nameKey(g))).map((h) => h.name);
              const on = chosen.has(nameKey(g));
              return (
                <button key={g} type="button" class="cb hgroup" role="checkbox" aria-checked={on} onClick={() => toggle(g)}>
                  <CheckBox state={on ? 'on' : 'off'} />
                  <span>
                    <strong>{g}</strong>
                    {also.length > 0 && <span class="small muted"> · also {also.join(', ')}</span>}
                  </span>
                </button>
              );
            })}
          </div>
          {errors.groups && (
            <div class="err" role="alert">
              {errors.groups}
            </div>
          )}
        </div>
        <Toggle on={d.allowNewItems} onClick={() => patch({ allowNewItems: !d.allowNewItems })}>
          Allow new items (a helper can add items not on the list; they wait here as pending)
        </Toggle>
        {confirmShared && (
          <div class="hwarn" role="alert">
            <Icon name="low" />
            <div>
              <strong>{shared.map((s) => `${s.group} (${s.helpers.join(', ')})`).join('; ')}</strong> {shared.length === 1 ? 'is' : 'are'} already assigned. Both will count it; you’ll settle
              differences on import.
            </div>
          </div>
        )}
        {failure && (
          <div class="err" role="alert">
            {failure}
          </div>
        )}
        <DialogActions>
          <button type="button" class="btn lg" disabled={busy} onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" class="btn pri lg" disabled={busy}>
            {confirmShared ? 'Save anyway' : e ? 'Save' : 'Add helper'}
          </button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function SendKitDialog(props: { h: Helper; items: number; onClose: () => void }) {
  const db = useDb();
  const h = props.h;
  const [photos, setPhotos] = useState(true);
  const [size, setSize] = useState<{ count: number; bytes: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    void db.photos.toArray().then(
      (rows) => setSize({ count: rows.length, bytes: rows.reduce((n, r) => n + r.full.size, 0) }),
      () => setSize(null),
    );
  }, [db]);
  const kit = lastKit(h);

  const send = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const now = new Date();
      const built = await buildKit(db, h.id, photos, now);
      const name = kitFileName(h.name, now);
      const result = await shareOrDownload(new File([built.blob], name, { type: 'application/zip' }), `Count kit for ${h.name}`);
      if (result === 'cancelled') {
        setBusy(false);
        return;
      }
      await recordKit(db, h.id, built);
      showToast(result === 'shared' ? `Sent ${name}.` : `Saved ${name} to Downloads. Open Files to send it by Quick Share, Bluetooth or Drive.`);
      props.onClose();
    } catch (e) {
      setFailure(`Couldn’t build the kit: ${message(e)}`);
      setBusy(false);
    }
  };

  return (
    <Dialog label="Send count kit" onClose={() => !busy && props.onClose()}>
      <h2 class="h2">Send a count kit to “{h.name}”</h2>
      <p class="dlg-p">
        The kit holds all {plural(props.items, 'item')} (search and scan reach any item), the supplier, location and category lists, and this helper’s{' '}
        {plural(h.groups.length, KIND_LABEL[h.kind].one, KIND_LABEL[h.kind].many)}: <strong>{h.groups.join(', ')}</strong>. Prices are left out.
      </p>
      <Toggle on={photos} disabled={busy} onClick={() => setPhotos(!photos)}>
        Include photos{size ? ` (${plural(size.count, 'photo')}, about ${formatBytes(size.bytes)})` : ''}. Turn off for slow transfers like Bluetooth.
      </Toggle>
      <p class="small muted dlg-p">
        {kit ? `Last kit sent ${kitTime(kit.createdAt)}. Sending again makes a new kit with today’s inventory.` : 'Once a kit is sent, this helper’s name can’t change.'} Next, open the kit on the helper
        with “Join as a helper”.
      </p>
      {failure && (
        <div class="err" role="alert">
          {failure}
        </div>
      )}
      <DialogActions>
        <button type="button" class="btn lg" disabled={busy} onClick={props.onClose}>
          Cancel
        </button>
        <button type="button" class="btn pri lg" disabled={busy} onClick={() => void send()}>
          <Icon name="upload" />
          {busy ? 'Building the kit…' : 'Send count kit'}
        </button>
      </DialogActions>
    </Dialog>
  );
}

function RemoveHelper(props: { h: Helper; onClose: () => void }) {
  const db = useDb();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await removeHelper(db, props.h.id);
      showToast(`Removed “${props.h.name}”.`);
      props.onClose();
    } catch (e) {
      showToast(message(e));
      setBusy(false);
    }
  };
  return (
    <Dialog label="Remove helper" role="alertdialog" onClose={() => !busy && props.onClose()}>
      <h2 class="h2">Remove “{props.h.name}”?</h2>
      <p class="dlg-big">Counts already imported from it stay as they are. A counts file it sends later can still be imported, after a warning.</p>
      <DialogActions>
        <button type="button" class="btn lg" disabled={busy} onClick={props.onClose}>
          Keep it
        </button>
        <button type="button" class="btn danger lg" disabled={busy} onClick={() => void go()}>
          <Icon name="trash" />
          Remove helper
        </button>
      </DialogActions>
    </Dialog>
  );
}
