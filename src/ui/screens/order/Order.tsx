// Order list (F12): every item to order, grouped by preferred supplier with subtotals and a
// grand total; stale-price flags and banner (F14); count-in banner; CSV export (F13); search,
// with "Export shown lines only" (F12, SPEC v0.8). Named order lists (F27) sit beside the
// automatic one: the same layout, plus +/− and remove per line, and rename, duplicate, delete.
// Select on the automatic list puts checkboxes on lines and supplier headers, to add many at once.
// Units on open placed orders are subtracted (§4) and shown per line; each supplier group has
// Mark ordered… (F30), and the History tab lists what was ordered (§21.5).
import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { duplicateOrderList, removeLine, setLineQuantity } from '../../../data/order-lists';
import { formatIsoDate, localIsoDate } from '../../../domain/dates';
import { formatCents } from '../../../domain/money';
import { buildOrderList, filterOrderList, type OrderLine, type OrderList } from '../../../domain/order';
import { buildNamedOrder, stepQuantity, type NamedOrderList } from '../../../domain/order-lists';
import { selectState, withIds } from '../../../domain/selection';
import { orderAlerts, priceAge, staleLabel } from '../../../domain/stale';
import { nameKey, type Supplier } from '../../../domain/types';
import { safeHref } from '../../../domain/url';
import { Dialog, DialogActions } from '../../components/Dialog';
import { CheckBox, StateMessage, TopBar, plural } from '../../components/common';
import { SelectBar } from '../../components/SelectBar';
import { useDb, useOnOrder, useOrderLists, useSettings, useSnapshot, useThumbnail } from '../../data-hooks';
import { Icon } from '../../icons';
import { href } from '../../shell/router';
import { showToast } from '../../shell/toast';
import { StorageError } from '../StorageError';
import { ExportDialog } from './ExportDialog';
import { AddManyDialog, DeleteListDialog, ListInfoDialog } from './ListDialogs';
import { PriceRefreshDialog } from './PriceRefreshDialog';
import { OrderForm } from './OrderForm';
import { draftLines, type DraftLine } from '../../../domain/placed-orders';
import { gate } from '../../../security/gate';
import { PinMark } from '../../components/common';

/** +/− and remove on a named list's lines (F27). */
interface LineEdit {
  onStep: (l: OrderLine, deltaPacks: number) => void;
  onRemove: (l: OrderLine) => void;
}

/** Checkboxes on the automatic list's lines (F27 "Add many at once"). */
interface LineSelect {
  selected: ReadonlySet<string>;
  set: (ids: readonly string[], on: boolean) => void;
}

/** A supplier header's checkbox: every line of that supplier shown, some, or none. */
function SupplierCheck({ ids, select, children }: { ids: string[]; select: LineSelect; children: ComponentChildren }) {
  const state = selectState(ids, select.selected);
  return (
    <button type="button" class="cb" role="checkbox" aria-checked={state === 'on' ? 'true' : state === 'some' ? 'mixed' : 'false'} onClick={() => select.set(ids, state !== 'on')}>
      <CheckBox state={state} />
      {children}
    </button>
  );
}

/** `listId`: a named list (F27), or null for the automatic list (F12). */
export function OrderScreen({ listId }: { listId: string | null }) {
  const db = useDb();
  const live = useSnapshot();
  const liveLists = useOrderLists();
  const settings = useSettings();
  const onOrder = useOnOrder();
  const [marking, setMarking] = useState<{ supplier: string; lines: DraftLine[] } | null>(null);
  const [exporting, setExporting] = useState<'all' | 'shown' | null>(null);
  const [query, setQuery] = useState('');
  const [refreshHelp, setRefreshHelp] = useState(false);
  const [listDlg, setListDlg] = useState<'new' | 'edit' | 'delete' | null>(null);
  const [removing, setRemoving] = useState<OrderLine | null>(null);
  // Select mode on the automatic list (F27 "Add many at once"): checkboxes on lines and supplier headers.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const today = localIsoDate();
  const snap = live.state === 'ready' ? live.value : null;
  const lists = liveLists.state === 'ready' ? liveLists.value : null;
  const named: NamedOrderList | null = (listId !== null && lists?.find((l) => l.id === listId)) || null;
  const missing = listId !== null && lists !== null && !named;
  const list = useMemo(() => (snap ? (named ? buildNamedOrder(named, snap.items) : listId === null ? buildOrderList(snap.items, onOrder) : null) : null), [snap, named, listId, onOrder]);
  const shown = useMemo(() => (list ? filterOrderList(list, query) : null), [list, query]);
  const searching = !!list && !!shown && shown !== list;
  const alerts = useMemo(() => (snap && list ? orderAlerts(list, snap.items, today, settings.staleDays) : null), [snap, list, today, settings.staleDays]);
  // Only lines still on the automatic list stay selected (a count can change while selecting).
  const lineIds = useMemo(() => (list ? list.groups.flatMap((g) => g.lines.map((l) => l.item.id)) : []), [list]);
  const shownIds = useMemo(() => (shown ? shown.groups.flatMap((g) => g.lines.map((l) => l.item.id)) : []), [shown]);
  const selected = useMemo(() => new Set(lineIds.filter((id) => picked.has(id))), [lineIds, picked]);
  const select: LineSelect | null = selecting ? { selected, set: (ids, on) => setPicked(withIds(selected, ids, on)) } : null;
  const endSelect = () => {
    setSelecting(false);
    setPicked(new Set());
  };

  const fail = (e: unknown) => showToast(`Couldn't change the list: ${e instanceof Error ? e.message : String(e)}`);
  const edit: LineEdit | null = named
    ? {
        onStep: (l, d) => void setLineQuantity(db, named.id, l.item.id, stepQuantity(l.need, l.vendor.packSize, d)).catch(fail),
        onRemove: (l) => setRemoving(l),
      }
    : null;
  const duplicate = async () => {
    if (!named) return;
    try {
      const copy = await duplicateOrderList(db, named.id);
      showToast(`Made a copy: “${copy.name}”.`);
      location.hash = href.orderList(copy.id);
    } catch (e) {
      fail(e);
    }
  };

  const empty = !!list && list.lineCount === 0;
  const top = (
    <TopBar title={named ? named.name : 'Order list'} subtitle={`${named ? 'Named list · grouped' : 'Grouped'} by preferred supplier · ${formatIsoDate(today)}`}>
      <div class="searchwrap">
        <Icon name="search" />
        <input
          class="field"
          type="search"
          aria-label="Search the order list"
          placeholder="Search item, part #, supplier, notes…"
          value={query}
          disabled={!list || empty}
          onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
          autoComplete="off"
          spellcheck={false}
        />
        {query && (
          <button type="button" class="clr" aria-label="Clear search" onClick={() => setQuery('')}>
            <Icon name="close" />
          </button>
        )}
      </div>
      {searching && (
        <button type="button" class="btn" disabled={!shown || shown.lineCount === 0} onClick={() => setExporting('shown')}>
          <Icon name="upload" />
          Export shown lines only
        </button>
      )}
      <button type="button" class="btn pri" disabled={!list || empty} onClick={() => setExporting('all')}>
        <Icon name="upload" />
        Export CSV
      </button>
    </TopBar>
  );
  const tabs = (
    <ListTabs lists={lists ?? []} current={listId} onNew={() => setListDlg('new')}>
      {listId === null &&
        (selecting ? (
          <button type="button" class="ltab sel on" onClick={endSelect}>
            Done
          </button>
        ) : (
          <button type="button" class="ltab sel" disabled={!list || empty} onClick={() => setSelecting(true)}>
            <Icon name="check" />
            Select
          </button>
        ))}
    </ListTabs>
  );
  const dialogs = (
    <>
      {listDlg === 'new' && lists && <ListInfoDialog lists={lists} onClose={() => setListDlg(null)} />}
      {listDlg === 'edit' && named && lists && <ListInfoDialog list={named} lists={lists} onClose={() => setListDlg(null)} />}
      {listDlg === 'delete' && named && <DeleteListDialog list={named} onClose={() => setListDlg(null)} />}
    </>
  );

  if (live.state === 'error' || liveLists.state === 'error') {
    return (
      <>
        {top}
        <StorageError error={live.state === 'error' ? live.error : liveLists.state === 'error' ? liveLists.error : null} />
      </>
    );
  }
  if (missing) {
    return (
      <>
        {top}
        {tabs}
        <StateMessage
          icon="order"
          title="This order list isn’t here"
          actions={
            <a class="btn pri" href={href.tab('order')}>
              Open the automatic list
            </a>
          }
        >
          <p class="state-text">It was deleted, or this tablet was restored from a backup without it.</p>
        </StateMessage>
        {dialogs}
      </>
    );
  }
  if (!snap || !list || !shown || !alerts || !lists) {
    return (
      <>
        {top}
        <div class="state" aria-busy="true">
          <p class="state-text muted">Working out the order list…</p>
        </div>
      </>
    );
  }

  const counted = alerts.totalItems - alerts.uncounted;
  return (
    <>
      {top}
      {tabs}
      {select && (
        <SelectBar
          count={selected.size}
          noun="line"
          hidden={[...selected].filter((id) => !shownIds.includes(id)).length}
          shown={shownIds.length}
          allShown={shownIds.length > 0 && shownIds.every((id) => selected.has(id))}
          onAll={() => setPicked(withIds(selected, shownIds, true))}
          onClear={() => setPicked(new Set())}
        >
          <button type="button" class="btn pri" disabled={selected.size === 0} onClick={() => setAdding(true)}>
            <Icon name="listAdd" />
            Add to order list…
          </button>
        </SelectBar>
      )}
      {named && (
        <div class="lhead">
          <div class="grow lhead-t">
            {named.notes ? <span class="lnotes">{named.notes}</span> : <span class="small muted">No notes</span>}
            <span class="small muted">
              {plural(named.lines.length, 'item')} · a plan only: it never changes counts or the automatic list
            </span>
          </div>
          <button type="button" class="btn" onClick={() => setListDlg('edit')}>
            <Icon name="pencil" />
            Rename / notes
          </button>
          <button type="button" class="btn" onClick={() => void duplicate()}>
            <Icon name="copy" />
            Duplicate
          </button>
          <button type="button" class="btn danger" onClick={() => setListDlg('delete')}>
            <Icon name="trash" />
            Delete list
          </button>
        </div>
      )}
      {!named && alerts.countBanner && (
        <div class="banner" role="status">
          <Icon name="count" />
          <span class="grow">
            Count-in: {counted} of {plural(alerts.totalItems, 'item')} counted. {alerts.uncounted} not counted yet — their on-hand numbers may be wrong (starter items
            begin at 0), so this list may order too much.
          </span>
          <a class="btn onb" href={href.tab('count')}>
            Continue count
          </a>
        </div>
      )}
      {alerts.staleBanner && (
        <div class="banner warm" role="status">
          <Icon name="clock" />
          <span class="grow">
            {alerts.staleLines} of {plural(alerts.pricedLines, 'price')} were checked more than {settings.staleDays} days ago (or have no date). Refresh prices before
            ordering: export a data-only backup, ask Claude to check prices, then import the price update.
          </span>
          <button type="button" class="btn sm" onClick={() => setRefreshHelp(true)}>
            Price refresh steps
          </button>
        </div>
      )}
      {empty && named ? (
        <StateMessage
          icon="listAdd"
          title="No items on this list yet"
          actions={
            <a class="btn" href={href.tab('inventory')}>
              Go to inventory
            </a>
          }
        >
          <p class="state-text">
            Add items with <strong>Add to order list</strong>: from an item’s ⋮ menu in the inventory list, its detail card, or after scanning its label.
          </p>
        </StateMessage>
      ) : empty ? (
        <StateMessage
          icon="check"
          title="Nothing to order"
          actions={
            <a class="btn" href={href.tab('inventory')}>
              Back to inventory
            </a>
          }
        >
          <p class="state-text">
            Every item has at least its desired amount plus spares on hand. Items appear here as soon as a count drops below that, or when you raise a desired amount.
          </p>
        </StateMessage>
      ) : (
        <>
          <Summary list={list} shown={searching ? shown : null} staleLines={alerts.staleLines} staleDays={settings.staleDays} />
          {searching && shown.lineCount === 0 ? (
            <StateMessage
              icon="search"
              title={`No lines match “${query.trim()}”`}
              actions={
                <button type="button" class="btn" onClick={() => setQuery('')}>
                  Clear search
                </button>
              }
            >
              <p class="state-text">The search looks at item names, part numbers, suppliers and notes. Try fewer letters.</p>
            </StateMessage>
          ) : (
            <Lines
              list={shown}
              whole={searching ? list : null}
              suppliers={snap.suppliers}
              today={today}
              staleDays={settings.staleDays}
              edit={edit}
              select={select}
              onOrder={onOrder}
              onMark={(supplier) => {
                // The whole group, not just the lines a search shows.
                const g = list.groups.find((x) => nameKey(x.supplier) === nameKey(supplier));
                if (g) void gate('Recording an order needs the PIN.').then((ok) => ok && setMarking({ supplier: g.supplier, lines: draftLines(g) }));
              }}
            />
          )}
        </>
      )}
      {exporting === 'all' && <ExportDialog list={list} named={named ?? undefined} onClose={() => setExporting(null)} />}
      {exporting === 'shown' && <ExportDialog list={shown} whole={list} query={query} named={named ?? undefined} onClose={() => setExporting(null)} />}
      {refreshHelp && <PriceRefreshDialog onClose={() => setRefreshHelp(false)} />}
      {removing && named && (
        <RemoveLineDialog
          line={removing}
          listName={named.name}
          onClose={() => setRemoving(null)}
          onRemove={() => removeLine(db, named.id, removing.item.id).then(() => setRemoving(null), fail)}
        />
      )}
      {adding && selected.size > 0 && (
        <AddManyDialog
          chosen={snap.items.filter((i) => selected.has(i.id))}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            endSelect();
          }}
        />
      )}
      {marking && <OrderForm mode="new" supplier={marking.supplier} lines={marking.lines} from={named ? { listId: named.id, name: named.name } : null} onClose={() => setMarking(null)} />}
      {dialogs}
    </>
  );
}

/**
 * Automatic, then each named list A–Z, then History (placed orders, §21.5), then "+ New list" (F27, when
 * `onNew` is given); `children` at the end (Select). `current`: a list id, null (Automatic) or 'placed'.
 */
export function ListTabs({ lists, current, onNew, children }: { lists: readonly NamedOrderList[]; current: string | null; onNew?: () => void; children?: ComponentChildren }) {
  return (
    <nav class="ltabs" aria-label="Order lists">
      <a class={current === null ? 'ltab on' : 'ltab'} href={href.tab('order')} aria-current={current === null ? 'page' : undefined}>
        <Icon name="order" />
        Automatic
      </a>
      {lists.map((l) => (
        <a key={l.id} class={current === l.id ? 'ltab on' : 'ltab'} href={href.orderList(l.id)} aria-current={current === l.id ? 'page' : undefined}>
          {l.name}
          <span class="ltab-n">{l.lines.length}</span>
        </a>
      ))}
      <a class={current === 'placed' ? 'ltab po on' : 'ltab po'} href={href.placed} aria-current={current === 'placed' ? 'page' : undefined}>
        <Icon name="truck" />
        History
      </a>
      {onNew && (
        <button type="button" class="ltab new" onClick={onNew}>
          <Icon name="plus" />
          New list
        </button>
      )}
      {children}
    </nav>
  );
}

function RemoveLineDialog(props: { line: OrderLine; listName: string; onClose: () => void; onRemove: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog label="Remove from list" role="alertdialog" onClose={() => !busy && props.onClose()}>
      <h2 class="h2">
        Remove “{props.line.item.name}” from {props.listName}?
      </h2>
      <p class="dlg-p">Only the line is removed. The item and its counts stay as they are.</p>
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
            void props.onRemove();
          }}
        >
          <Icon name="trash" />
          Remove
        </button>
      </DialogActions>
    </Dialog>
  );
}

/** With a search (`shown`), the whole list's grand total stays, next to the lines shown and their total (F12). */
function Summary({ list, shown, staleLines, staleDays }: { list: OrderList; shown: OrderList | null; staleLines: number; staleDays: number }) {
  return (
    <div class="sum">
      <div class="tile big">
        <span class="k">Grand total</span>
        <span class="v">{formatCents(list.grandTotalCents)}</span>
      </div>
      {shown ? (
        <>
          <div class="tile" role="status">
            <span class="k">Showing</span>
            <span class="v">
              {shown.lineCount} of {plural(list.lineCount, 'line')}
            </span>
          </div>
          <div class="tile">
            <span class="k">Total shown</span>
            <span class="v">{formatCents(shown.grandTotalCents)}</span>
          </div>
        </>
      ) : (
        <div class="tile">
          <span class="k">Lines</span>
          <span class="v">{list.lineCount}</span>
        </div>
      )}
      <div class="tile">
        <span class="k">Suppliers</span>
        <span class="v">{shown ? `${shown.groups.length} of ${list.groups.length}` : list.groups.length}</span>
      </div>
      <div class="tile chips">
        <span class="chip np">{list.noPriceCount === 1 ? '1 without price' : `${list.noPriceCount} without price`}</span>
        <span class="chip stale">
          <Icon name="clock" />
          {staleLines} stale (&gt;{staleDays} days)
        </span>
      </div>
    </div>
  );
}

function Lines(props: {
  list: OrderList;
  whole: OrderList | null;
  suppliers: Supplier[];
  today: string;
  staleDays: number;
  edit: LineEdit | null;
  select: LineSelect | null;
  onOrder: ReadonlyMap<string, number>;
  onMark: (supplier: string) => void;
}) {
  const select = props.select;
  const sites = new Map(props.suppliers.map((s) => [nameKey(s.name), safeHref(s.website)]));
  const grid = props.edit ? 'ogrid ed' : 'ogrid';
  return (
    <div class="olist">
      <div class={`${grid} colh`} aria-hidden="true">
        <span>Item</span>
        <span>Part #</span>
        <span class="r">{props.edit ? 'Wanted' : 'Need'}</span>
        <span class="r">Pack</span>
        <span class="r">Packs</span>
        <span class="r">Order qty</span>
        <span class="r">Pack price</span>
        <span class="r">Line total</span>
        {props.edit && <span class="r">Packs ±</span>}
      </div>
      {props.list.groups.map((g) => {
        const site = sites.get(nameKey(g.supplier));
        return (
          <section key={g.supplier} aria-label={`${g.supplier}: ${plural(g.lines.length, 'line')}, subtotal ${formatCents(g.subtotalCents)}`}>
            <div class="shdr">
              {select ? (
                <SupplierCheck ids={g.lines.map((l) => l.item.id)} select={select}>
                  <h2 class="oname">{g.supplier}</h2>
                </SupplierCheck>
              ) : (
                <h2 class="oname">{g.supplier}</h2>
              )}
              {site && (
                <a class="ib" href={site} target="_blank" rel="noopener noreferrer" aria-label={`Open the ${g.supplier} website`}>
                  <Icon name="external" />
                </a>
              )}
              <span class="small muted grow">
                {plural(g.lines.length, 'line')}
                {g.noPriceCount > 0 && ` · ${g.noPriceCount} without price (not in subtotal)`}
              </span>
              <span class="subtotal">{formatCents(g.subtotalCents)}</span>
              {!select && (
                <button type="button" class="btn sm" onClick={() => props.onMark(g.supplier)}>
                  <Icon name="truck" />
                  Mark ordered…
                  <PinMark />
                </button>
              )}
            </div>
            {g.lines.map((l) => (
              <Line key={l.item.id} l={l} today={props.today} staleDays={props.staleDays} grid={grid} edit={props.edit} select={select} onOrder={props.onOrder.get(l.item.id) ?? 0} />
            ))}
          </section>
        );
      })}
      <div class="gt">
        <span class="muted">
          {props.list.noPriceCount > 0 ? `${plural(props.list.noPriceCount, 'item')} without prices not included` : 'Every line has a price'}
          {props.whole && ` · Grand total of the whole list ${formatCents(props.whole.grandTotalCents)}`}
        </span>
        <span class="gt-v">
          {props.whole ? 'Total shown' : 'Grand total'} {formatCents(props.list.grandTotalCents)}
        </span>
      </div>
    </div>
  );
}

function Line(props: { l: OrderLine; today: string; staleDays: number; grid: string; edit: LineEdit | null; select: LineSelect | null; onOrder: number }) {
  const { l, today, staleDays, grid, edit, select, onOrder } = props;
  const thumb = useThumbnail(l.item.id, l.item.hasPhoto);
  const v = l.vendor;
  const stale = staleLabel(priceAge(v, today, staleDays));
  const price = v.packPriceCents === null ? 'No price' : formatCents(v.packPriceCents);
  const total = l.lineTotalCents === null ? '—' : formatCents(l.lineTotalCents);
  const packsText = v.packSize > 1 ? `${l.packs} × pack of ${v.packSize}` : `${l.packs} × 1`;
  const on = select?.selected.has(l.item.id) ?? false;
  const name = (
    <>
      {select && <CheckBox state={on ? 'on' : 'off'} />}
      {thumb ? <img src={thumb} alt="" /> : <span class="nophoto" />}
      <span class="lname-t">
        <span class="lt">{l.item.name}</span>
        {(stale || v.packPriceCents === null || onOrder > 0) && (
          <span class="lchips">
            {onOrder > 0 && (
              <span class="chip onord">
                <Icon name="truck" />
                On order {onOrder}
              </span>
            )}
            {stale && (
              <span class="chip stale">
                <Icon name="clock" />
                {stale}
              </span>
            )}
            {v.packPriceCents === null && <span class="chip np">NO PRICE — not in total</span>}
          </span>
        )}
      </span>
    </>
  );
  return (
    <div class={select && on ? `${grid} line picked` : `${grid} line`}>
      {select ? (
        // Select mode: the item's name toggles its checkbox instead of opening the detail card.
        <button type="button" class="lname lsel" role="checkbox" aria-checked={on} onClick={() => select.set([l.item.id], !on)}>
          {name}
        </button>
      ) : (
        <a class="lname" href={href.item(l.item.id)} aria-label={`Open details for ${l.item.name}`}>
          {name}
        </a>
      )}
      <span class="mono wide">{v.partNo}</span>
      <span class="n wide">{l.need}</span>
      <span class="n wide">{v.packSize}</span>
      <span class="n wide">{l.packs}</span>
      <span class="n">
        {l.orderQty}
        <span class="unit"> {l.item.unit}</span>
      </span>
      <span class="n wide">{price}</span>
      <span class="n l wide">{total}</span>
      <span class="pmeta">
        {v.partNo ? `${v.partNo} · ` : ''}
        {edit ? 'wanted' : 'need'} {l.need} · {packsText} · {price} → {total}
      </span>
      {edit && (
        <span class="lctl">
          <button type="button" class="step sm" aria-label={`One pack fewer of ${l.item.name}`} disabled={l.packs <= 1} onClick={() => edit.onStep(l, -1)}>
            <Icon name="minus" />
          </button>
          <button type="button" class="step sm" aria-label={`One pack more of ${l.item.name}`} onClick={() => edit.onStep(l, +1)}>
            <Icon name="plus" />
          </button>
          <button type="button" class="ib" aria-label={`Remove ${l.item.name} from the list`} onClick={() => edit.onRemove(l)}>
            <Icon name="trash" />
          </button>
        </span>
      )}
    </div>
  );
}
