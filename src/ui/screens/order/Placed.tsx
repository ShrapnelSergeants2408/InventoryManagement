// Placed orders (F30, F31, §21): one order's page with Receive… (no PIN), Edit, Cancel /
// Un-cancel, Delete and receipts (PIN). The list of orders is the order history (History.tsx, §21.5).
import { useEffect, useState } from 'preact/hooks';
import { addReceipt, deleteOrder, getReceipt, receiveOrder, removeReceipt, setCancelled } from '../../../data/placed-orders';
import { formatIsoDate, localIsoDate } from '../../../domain/dates';
import { formatCents } from '../../../domain/money';
import {
  MAX_RECEIPTS,
  STATUS_LABEL,
  isOpen,
  lineDue,
  lineTotalCents,
  lineUnits,
  orderStatus,
  orderTotals,
  overdueDays,
  percentText,
  receiveProblem,
  receivedAnything,
  type OrderStatus,
  type PlacedOrder,
  type ReceiptRef,
} from '../../../domain/placed-orders';
import { gate } from '../../../security/gate';
import { Dialog, DialogActions } from '../../components/Dialog';
import { BackButton, PinMark, StateMessage, TopBar, plural } from '../../components/common';
import { useDb, useOrders, useSettings, useSnapshot } from '../../data-hooks';
import { Icon } from '../../icons';
import { href, replaceRoute } from '../../shell/router';
import { useCloseOnRelock } from '../../shell/LockPill';
import { showToast } from '../../shell/toast';
import { StorageError } from '../StorageError';
import { OrderForm, ReceiptButtons, prepareReceipt } from './OrderForm';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const STATUS_CHIP: Record<OrderStatus, string> = { placed: 'chip open', 'partly received': 'chip lock', received: 'chip ok', cancelled: 'chip mut' };

export function StatusBadge({ order }: { order: PlacedOrder }) {
  const s = orderStatus(order);
  return <span class={STATUS_CHIP[s]}>{STATUS_LABEL[s]}</span>;
}

/** "Overdue · 18 days" (v0.17), in the attention style; nothing when `days` is null. */
export function OverdueChip({ days }: { days: number | null }) {
  if (days === null) return null;
  return (
    <span class="chip att">
      <Icon name="clock" />
      Overdue · {days} days
    </span>
  );
}

type Dlg = 'receive' | 'edit' | 'cancel' | 'delete' | { view: ReceiptRef } | { remove: ReceiptRef } | null;

export function PlacedOrderScreen({ id }: { id: string }) {
  const db = useDb();
  const live = useOrders();
  const snap = useSnapshot();
  const settings = useSettings();
  const [dlg, setDlg] = useState<Dlg>(null);
  const [busy, setBusy] = useState(false);
  const back = <BackButton fallback={href.placed} />;
  if (live.state === 'error') {
    return (
      <>
        <TopBar title="Order" back={back} />
        <StorageError error={live.error} />
      </>
    );
  }
  if (live.state === 'loading') {
    return (
      <>
        <TopBar title="Loading…" back={back} />
        <div class="state" aria-busy="true">
          <p class="state-text muted">Loading order…</p>
        </div>
      </>
    );
  }
  const order = live.value.find((o) => o.id === id);
  if (!order) {
    return (
      <>
        <TopBar title="Order not found" back={back} />
        <StateMessage
          icon="truck"
          title="This order isn’t here"
          actions={
            <a class="btn pri" href={href.placed}>
              All placed orders
            </a>
          }
        >
          <p class="state-text">It was deleted, or this tablet was restored from a backup without it.</p>
        </StateMessage>
      </>
    );
  }
  const status = orderStatus(order);
  const t = orderTotals(order);
  const itemIds = new Set(snap.state === 'ready' ? snap.value.items.map((i) => i.id) : []);
  const pinThen = async (reason: string, then: () => void) => {
    if (await gate(reason)) then();
  };
  const addOne = async (input: HTMLInputElement, kind: 'photo' | 'pdf') => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!(await gate('Adding a receipt needs the PIN.'))) return;
    setBusy(true);
    try {
      const r = await prepareReceipt(file, kind);
      await addReceipt(db, order.id, r.blob, r.type);
      showToast('Receipt added.');
    } catch (e) {
      showToast(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <TopBar
        title={`${order.supplier} · ${formatIsoDate(order.placedOn)}`}
        kicker="Placed order"
        back={back}
        actions={
          isOpen(order) && (
            <button type="button" class="btn pri" onClick={() => setDlg('receive')}>
              <Icon name="truck" />
              Receive…
            </button>
          )
        }
      />
      <div class="po-page">
        <div class="po-head">
          <StatusBadge order={order} />
          <OverdueChip days={overdueDays(order, localIsoDate(), settings.overdueDays)} />
          <span class="small muted">
            {[order.orderNo && `Order # ${order.orderNo}`, order.payment && `Paid by ${order.payment}`, order.funding && `From ${order.funding} funds`, order.fromList && `From ${order.fromList}`].filter(Boolean).join(' · ') || 'No order # or payment recorded'}
          </span>
          <span class="grow" />
          <button type="button" class="btn" onClick={() => void pinThen('Editing an order needs the PIN.', () => setDlg('edit'))}>
            <Icon name="pencil" />
            Edit
            <PinMark />
          </button>
          {status === 'cancelled' ? (
            <button
              type="button"
              class="btn"
              disabled={busy}
              onClick={() =>
                void pinThen('Un-cancelling an order needs the PIN.', () => {
                  setCancelled(db, order.id, false).then(() => showToast('The order is open again.'), (e: unknown) => showToast(message(e)));
                })
              }
            >
              Un-cancel
              <PinMark />
            </button>
          ) : (
            !receivedAnything(order) && (
              <button type="button" class="btn" onClick={() => void pinThen('Cancelling an order needs the PIN.', () => setDlg('cancel'))}>
                Cancel order…
                <PinMark />
              </button>
            )
          )}
          <button type="button" class="btn danger" onClick={() => void pinThen('Deleting an order needs the PIN.', () => setDlg('delete'))}>
            <Icon name="trash" />
            Delete…
            <PinMark />
          </button>
        </div>
        {order.notes && <p class="po-notes">{order.notes}</p>}

        <div class="po-lines" role="table" aria-label="Lines">
          <div class="po-l po-lh" role="row">
            <span role="columnheader">Item</span>
            <span role="columnheader" class="r">Ordered</span>
            <span role="columnheader" class="r">Pack price</span>
            <span role="columnheader" class="r">Line total</span>
            <span role="columnheader" class="r">Received</span>
          </div>
          {order.lines.map((l, i) => {
            const gone = l.itemId !== '' && snap.state === 'ready' && !itemIds.has(l.itemId);
            return (
              <div key={i} class="po-l" role="row">
                <span role="cell" class="po-ln">
                  {l.itemId && !gone ? (
                    <a href={href.item(l.itemId)} class="lt">
                      {l.description}
                    </a>
                  ) : (
                    <span class="lt">{l.description}</span>
                  )}
                  <span class="small muted">
                    {[l.partNo, l.category || (l.itemId ? '' : 'Typed line'), gone && 'item deleted'].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span role="cell" class="n" data-l="Ordered">
                  {l.packSize > 1 ? `${l.packs} × ${l.packSize} = ${lineUnits(l)}` : lineUnits(l)} <span class="unit">{l.unit}</span>
                </span>
                <span role="cell" class="n" data-l="Pack price">
                  {formatCents(l.packPriceCents)}
                </span>
                <span role="cell" class="n" data-l="Line total">
                  {formatCents(lineTotalCents(l))}
                </span>
                <span role="cell" class="n" data-l="Received">
                  {l.received} of {lineUnits(l)}
                </span>
              </div>
            );
          })}
        </div>

        <dl class="po-sum">
          <div>
            <dt>Parts</dt>
            <dd>{formatCents(t.partsCents)}</dd>
          </div>
          <div>
            <dt>Discount{order.discount.kind === '%' && order.discount.value > 0 ? ` (${percentText(order.discount.value)}%)` : ''}</dt>
            <dd>−{formatCents(t.discountCents)}</dd>
          </div>
          <div>
            <dt>Tax</dt>
            <dd>{formatCents(t.taxCents)}</dd>
          </div>
          <div>
            <dt>Shipping</dt>
            <dd>{formatCents(t.shippingCents)}</dd>
          </div>
          <div>
            <dt>Other fees</dt>
            <dd>{formatCents(t.feesCents)}</dd>
          </div>
          <div class="po-sum-t">
            <dt>Total</dt>
            <dd>{formatCents(t.totalCents)}</dd>
          </div>
        </dl>

        <section class="po-rc" aria-label="Receipts">
          <h2 class="h2">Receipts</h2>
          {order.receipts.length === 0 && <p class="small muted">No receipts yet.</p>}
          <ul class="of-rlist">
            {order.receipts.map((r, i) => (
              <li key={r.id}>
                <Icon name={r.type === 'application/pdf' ? 'note' : 'photo'} />
                <span class="grow">
                  Receipt {i + 1} · {r.type === 'application/pdf' ? 'PDF' : 'photo'}
                </span>
                <button type="button" class="btn sm" onClick={() => setDlg({ view: r })}>
                  View
                </button>
                <button type="button" class="btn sm" onClick={() => void pinThen('Removing a receipt needs the PIN.', () => setDlg({ remove: r }))}>
                  Remove
                  <PinMark />
                </button>
              </li>
            ))}
          </ul>
          {order.receipts.length < MAX_RECEIPTS ? <ReceiptButtons disabled={busy} onPick={(i, k) => void addOne(i, k)} /> : <p class="small muted">{MAX_RECEIPTS} receipts: the most an order can have.</p>}
          {busy && <span class="small muted" role="status">Preparing the receipt…</span>}
        </section>
      </div>

      {dlg === 'receive' && <ReceiveDialog order={order} itemIds={snap.state === 'ready' ? itemIds : null} onClose={() => setDlg(null)} />}
      {dlg === 'edit' && <OrderForm mode="edit" order={order} onClose={() => setDlg(null)} />}
      {dlg === 'cancel' && <CancelDialog order={order} onClose={() => setDlg(null)} />}
      {dlg === 'delete' && <DeleteDialog order={order} onClose={() => setDlg(null)} />}
      {dlg && typeof dlg === 'object' && 'view' in dlg && <ReceiptView receipt={dlg.view} onClose={() => setDlg(null)} />}
      {dlg && typeof dlg === 'object' && 'remove' in dlg && <RemoveReceiptDialog order={order} receipt={dlg.remove} onClose={() => setDlg(null)} />}
    </>
  );
}

/** F31: received now per line, defaulting to what's still due; Receive all; then a confirmation. */
function ReceiveDialog({ order, itemIds, onClose }: { order: PlacedOrder; itemIds: ReadonlySet<string> | null; onClose: () => void }) {
  const db = useDb();
  const [amounts, setAmounts] = useState(() => order.lines.map((l) => lineDue(l)));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const problem = receiveProblem(order, amounts);
  // Only lines whose item still exists add to on hand; the rest are just marked received (F31).
  const stocks = (i: number) => order.lines[i]!.itemId !== '' && (itemIds === null || itemIds.has(order.lines[i]!.itemId));
  const toStock = order.lines.map((_, i) => i).filter((i) => stocks(i) && amounts[i]! > 0);
  const units = toStock.reduce((n, i) => n + amounts[i]!, 0);
  const set = (i: number, v: number) => setAmounts((a) => a.map((x, j) => (j === i ? Math.max(0, Math.min(lineDue(order.lines[i]!), v)) : x)));
  const receive = async () => {
    setBusy(true);
    try {
      const r = await receiveOrder(db, order.id, amounts);
      showToast(r.units > 0 ? `Received: added ${r.units} to on hand for ${plural(r.items, 'item')}.` : 'Marked as received.');
      onClose();
    } catch (e) {
      setBusy(false);
      showToast(`Couldn’t receive: ${message(e)}`);
    }
  };
  if (confirming) {
    return (
      <Dialog label="Add to on hand?" role="alertdialog" onClose={() => !busy && setConfirming(false)}>
        <h2 class="h2">{units > 0 ? `Add ${units} to on hand for ${plural(new Set(toStock.map((i) => order.lines[i]!.itemId)).size, 'item')}?` : 'Mark these lines received?'}</h2>
        <ul class="notes-list">
          {order.lines.map((l, i) =>
            amounts[i]! > 0 ? (
              <li key={i}>
                {l.description}: {stocks(i) ? `+${amounts[i]} ${l.unit} on hand` : `${amounts[i]} received (${l.itemId ? 'item deleted' : 'typed line'}, no inventory change)`}
              </li>
            ) : null,
          )}
        </ul>
        <p class="dlg-p small muted">Receiving can’t be undone with a button. If a number is wrong, fix on hand on the item and the received amount with Edit.</p>
        <DialogActions>
          <button type="button" class="btn lg" disabled={busy} onClick={() => setConfirming(false)}>
            Back
          </button>
          <button type="button" class="btn pri lg" data-autofocus disabled={busy} onClick={() => void receive()}>
            <Icon name="check" />
            {units > 0 ? `Add ${units} to on hand` : 'Mark received'}
          </button>
        </DialogActions>
      </Dialog>
    );
  }
  return (
    <Dialog label="Receive" onClose={onClose}>
      <h2 class="h2">Receive: {order.supplier}</h2>
      <p class="small muted">How many of each arrived now. Each stepper starts at what’s still due.</p>
      <div class="rc-lines">
        {order.lines.map((l, i) => {
          const due = lineDue(l);
          return (
            <div key={i} class="rc-line">
              <span class="grow">
                <span class="lt">{l.description}</span>
                <span class="small muted">
                  Ordered {lineUnits(l)} · received {l.received} · due {due}
                  {l.itemId === '' ? ' · typed line' : stocks(i) ? '' : ' · item deleted'}
                </span>
              </span>
              <div class="stepper-row" role="group" aria-label={`Received now: ${l.description}`}>
                <button type="button" class="step" aria-label={`One fewer ${l.description}`} disabled={amounts[i]! <= 0} onClick={() => set(i, amounts[i]! - 1)}>
                  <Icon name="minus" />
                </button>
                <input class="field n rc-n" inputMode="numeric" aria-label={`Received now: ${l.description}`} value={String(amounts[i])} disabled={due === 0} onInput={(e) => set(i, Number((e.currentTarget as HTMLInputElement).value.replace(/\D/g, '') || 0))} />
                <button type="button" class="step" aria-label={`One more ${l.description}`} disabled={amounts[i]! >= due} onClick={() => set(i, amounts[i]! + 1)}>
                  <Icon name="plus" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {problem && amounts.every((a) => a === 0) && <p class="small muted">{problem}</p>}
      <DialogActions>
        <button type="button" class="btn lg" onClick={() => setAmounts(order.lines.map((l) => lineDue(l)))}>
          Receive all
        </button>
        <button type="button" class="btn lg" onClick={onClose}>
          Cancel
        </button>
        <button type="button" class="btn pri lg" disabled={!!problem} onClick={() => setConfirming(true)}>
          Next
        </button>
      </DialogActions>
    </Dialog>
  );
}

function CancelDialog({ order, onClose }: { order: PlacedOrder; onClose: () => void }) {
  const db = useDb();
  const [busy, setBusy] = useState(false);
  useCloseOnRelock(!busy, onClose);
  return (
    <Dialog label="Cancel this order?" role="alertdialog" onClose={() => !busy && onClose()}>
      <h2 class="h2">Cancel the {order.supplier} order?</h2>
      <p class="dlg-p">It stays in the history marked cancelled, its parts stop showing as on order, and it no longer counts toward spending. You can un-cancel it later.</p>
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
            setCancelled(db, order.id, true).then(
              () => {
                showToast(`Cancelled the ${order.supplier} order.`);
                onClose();
              },
              (e: unknown) => {
                setBusy(false);
                showToast(message(e));
              },
            );
          }}
        >
          Cancel order
        </button>
      </DialogActions>
    </Dialog>
  );
}

function DeleteDialog({ order, onClose }: { order: PlacedOrder; onClose: () => void }) {
  const db = useDb();
  const [busy, setBusy] = useState(false);
  return (
    <Dialog label="Delete this order?" role="alertdialog" onClose={() => !busy && onClose()}>
      <h2 class="h2">
        Delete the {order.supplier} order of {formatIsoDate(order.placedOn)}, {formatCents(orderTotals(order).totalCents)}?
      </h2>
      <p class="dlg-p">
        The order and its {plural(order.receipts.length, 'receipt')} are removed from the history and from spending. Parts already received stay in on hand. The only way back
        is restoring a backup made before now.
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
            void (async () => {
              if (!(await gate('Deleting an order needs the PIN.'))) return setBusy(false);
              try {
                await deleteOrder(db, order.id);
                showToast(`Deleted the ${order.supplier} order.`);
                onClose();
                replaceRoute(href.placed);
              } catch (e) {
                setBusy(false);
                showToast(message(e));
              }
            })();
          }}
        >
          <Icon name="trash" />
          Delete order
        </button>
      </DialogActions>
    </Dialog>
  );
}

function RemoveReceiptDialog({ order, receipt, onClose }: { order: PlacedOrder; receipt: ReceiptRef; onClose: () => void }) {
  const db = useDb();
  const [busy, setBusy] = useState(false);
  useCloseOnRelock(!busy, onClose);
  return (
    <Dialog label="Remove this receipt?" role="alertdialog" onClose={() => !busy && onClose()}>
      <h2 class="h2">Remove receipt {order.receipts.indexOf(receipt) + 1}?</h2>
      <p class="dlg-p">The {receipt.type === 'application/pdf' ? 'PDF' : 'photo'} is deleted from this tablet. The order stays.</p>
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
            removeReceipt(db, order.id, receipt.id).then(onClose, (e: unknown) => {
              setBusy(false);
              showToast(message(e));
            });
          }}
        >
          <Icon name="trash" />
          Remove
        </button>
      </DialogActions>
    </Dialog>
  );
}

/** A photo full size in a dialog; a PDF opens in the browser's viewer. */
function ReceiptView({ receipt, onClose }: { receipt: ReceiptRef; onClose: () => void }) {
  const db = useDb();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let made: string | null = null;
    getReceipt(db, receipt.id).then(
      (b) => {
        if (!b) return setFailed(true);
        made = URL.createObjectURL(b);
        if (receipt.type === 'application/pdf') {
          window.open(made, '_blank', 'noopener');
          onClose();
        } else setUrl(made);
      },
      () => setFailed(true),
    );
    // A PDF tab still needs its URL, so only a photo's is revoked here.
    return () => void (made && receipt.type !== 'application/pdf' && URL.revokeObjectURL(made));
  }, [receipt.id]);
  return (
    <Dialog label="Receipt" onClose={onClose}>
      {failed ? <p class="dlg-p">This receipt couldn’t be read.</p> : url ? <img class="rc-img" src={url} alt="Receipt" /> : <p class="dlg-p muted">Opening…</p>}
      <DialogActions>
        <button type="button" class="btn lg" data-autofocus onClick={onClose}>
          Close
        </button>
      </DialogActions>
    </Dialog>
  );
}
