// Scan (F21; mockups 5a–5f): the camera reads a team QR label (2408:<id>) or a stored
// manufacturer barcode and opens that item with the On-hand stepper. A code can be typed
// instead (torn label, no camera). An unknown code can be attached to an item or used for a
// new one. A bin's QR code names a location and shows its items (F29). No PIN here (§6),
// except renaming a location to a scanned name (F25).
import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { adjustCount, setCount, type InventorySnapshot } from '../../../data/inventory';
import { setBarcode } from '../../../data/items';
import { addLocation, updateLocation } from '../../../data/lists';
import { saveFilters } from '../../../data/prefs';
import { NO_FILTERS } from '../../../domain/filters';
import { couldBeLocation, resolveScan, formatName, type ScanResult } from '../../../domain/scan';
import { matchesQuery } from '../../../domain/search';
import { itemStatus } from '../../../domain/status';
import { nameKey, type Item, type Location } from '../../../domain/types';
import { gate } from '../../../security/gate';
import { PinMark, StatusChip, plural } from '../../components/common';
import { CountStepper } from '../../components/OnHandStepper';
import { Scanner, type CameraState } from '../../components/Scanner';
import { useDb, usePhoto, useSnapshot } from '../../data-hooks';
import { Icon } from '../../icons';
import { LockPill, useCloseOnRelock } from '../../shell/LockPill';
import { href } from '../../shell/router';
import { showToast } from '../../shell/toast';
import { AddToListDialog } from '../order/ListDialogs';
import { StorageError } from '../StorageError';

type Panel =
  | { kind: 'none' }
  | { kind: 'typing' }
  | { kind: 'result'; result: ScanResult; format: string | null }
  | { kind: 'attach'; code: string; format: string | null; back: ScanResult }
  /** Rename an existing location to a scanned name (F29; the PIN was given). */
  | { kind: 'rename'; text: string; format: string | null };

export function ScanScreen() {
  const live = useSnapshot();
  if (live.state === 'error') return <StorageError error={live.error} />;
  if (live.state === 'loading') {
    return (
      <div class="state" aria-busy="true">
        <p class="state-text muted">Loading…</p>
      </div>
    );
  }
  return <Scan snap={live.value} />;
}

function Scan({ snap }: { snap: InventorySnapshot }) {
  const [panel, setPanel] = useState<Panel>({ kind: 'none' });
  const [camera, setCamera] = useState<CameraState>('starting');
  const [torch, setTorch] = useState(false);
  const [torchOk, setTorchOk] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const handle = (code: string, format: string | null) => {
    const result = resolveScan(code, snap.items, snap.locations);
    if (result.kind === 'empty') return;
    setPanel({ kind: 'result', result, format });
  };
  const close = () => setPanel({ kind: 'none' });
  const blocked = camera === 'denied' || camera === 'nocamera' || camera === 'error';

  return (
    <div class="scan">
      {blocked ? (
        <CameraBlocked
          state={camera}
          onRetry={() => {
            // Back to the camera view, which asks for the camera again.
            setCamera('starting');
            setAttempt((n) => n + 1);
          }}
          onCode={(c) => handle(c, null)}
        />
      ) : (
        <Scanner key={attempt} paused={panel.kind !== 'none'} onDetect={handle} onState={setCamera} torch={torchOk ? torch : undefined} onTorchSupport={setTorchOk}>
          <div class="reticle" aria-hidden="true">
            <span class="a" />
            <span class="b" />
            <span class="c" />
            <span class="d" />
            <span class="line" />
          </div>
          {panel.kind === 'none' && <div class="chint">{camera === 'starting' ? 'Starting the camera…' : 'Hold a QR label or barcode in the square — it scans by itself'}</div>}
          {panel.kind !== 'none' && <div class="cam-paused">Camera paused</div>}
        </Scanner>
      )}
      <header class="ctop">
        <h1 class="h1 grow">Scan</h1>
        {torchOk && !blocked && (
          <button type="button" class={torch ? 'btn dk on' : 'btn dk'} aria-pressed={torch} onClick={() => setTorch(!torch)}>
            <Icon name="light" />
            Light
          </button>
        )}
        {!blocked && (
          <button type="button" class="btn dk" onClick={() => setPanel({ kind: 'typing' })}>
            <Icon name="keyboard" />
            Type a code
          </button>
        )}
        <LockPill />
      </header>

      {panel.kind === 'typing' && <TypePanel onFind={(c) => handle(c, null)} onClose={close} />}
      {panel.kind === 'result' && (
        <ResultPanel
          snap={snap}
          result={panel.result}
          format={panel.format}
          onDone={close}
          onAttach={(code) => setPanel({ kind: 'attach', code, format: panel.format, back: panel.result })}
          onPick={(item) =>
            setPanel({
              kind: 'result',
              result: { kind: 'item', item, via: panel.result.kind === 'location' ? 'location' : 'barcode', code: panel.result.kind === 'many' || panel.result.kind === 'location' ? panel.result.code : '' },
              format: panel.format,
            })
          }
          onLocation={(location) => setPanel({ kind: 'result', result: { kind: 'location', location, code: location.name }, format: panel.format })}
          onRename={(text) => setPanel({ kind: 'rename', text, format: panel.format })}
        />
      )}
      {panel.kind === 'attach' && (
        <AttachPanel
          snap={snap}
          code={panel.code}
          onBack={() => setPanel({ kind: 'result', result: panel.back, format: panel.format })}
          onAttached={(item) => setPanel({ kind: 'result', result: { kind: 'item', item, via: 'barcode', code: panel.code }, format: panel.format })}
        />
      )}
      {panel.kind === 'rename' && (
        <RenamePanel
          text={panel.text}
          locations={snap.locations}
          onBack={() => setPanel({ kind: 'result', result: resolveScan(panel.text, snap.items, snap.locations), format: panel.format })}
          onRenamed={(location) => setPanel({ kind: 'result', result: { kind: 'location', location, code: location.name }, format: panel.format })}
        />
      )}
    </div>
  );
}

function CameraBlocked(props: { state: CameraState; onRetry: () => void; onCode: (code: string) => void }) {
  const [code, setCode] = useState('');
  const denied = props.state === 'denied';
  return (
    <div class="denied">
      <div class="denied-box">
        <div class="dlg-head">
          <span class="dlg-ic red big">
            <Icon name="camoff" />
          </span>
          <h2 class="h1">{denied ? 'The camera is blocked' : props.state === 'nocamera' ? 'No camera found' : 'The camera didn’t start'}</h2>
        </div>
        {denied ? (
          <>
            <p class="m0">Scanning needs camera permission for this app. To turn it on:</p>
            <ol class="denied-steps">
              <li>
                Open Chrome’s <strong>⋮ menu › Settings › Site settings › Camera</strong>.
              </li>
              <li>
                Find this app in the <strong>Blocked</strong> list and choose <strong>Allow</strong>.
              </li>
              <li>
                Come back here and tap <strong>Try again</strong>.
              </li>
            </ol>
          </>
        ) : (
          <p class="m0">{props.state === 'nocamera' ? 'This device has no camera the app can use.' : 'Another app may be using the camera. Close it and try again.'}</p>
        )}
        <div>
          <button type="button" class="btn pri lg" onClick={props.onRetry}>
            Try again
          </button>
        </div>
        <form
          class="denied-type"
          onSubmit={(e) => {
            e.preventDefault();
            props.onCode(code);
          }}
        >
          <label class="small muted" for="mc">
            <strong>No camera? Type the code on the label or barcode</strong>
          </label>
          <div class="inline-add">
            <input id="mc" class="field mono" autoComplete="off" placeholder="e.g. st-0063 or 722787604386" value={code} onInput={(e) => setCode((e.currentTarget as HTMLInputElement).value)} />
            <button type="submit" class="btn" disabled={code.trim() === ''}>
              Find
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Panel(props: { label: string; children: ComponentChildren; foot: ComponentChildren }) {
  return (
    <div class="spanel" role="dialog" aria-label={props.label}>
      <div class="sp-body">{props.children}</div>
      <div class="sp-foot">{props.foot}</div>
    </div>
  );
}

function TypePanel(props: { onFind: (code: string) => void; onClose: () => void }) {
  const [code, setCode] = useState('');
  return (
    <div class="spanel" role="dialog" aria-label="Type a code">
      <form
        class="sp-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) props.onFind(code);
        }}
      >
        <div class="sp-body">
          <h2 class="h2">Type a code</h2>
          <p class="m0">For a torn label or a barcode the camera can’t read. Type the item ID from the label (e.g. st-0063) or the barcode digits.</p>
          <input class="field mono" aria-label="Code" autoFocus autoComplete="off" placeholder="e.g. st-0063 or 722787604386" value={code} onInput={(e) => setCode((e.currentTarget as HTMLInputElement).value)} />
        </div>
        <div class="sp-foot">
          <button type="submit" class="btn pri lg" disabled={code.trim() === ''}>
            Find item
          </button>
          <button type="button" class="btn" onClick={props.onClose}>
            Back to camera
          </button>
        </div>
      </form>
    </div>
  );
}

function ResultPanel(props: {
  snap: InventorySnapshot;
  result: ScanResult;
  format: string | null;
  onDone: () => void;
  onAttach: (code: string) => void;
  onPick: (item: Item) => void;
  onLocation: (location: Location) => void;
  onRename: (text: string) => void;
}) {
  const r = props.result;
  if (r.kind === 'item') {
    // The live item, so the stepper shows saved changes.
    const item = props.snap.items.find((i) => i.id === r.item.id);
    if (!item) return <MissingPanel id={r.item.id} onDone={props.onDone} />;
    const by =
      r.via === 'label' ? `QR label ${r.code}` : r.via === 'id' ? `Typed ID ${item.id}` : r.via === 'location' ? `In location ${r.code}` : `${formatName(props.format)} ${r.code}`;
    return <FoundPanel item={item} by={by} onDone={props.onDone} />;
  }
  if (r.kind === 'many') {
    return (
      <Panel
        label="Several items"
        foot={
          <button type="button" class="btn" onClick={props.onDone}>
            Scan again
          </button>
        }
      >
        <h2 class="h2">{plural(r.items.length, 'item')} have this barcode</h2>
        <div class="mono code-big">{r.code}</div>
        <p class="m0">Choose the one in your hand.</p>
        <div class="picks">
          {r.items.map((i) => (
            <PickRow key={i.id} item={i} on={false} onClick={() => props.onPick(i)} />
          ))}
        </div>
      </Panel>
    );
  }
  if (r.kind === 'missing-label') return <MissingPanel id={r.id} onDone={props.onDone} />;
  if (r.kind === 'location') return <LocationPanel snap={props.snap} location={r.location} onPick={props.onPick} onDone={props.onDone} />;
  if (r.kind === 'unknown' && couldBeLocation(r.text, props.format)) {
    return <NoLocationPanel text={r.text} code={r.code} snap={props.snap} onDone={props.onDone} onAttach={props.onAttach} onLocation={props.onLocation} onRename={props.onRename} />;
  }
  if (r.kind === 'unknown') {
    return (
      <Panel
        label="Unknown code"
        foot={
          <>
            <button type="button" class="btn pri lg" onClick={() => props.onAttach(r.code)}>
              Attach to an existing item
            </button>
            <a class="btn" href={href.add('', r.code)}>
              <Icon name="plus" />
              Add a new item with this barcode
            </a>
            <button type="button" class="btn" onClick={props.onDone}>
              Scan again
            </button>
          </>
        }
      >
        <div class="dlg-head">
          <span class="dlg-ic gray">
            <Icon name="help" />
          </span>
          <h2 class="h2">Not in the inventory yet</h2>
        </div>
        <div class="mono code-big">{r.code}</div>
        <div class="small muted">{formatName(props.format)} · no item has this code</div>
        <p class="m0">If this is a part you already track, attach the barcode to it so the next scan opens it straight away.</p>
      </Panel>
    );
  }
  return null;
}

function MissingPanel({ id, onDone }: { id: string; onDone: () => void }) {
  return (
    <Panel
      label="Label for a missing item"
      foot={
        <button type="button" class="btn pri lg" onClick={onDone}>
          Scan again
        </button>
      }
    >
      <div class="dlg-head">
        <span class="dlg-ic gray">
          <Icon name="help" />
        </span>
        <h2 class="h2">This label’s item isn’t here</h2>
      </div>
      <div class="mono code-big">{id}</div>
      <p class="m0">The item may have been deleted, or this tablet was restored from an older backup. Print a new label from the item’s card if it still exists.</p>
    </Panel>
  );
}

function FoundPanel({ item, by, onDone }: { item: Item; by: string; onDone: () => void }) {
  const db = useDb();
  const [adding, setAdding] = useState(false);
  const photo = usePhoto(item.id, item.hasPhoto);
  const vendor = item.vendors[item.preferredVendor - 1];
  const meta = [item.location || 'No location', vendor ? `${vendor.supplier} ${vendor.partNo}`.trim() : ''].filter(Boolean).join(' · ');
  const fail = (e: unknown) => showToast(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
  return (
    <Panel
      label="Item found"
      foot={
        <>
          <button type="button" class="btn pri lg" data-autofocus onClick={onDone}>
            Done — scan next
          </button>
          <a class="btn" href={href.item(item.id)}>
            Open full details
          </a>
          <button type="button" class="btn" onClick={() => setAdding(true)}>
            <Icon name="listAdd" />
            Add to order list
          </button>
        </>
      }
    >
      <div class="small muted found-by">
        <Icon name="check" />
        {by}
      </div>
      <div class="found-head">
        {photo ? (
          <img class="found-ph" src={photo.url} alt="" />
        ) : (
          <span class="found-ph nophoto">
            <Icon name="photo" class="ic lg" />
          </span>
        )}
        <div class="found-t">
          <h2 class="h2">{item.name}</h2>
          <div class="small muted">{meta}</div>
        </div>
      </div>
      <div class="found-st">
        <StatusChip status={itemStatus(item)} />
        <span class="small muted">
          Desired {item.desired} · spares {item.spares}
        </span>
      </div>
      <div class="found-oh">
        <span class="lbl">On hand ({item.unit})</span>
        <span class="small muted">Took some? Tap − once for each one you took.</span>
        <CountStepper
          label="On hand"
          size="xl"
          value={item.onHand}
          itemName={item.name}
          onStep={(d) => void adjustCount(db, item.id, 'onHand', d).catch(fail)}
          onSet={(n) =>
            setCount(db, item.id, 'onHand', n).catch((e: unknown) => {
              fail(e);
              throw e;
            })
          }
        />
      </div>
      {adding && <AddToListDialog item={item} onClose={() => setAdding(false)} />}
    </Panel>
  );
}

function PickRow({ item, on, onClick, sub }: { item: Item; on: boolean; onClick: () => void; sub?: string }) {
  const photo = usePhoto(item.id, item.hasPhoto);
  return (
    <button type="button" class={on ? 'pick on' : 'pick'} aria-pressed={on} onClick={onClick}>
      {photo ? <img src={photo.url} alt="" /> : <span class="pick-ph nophoto" />}
      <span class="pick-t">
        <strong>{item.name}</strong>
        <span class="small muted">{sub ?? `${item.category} · ${item.barcode ? `barcode ${item.barcode}` : 'no barcode yet'}`}</span>
      </span>
    </button>
  );
}

/** A bin's QR code (F29): the items in that location, and the inventory filtered to it. */
function LocationPanel(props: { snap: InventorySnapshot; location: Location; onPick: (item: Item) => void; onDone: () => void }) {
  const key = nameKey(props.location.name);
  const items = props.snap.items.filter((i) => nameKey(i.location) === key).sort((a, b) => a.name.localeCompare(b.name));
  const show = () => {
    // Only this location: other filters and the search are cleared (the search isn't kept).
    saveFilters({ ...NO_FILTERS, location: props.location.name });
    location.hash = href.tab('inventory');
  };
  return (
    <Panel
      label="Location found"
      foot={
        <>
          {items.length > 0 && (
            <button type="button" class="btn pri lg" onClick={show}>
              <Icon name="inventory" />
              Show in Inventory
            </button>
          )}
          <button type="button" class={items.length > 0 ? 'btn' : 'btn pri lg'} data-autofocus onClick={props.onDone}>
            Scan again
          </button>
        </>
      }
    >
      <div class="small muted found-by">
        <Icon name="pin" />
        Location
      </div>
      <h2 class="h2">{props.location.name}</h2>
      <div class="small muted">
        {items.length ? plural(items.length, 'item') : 'No items here yet'}
        {props.location.notes ? ` · ${props.location.notes}` : ''}
      </div>
      {items.length > 0 && (
        <div class="loc-res">
          <p class="m0">Tap an item to change its on-hand amount.</p>
          <div class="picks">
            {items.map((i) => (
              <PickRow key={i.id} item={i} on={false} sub={`On hand ${i.onHand} ${i.unit} · desired ${i.desired}`} onClick={() => props.onPick(i)} />
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

/** "Location not found" (F29): add the scanned name, rename a location to it, or treat it as an item code. */
function NoLocationPanel(props: {
  text: string;
  code: string;
  snap: InventorySnapshot;
  onDone: () => void;
  onAttach: (code: string) => void;
  onLocation: (location: Location) => void;
  onRename: (text: string) => void;
}) {
  const db = useDb();
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const l = await addLocation(db, props.text);
      showToast(`Added location “${l.name}”.`);
      props.onLocation(l);
    } catch (e) {
      setBusy(false);
      showToast(e instanceof Error ? e.message : String(e));
    }
  };
  const rename = async () => {
    if (await gate('Renaming a location needs the mentor PIN.')) props.onRename(props.text);
  };
  return (
    <Panel
      label="Location not found"
      foot={
        <>
          <button type="button" class="btn pri lg" disabled={busy} onClick={() => void add()}>
            <Icon name="plus" />
            Add “{props.text}” as a location
          </button>
          {props.snap.locations.length > 0 && (
            <button type="button" class="btn" disabled={busy} onClick={() => void rename()}>
              Rename a location to “{props.text}”…
              <PinMark />
            </button>
          )}
          <button type="button" class="btn" disabled={busy} onClick={() => props.onAttach(props.code)}>
            Attach to an existing item
          </button>
          <a class="btn" href={href.add('', props.code)}>
            Add a new item with this code
          </a>
          <button type="button" class="btn" disabled={busy} onClick={props.onDone}>
            Scan again
          </button>
        </>
      }
    >
      <div class="dlg-head">
        <span class="dlg-ic gray">
          <Icon name="pin" />
        </span>
        <h2 class="h2">Location not found</h2>
      </div>
      <div class="code-big loc-text">{props.text}</div>
      <p class="m0">No location or item has this code. If it’s the QR code on a bin or shelf, add it as a location, or rename an existing location to match it.</p>
    </Panel>
  );
}

/** Rename an existing location to the scanned name (F29; F25 rename, the PIN was given). */
function RenamePanel(props: { text: string; locations: readonly Location[]; onBack: () => void; onRenamed: (location: Location) => void }) {
  const db = useDb();
  const [from, setFrom] = useState(props.locations[0]?.name ?? '');
  const [busy, setBusy] = useState(false);
  useCloseOnRelock(true, props.onBack);
  const chosen = props.locations.find((l) => l.name === from) ?? null;
  const rename = async () => {
    if (!chosen || busy) return;
    setBusy(true);
    try {
      await updateLocation(db, chosen.name, props.text, chosen.notes);
      showToast(`Renamed “${chosen.name}” to “${props.text}”.`);
      props.onRenamed({ ...chosen, name: props.text });
    } catch (e) {
      setBusy(false);
      showToast(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Panel
      label="Rename a location"
      foot={
        <>
          <button type="button" class="btn pri lg" disabled={!chosen || busy} onClick={() => void rename()}>
            Rename {chosen ? `“${chosen.name}”` : ''}
          </button>
          <button type="button" class="btn" disabled={busy} onClick={props.onBack}>
            Back
          </button>
        </>
      }
    >
      <h2 class="h2">Rename a location to “{props.text}”</h2>
      <p class="m0">Items in that location follow the new name.</p>
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
    </Panel>
  );
}

function AttachPanel(props: { snap: InventorySnapshot; code: string; onBack: () => void; onAttached: (item: Item) => void }) {
  const db = useDb();
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const matches = useMemo(() => (q.trim() ? props.snap.items.filter((i) => matchesQuery(i, q)).slice(0, 20) : []), [q, props.snap.items]);
  const item = props.snap.items.find((i) => i.id === chosen) ?? null;

  const attach = async () => {
    if (!item || busy) return;
    setBusy(true);
    try {
      const saved = await setBarcode(db, item.id, props.code);
      showToast(`Barcode attached to “${saved.name}”.`);
      props.onAttached(saved);
    } catch (e) {
      setBusy(false);
      showToast(`Couldn't attach: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <Panel
      label="Attach barcode"
      foot={
        <>
          <button type="button" class="btn pri lg" disabled={!item || busy} onClick={() => void attach()}>
            {item ? (item.barcode ? `Replace the barcode on ${item.name}` : `Attach to ${item.name}`) : 'Choose an item'}
          </button>
          <button type="button" class="btn" onClick={props.onBack}>
            Back
          </button>
        </>
      }
    >
      <h2 class="h2">Attach {props.code} to…</h2>
      <input class="field" type="search" aria-label="Find the item" autoFocus autoComplete="off" placeholder="Find the item — name, part #, supplier" value={q} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
      <div class="picks">
        {matches.map((i) => (
          <PickRow key={i.id} item={i} on={i.id === chosen} onClick={() => setChosen(i.id)} />
        ))}
        {q.trim() !== '' && matches.length === 0 && <p class="muted m0">No items match. Try another word.</p>}
      </div>
      {item?.barcode && <p class="small muted m0">This item already has barcode {item.barcode}; attaching replaces it.</p>}
    </Panel>
  );
}
