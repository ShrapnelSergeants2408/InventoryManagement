// Scan (F21; mockups 5a–5f): the camera reads a team QR label (2408:<id>) or a stored
// manufacturer barcode and opens that item with the On-hand stepper. A code can be typed
// instead (torn label, no camera). An unknown code can be attached to an item or used for a
// new one. No PIN anywhere here (§6).
import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { adjustCount, setCount, type InventorySnapshot } from '../../../data/inventory';
import { setBarcode } from '../../../data/items';
import { resolveScan, formatName, type ScanResult } from '../../../domain/scan';
import { matchesQuery } from '../../../domain/search';
import { stockStatus } from '../../../domain/status';
import type { Item } from '../../../domain/types';
import { StatusChip, plural } from '../../components/common';
import { CountStepper } from '../../components/OnHandStepper';
import { Scanner, type CameraState } from '../../components/Scanner';
import { useDb, usePhoto, useSnapshot } from '../../data-hooks';
import { Icon } from '../../icons';
import { LockPill } from '../../shell/LockPill';
import { href } from '../../shell/router';
import { showToast } from '../../shell/toast';
import { AddToListDialog } from '../order/ListDialogs';
import { StorageError } from '../StorageError';

type Panel =
  | { kind: 'none' }
  | { kind: 'typing' }
  | { kind: 'result'; result: ScanResult; format: string | null }
  | { kind: 'attach'; code: string; format: string | null };

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
    const result = resolveScan(code, snap.items);
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
          <div class="chint">{camera === 'starting' ? 'Starting the camera…' : 'Point at a QR label or a barcode — it scans by itself'}</div>
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
          onAttach={(code) => setPanel({ kind: 'attach', code, format: panel.format })}
          onPick={(item) => setPanel({ kind: 'result', result: { kind: 'item', item, via: 'barcode', code: panel.result.kind === 'many' ? panel.result.code : '' }, format: panel.format })}
        />
      )}
      {panel.kind === 'attach' && (
        <AttachPanel
          snap={snap}
          code={panel.code}
          onBack={() => setPanel({ kind: 'result', result: { kind: 'unknown', code: panel.code }, format: panel.format })}
          onAttached={(item) => setPanel({ kind: 'result', result: { kind: 'item', item, via: 'barcode', code: panel.code }, format: panel.format })}
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
}) {
  const r = props.result;
  if (r.kind === 'item') {
    // The live item, so the stepper shows saved changes.
    const item = props.snap.items.find((i) => i.id === r.item.id);
    if (!item) return <MissingPanel id={r.item.id} onDone={props.onDone} />;
    const by = r.via === 'label' ? `QR label ${r.code}` : r.via === 'id' ? `Typed ID ${item.id}` : `${formatName(props.format)} ${r.code}`;
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
        <StatusChip status={stockStatus(item.onHand, item.desired, item.spares)} />
        <span class="small muted">
          Desired {item.desired} · spares {item.spares}
        </span>
      </div>
      <div>
        <span class="lbl">On hand ({item.unit}) — took some? tap −</span>
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

function PickRow({ item, on, onClick }: { item: Item; on: boolean; onClick: () => void }) {
  const photo = usePhoto(item.id, item.hasPhoto);
  return (
    <button type="button" class={on ? 'pick on' : 'pick'} aria-pressed={on} onClick={onClick}>
      {photo ? <img src={photo.url} alt="" /> : <span class="pick-ph nophoto" />}
      <span class="pick-t">
        <strong>{item.name}</strong>
        <span class="small muted">
          {item.category} · {item.barcode ? `barcode ${item.barcode}` : 'no barcode yet'}
        </span>
      </span>
    </button>
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
