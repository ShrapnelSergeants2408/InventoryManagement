// The order form (F30, §21.1–§21.4): Mark ordered from one supplier group of an order list, or
// Edit a placed order. Lines come in ticked with the list's packs and the stored price; untick
// what wasn't ordered and change packs, pack size and price to what was charged. + Add line
// adds an inventory item or a typed line. Then the order's own fields and receipts, with the
// total as you type. After a new order is saved: copy changed prices into the catalog (§21.3),
// and offer to delete a named list left empty. PIN to open and again to save (§6).
import { useMemo, useRef, useState } from 'preact/hooks';
import { deleteOrderList } from '../../../data/order-lists';
import { addReceipt, applyPriceChanges, recordOrder, updateOrder, type OrderInput, type RecordResult } from '../../../data/placed-orders';
import { localIsoDate } from '../../../domain/dates';
import { centsToPlain, formatCents, parsePrice } from '../../../domain/money';
import {
  AUTOMATIC_LIST,
  MAX_RECEIPTS,
  MAX_RECEIPT_PDF_BYTES,
  RECEIPT_LONG_SIDE,
  addedItemLine,
  lineTotalCents,
  lineUnits,
  orderProblems,
  orderTotals,
  parsePercent,
  percentText,
  priceChanges,
  typedLine,
  type DiscountKind,
  type DraftLine,
  type PlacedLine,
  type PlacedOrder,
  type PriceChange,
  type ReceiptType,
} from '../../../domain/placed-orders';
import { matchesTerms, queryTerms, searchText } from '../../../domain/search';
import type { Item } from '../../../domain/types';
import { gate } from '../../../security/gate';
import { prepareReceiptPhoto } from '../../../io/image';
import { Dialog, DialogActions } from '../../components/Dialog';
import { PinMark, plural } from '../../components/common';
import { useDb, useSnapshot } from '../../data-hooks';
import { Icon } from '../../icons';
import { showToast } from '../../shell/toast';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** One row of the form: the line as typed, as text, so a half-typed number isn't lost. */
interface Row {
  key: number;
  on: boolean;
  line: PlacedLine;
  packs: string;
  packSize: string;
  price: string;
  received: string;
  /** null: no price was stored, so one must be typed. */
  storedPriceCents: number | null;
  /** Added in this form (+ Add line): removed with ✕ instead of unticked. */
  added: boolean;
}

const whole = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN);
const cents = (s: string) => {
  const p = parsePrice(s);
  return p.ok && p.cents !== null ? p.cents : NaN;
};
const amount = (s: string) => (s.trim() === '' ? 0 : cents(s));

let nextKey = 1;
const toRow = (d: DraftLine, added = false, on = true): Row => ({
  key: nextKey++,
  on,
  line: d.line,
  packs: String(d.line.packs),
  packSize: String(d.line.packSize),
  // No stored price, or a new typed line: blank, so the price charged must be typed.
  price: d.storedPriceCents === null || (added && !d.line.itemId) ? '' : centsToPlain(d.line.packPriceCents),
  received: String(d.line.received),
  storedPriceCents: d.storedPriceCents,
  added,
});

/** The line as the form has it: NaN where a number can't be read, so the checks name it. */
function rowLine(r: Row): PlacedLine {
  return { ...r.line, packs: whole(r.packs), packSize: whole(r.packSize), packPriceCents: cents(r.price), received: whole(r.received) };
}

export type OrderFormProps =
  | { mode: 'new'; supplier: string; lines: DraftLine[]; from: { listId: string; name: string } | null; onClose: () => void }
  | { mode: 'edit'; order: PlacedOrder; onClose: () => void };

type Phase = { kind: 'form' } | { kind: 'prices'; result: RecordResult; changed: PriceChange[]; unchanged: PriceChange[] } | { kind: 'emptyList'; result: RecordResult };

export function OrderForm(props: OrderFormProps) {
  const db = useDb();
  const live = useSnapshot();
  const items = live.state === 'ready' ? live.value.items : [];
  const editing = props.mode === 'edit' ? props.order : null;
  const supplier = editing ? editing.supplier : (props as { supplier: string }).supplier;
  const [rows, setRows] = useState<Row[]>(() => (editing ? editing.lines.map((line) => toRow({ line, storedPriceCents: line.packPriceCents })) : (props as { lines: DraftLine[] }).lines.map((d) => toRow(d))));
  const [placedOn, setPlacedOn] = useState(editing?.placedOn ?? localIsoDate());
  const [orderNo, setOrderNo] = useState(editing?.orderNo ?? '');
  const [payment, setPayment] = useState(editing?.payment ?? '');
  const [tax, setTax] = useState(editing ? centsToPlain(editing.taxCents) : '');
  const [shipping, setShipping] = useState(editing ? centsToPlain(editing.shippingCents) : '');
  const [fees, setFees] = useState(editing ? centsToPlain(editing.feesCents) : '');
  const [discountKind, setDiscountKind] = useState<DiscountKind>(editing?.discount.kind ?? '$');
  const [discount, setDiscount] = useState(editing && editing.discount.value > 0 ? (editing.discount.kind === '$' ? centsToPlain(editing.discount.value) : percentText(editing.discount.value)) : '');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [receipts, setReceipts] = useState<{ blob: Blob; type: ReceiptType; name: string }[]>([]);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  const [adding, setAdding] = useState(false);

  const ticked = rows.filter((r) => r.on);
  const input: OrderInput = {
    supplier,
    placedOn,
    orderNo: orderNo.trim(),
    payment: payment.trim(),
    taxCents: amount(tax),
    shippingCents: amount(shipping),
    feesCents: amount(fees),
    discount: { kind: discountKind, value: discount.trim() === '' ? 0 : discountKind === '$' ? cents(discount) : (parsePercent(discount) ?? NaN) },
    notes: notes.trim(),
    fromList: editing ? editing.fromList : ((props as { from: { name: string } | null }).from?.name ?? AUTOMATIC_LIST),
    lines: ticked.map(rowLine),
  };
  const problems = orderProblems(input);
  const lineProblem = (r: Row, field: 'description' | 'packs' | 'packSize' | 'packPriceCents' | 'received') => {
    const at = ticked.indexOf(r);
    return problems.find((p) => typeof p.field === 'object' && p.field.line === at && p.field.field === field)?.message ?? null;
  };
  const fieldProblem = (f: string) => problems.find((p) => p.field === f)?.message ?? null;
  const totalsOk = !problems.some((p) => typeof p.field === 'object' && p.field.field !== 'description' && p.field.field !== 'received') && !['discount', 'taxCents', 'shippingCents', 'feesCents'].some((f) => fieldProblem(f));
  const totals = totalsOk ? orderTotals(input) : null;

  const setRow = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const save = async () => {
    setTried(true);
    if (problems.length > 0) return;
    if (!(await gate(editing ? 'Editing an order needs the PIN.' : 'Recording an order needs the PIN.'))) return;
    setBusy('Saving…');
    setError(null);
    try {
      if (editing) {
        await updateOrder(db, editing.id, input);
        showToast(`Saved the ${supplier} order.`);
        props.onClose();
        return;
      }
      const from = (props as { from: { listId: string } | null }).from;
      const result = await recordOrder(db, input, from ? { listId: from.listId } : null);
      let order = result.order;
      for (const r of receipts) order = await addReceipt(db, order.id, r.blob, r.type);
      const done = { ...result, order };
      const pc = priceChanges(order, items);
      if (pc.changed.length > 0 || pc.unchanged.length > 0) setPhase({ kind: 'prices', result: done, ...pc });
      else finish(done);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };

  const finish = (result: RecordResult) => {
    showToast(`Recorded the ${supplier} order: ${formatCents(orderTotals(result.order).totalCents)}. It’s in Order › Placed orders.`);
    if (result.list && result.list.linesLeft === 0) setPhase({ kind: 'emptyList', result });
    else props.onClose();
  };

  if (phase.kind === 'prices') return <PriceCopy phase={phase} onDone={() => finish(phase.result)} />;
  if (phase.kind === 'emptyList') return <EmptyListOffer result={phase.result} onClose={props.onClose} />;

  const title = editing ? `Edit ${supplier} order` : `Mark ordered: ${supplier}`;
  const show = (p: string | null) => (tried && p ? <div class="err small">{p}</div> : null);
  return (
    <Dialog label={title} wide onClose={() => !busy && props.onClose()}>
      <h2 class="h2">{title}</h2>
      <p class="small muted">
        {editing
          ? 'Change anything that was wrong. Editing never changes on-hand counts or order lists.'
          : 'Untick lines that weren’t ordered, and change packs, pack size and price to what the supplier charged.'}
      </p>
      <div class="of-lines" role="group" aria-label="Lines">
        <div class={editing ? 'of-row of-h ed' : 'of-row of-h'} aria-hidden="true">
          <span />
          <span>Item</span>
          <span>Packs</span>
          <span>Pack size</span>
          <span>Pack price</span>
          {editing && <span>Received</span>}
          <span class="r">Line total</span>
        </div>
        {rows.map((r) => {
          const l = rowLine(r);
          const total = Number.isFinite(lineTotalCents(l)) ? formatCents(lineTotalCents(l)) : '—';
          const locked = r.line.received > 0;
          return (
            <div key={r.key} class={`${editing ? 'of-row ed' : 'of-row'}${r.on ? '' : ' off'}`}>
              {r.added ? (
                <button type="button" class="ib" aria-label={`Remove ${r.line.description || 'this line'}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                  <Icon name="close" />
                </button>
              ) : (
                <label class="of-tick" title={locked ? 'Parts on this line were received' : undefined}>
                  <input type="checkbox" checked={r.on} disabled={locked} aria-label={`Ordered: ${r.line.description}`} onChange={(e) => setRow(r.key, { on: (e.currentTarget as HTMLInputElement).checked })} />
                </label>
              )}
              <span class="of-name">
                {r.line.itemId ? (
                  <>
                    <span class="lt">{r.line.description}</span>
                    <span class="small muted">{[r.line.partNo, r.line.unit].filter(Boolean).join(' · ')}</span>
                  </>
                ) : (
                  <>
                    <input class="field sm" aria-label="Description" placeholder="What was ordered, e.g. Team shirts" value={r.line.description} onInput={(e) => setRow(r.key, { line: { ...r.line, description: (e.currentTarget as HTMLInputElement).value } })} />
                    <span class="small muted">Typed line · doesn’t change inventory</span>
                  </>
                )}
                {r.on && show(lineProblem(r, 'description'))}
                {r.on && r.storedPriceCents === null && r.line.itemId && <span class="chip np">No stored price — enter the price charged</span>}
              </span>
              <span data-l="Packs">
                <input class="field sm n" inputMode="numeric" aria-label={`Packs of ${r.line.description}`} disabled={!r.on} value={r.packs} onInput={(e) => setRow(r.key, { packs: (e.currentTarget as HTMLInputElement).value })} />
                {r.on && show(lineProblem(r, 'packs'))}
              </span>
              <span data-l="Pack size">
                <input class="field sm n" inputMode="numeric" aria-label={`Pack size of ${r.line.description}`} disabled={!r.on || !r.line.itemId} value={r.packSize} onInput={(e) => setRow(r.key, { packSize: (e.currentTarget as HTMLInputElement).value })} />
                {r.on && show(lineProblem(r, 'packSize'))}
              </span>
              <span data-l="Pack price">
                <input class="field sm n" inputMode="decimal" aria-label={`Pack price of ${r.line.description}`} placeholder="$" disabled={!r.on} value={r.price} onInput={(e) => setRow(r.key, { price: (e.currentTarget as HTMLInputElement).value })} />
                {r.on && show(lineProblem(r, 'packPriceCents'))}
              </span>
              {editing && (
                <span data-l="Received">
                  <input class="field sm n" inputMode="numeric" aria-label={`Received of ${r.line.description}`} disabled={!r.on} value={r.received} onInput={(e) => setRow(r.key, { received: (e.currentTarget as HTMLInputElement).value })} />
                  {r.on && show(lineProblem(r, 'received'))}
                </span>
              )}
              <span class="n of-total">
                {r.on ? total : <span class="small muted">not ordered</span>}
                {r.on && Number.isFinite(lineUnits(l)) && l.packSize > 1 && <span class="small muted"> {lineUnits(l)} {r.line.unit}</span>}
              </span>
            </div>
          );
        })}
        {show(fieldProblem('lines'))}
        <div class="of-add">
          <button type="button" class="btn" onClick={() => setAdding(true)}>
            <Icon name="plus" />
            Add an inventory item
          </button>
          <button type="button" class="btn" onClick={() => setRows((rs) => [...rs, toRow({ line: typedLine('', 1, 0), storedPriceCents: 0 }, true)])}>
            <Icon name="pencil" />
            Add a typed line
          </button>
        </div>
      </div>

      <div class="of-fields">
        <label>
          <span class="lbl">Placed on</span>
          <input class="field" type="date" value={placedOn} max={localIsoDate()} onInput={(e) => setPlacedOn((e.currentTarget as HTMLInputElement).value)} />
          {show(fieldProblem('placedOn'))}
        </label>
        <label>
          <span class="lbl">
            Order / invoice # <span class="lbl-opt">(optional)</span>
          </span>
          <input class="field" value={orderNo} autoComplete="off" onInput={(e) => setOrderNo((e.currentTarget as HTMLInputElement).value)} />
        </label>
        <label>
          <span class="lbl">
            Payment / PO <span class="lbl-opt">(optional)</span>
          </span>
          <input class="field" value={payment} placeholder="e.g. PO 2408-17, team card" autoComplete="off" onInput={(e) => setPayment((e.currentTarget as HTMLInputElement).value)} />
        </label>
        <MoneyField label="Tax" value={tax} onInput={setTax} problem={tried ? fieldProblem('taxCents') : null} />
        <MoneyField label="Shipping" value={shipping} onInput={setShipping} problem={tried ? fieldProblem('shippingCents') : null} />
        <MoneyField label="Other fees" value={fees} onInput={setFees} problem={tried ? fieldProblem('feesCents') : null} />
        <div>
          <span class="lbl">Discount</span>
          <div class="of-disc">
            <div class="seg" role="group" aria-label="Discount in dollars or percent">
              {(['$', '%'] as const).map((k) => (
                <button key={k} type="button" class={discountKind === k ? 'segb on' : 'segb'} aria-pressed={discountKind === k} onClick={() => setDiscountKind(k)}>
                  {k}
                </button>
              ))}
            </div>
            <input class="field n" inputMode="decimal" aria-label={discountKind === '$' ? 'Discount in dollars' : 'Discount in percent'} placeholder={discountKind === '$' ? '0.00' : '0'} value={discount} onInput={(e) => setDiscount((e.currentTarget as HTMLInputElement).value)} />
          </div>
          {show(fieldProblem('discount'))}
        </div>
        <label class="of-notes">
          <span class="lbl">
            Notes <span class="lbl-opt">(optional)</span>
          </span>
          <textarea class="field" rows={2} value={notes} onInput={(e) => setNotes((e.currentTarget as HTMLTextAreaElement).value)} />
        </label>
      </div>

      {!editing && <ReceiptPicker receipts={receipts} onChange={setReceipts} />}

      <div class="of-totals" role="status">
        {totals ? (
          <>
            <span>Parts {formatCents(totals.partsCents)}</span>
            {totals.discountCents > 0 && <span>− discount {formatCents(totals.discountCents)}</span>}
            {totals.taxCents > 0 && <span>+ tax {formatCents(totals.taxCents)}</span>}
            {totals.shippingCents > 0 && <span>+ shipping {formatCents(totals.shippingCents)}</span>}
            {totals.feesCents > 0 && <span>+ fees {formatCents(totals.feesCents)}</span>}
            <strong class="of-grand">Total {formatCents(totals.totalCents)}</strong>
          </>
        ) : (
          <span class="muted">The total shows once every number can be read.</span>
        )}
      </div>
      {tried && problems.length > 0 && (
        <div class="err" role="alert">
          <Icon name="low" /> {plural(problems.length, 'thing')} to fix before saving.
        </div>
      )}
      {error && (
        <div class="err" role="alert">
          {error}
        </div>
      )}
      <DialogActions>
        <button type="button" class="btn lg" disabled={!!busy} onClick={props.onClose}>
          Cancel
        </button>
        <button type="button" class="btn pri lg" disabled={!!busy || ticked.length === 0} onClick={() => void save()}>
          <Icon name="check" />
          {busy ?? (editing ? 'Save changes' : `Record order (${plural(ticked.length, 'line')})`)}
          <PinMark />
        </button>
      </DialogActions>
      {adding && (
        <AddItemLine
          items={items}
          onPick={(item) => {
            setRows((rs) => [...rs, toRow(addedItemLine(item, supplier), true)]);
            setAdding(false);
          }}
          onClose={() => setAdding(false)}
        />
      )}
    </Dialog>
  );
}

function MoneyField(props: { label: string; value: string; onInput: (v: string) => void; problem: string | null }) {
  return (
    <label>
      <span class="lbl">{props.label}</span>
      <input class="field n" inputMode="decimal" placeholder="0.00" value={props.value} onInput={(e) => props.onInput((e.currentTarget as HTMLInputElement).value)} />
      {props.problem && <div class="err small">{props.problem}</div>}
    </label>
  );
}

/** + Add line for an inventory item: search by name, part # or barcode. */
function AddItemLine(props: { items: readonly Item[]; onPick: (item: Item) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const terms = queryTerms(query);
  const found = useMemo(() => (terms.length === 0 ? [] : props.items.filter((i) => matchesTerms(`${searchText(i)} ${i.barcode}`, terms)).slice(0, 8)), [props.items, query]);
  return (
    <Dialog label="Add an inventory item" onClose={props.onClose}>
      <h2 class="h2">Add an inventory item</h2>
      <input class="field" type="search" aria-label="Search items" placeholder="Name, part # or barcode…" value={query} autoComplete="off" onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)} />
      <div class="of-found">
        {found.map((i) => (
          <button key={i.id} type="button" class="btn of-pick" onClick={() => props.onPick(i)}>
            <span class="lt">{i.name}</span>
            <span class="small muted">
              {i.category}
              {i.subcategory ? ` › ${i.subcategory}` : ''}
            </span>
          </button>
        ))}
        {terms.length > 0 && found.length === 0 && <p class="small muted">No item matches. Use a typed line for things that aren’t in the inventory.</p>}
      </div>
      <DialogActions>
        <button type="button" class="btn lg" onClick={props.onClose}>
          Cancel
        </button>
      </DialogActions>
    </Dialog>
  );
}

/** Receipts while recording (§21.2): kept here and saved with the order. */
function ReceiptPicker(props: { receipts: { blob: Blob; type: ReceiptType; name: string }[]; onChange: (r: { blob: Blob; type: ReceiptType; name: string }[]) => void }) {
  const [busy, setBusy] = useState(false);
  const full = props.receipts.length >= MAX_RECEIPTS;
  const pick = async (input: HTMLInputElement, kind: 'photo' | 'pdf') => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const r = await prepareReceipt(file, kind);
      props.onChange([...props.receipts, { ...r, name: file.name || (kind === 'pdf' ? 'receipt.pdf' : 'photo') }]);
    } catch (e) {
      showToast(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="of-rcpt">
      <span class="lbl">
        Receipts <span class="lbl-opt">(optional, up to {MAX_RECEIPTS})</span>
      </span>
      <ReceiptButtons disabled={busy || full} onPick={(i, k) => void pick(i, k)} />
      {busy && <span class="small muted" role="status">Preparing the receipt…</span>}
      {props.receipts.length > 0 && (
        <ul class="of-rlist">
          {props.receipts.map((r, i) => (
            <li key={i}>
              <Icon name={r.type === 'application/pdf' ? 'note' : 'photo'} />
              <span class="grow">{r.name}</span>
              <button type="button" class="btn sm" onClick={() => props.onChange(props.receipts.filter((_, j) => j !== i))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Take photo / Choose photo / Choose PDF, as hidden inputs inside labels (as PhotoButtons). */
export function ReceiptButtons(props: { disabled: boolean; onPick: (input: HTMLInputElement, kind: 'photo' | 'pdf') => void }) {
  const cls = props.disabled ? 'btn disabled' : 'btn';
  return (
    <div class="pacts">
      <label class={cls} aria-disabled={props.disabled}>
        <input type="file" accept="image/*" capture="environment" class="vh" disabled={props.disabled} onChange={(e) => props.onPick(e.currentTarget as HTMLInputElement, 'photo')} data-receipt="camera" />
        <Icon name="camera" />
        Take photo
      </label>
      <label class={cls} aria-disabled={props.disabled}>
        <input type="file" accept="image/*" class="vh" disabled={props.disabled} onChange={(e) => props.onPick(e.currentTarget as HTMLInputElement, 'photo')} data-receipt="gallery" />
        <Icon name="gallery" />
        Choose photo
      </label>
      <label class={cls} aria-disabled={props.disabled}>
        <input type="file" accept="application/pdf,.pdf" class="vh" disabled={props.disabled} onChange={(e) => props.onPick(e.currentTarget as HTMLInputElement, 'pdf')} data-receipt="pdf" />
        <Icon name="note" />
        Choose PDF
      </label>
    </div>
  );
}

/** A picked file as a stored receipt: a photo shrunk to about 1600 px, a PDF as it is (≤ 5 MB). */
export async function prepareReceipt(file: File, kind: 'photo' | 'pdf'): Promise<{ blob: Blob; type: ReceiptType }> {
  if (kind === 'pdf') {
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    if (String.fromCharCode(...head) !== '%PDF-') throw new Error('That file isn’t a PDF.');
    if (file.size > MAX_RECEIPT_PDF_BYTES) throw new Error(`That PDF is ${(file.size / 1024 / 1024).toFixed(1)} MB. Receipts can be up to 5 MB.`);
    return { blob: new Blob([file], { type: 'application/pdf' }), type: 'application/pdf' };
  }
  return { blob: await prepareReceiptPhoto(file, RECEIPT_LONG_SIDE), type: 'image/jpeg' };
}

/** §21.3: tick the prices to copy into the catalog. */
function PriceCopy({ phase, onDone }: { phase: Extract<Phase, { kind: 'prices' }>; onDone: () => void }) {
  const db = useDb();
  const order = phase.result.order;
  const [off, setOff] = useState<Set<string>>(new Set());
  const [checkUnchanged, setCheckUnchanged] = useState(true);
  const [busy, setBusy] = useState(false);
  const done = useRef(false);
  const apply = async () => {
    setBusy(true);
    try {
      if (!(await gate('Changing catalog prices needs the PIN.'))) return;
      const n = await applyPriceChanges(db, order.supplier, phase.changed.filter((c) => !off.has(c.itemId)), checkUnchanged ? phase.unchanged : [], order.placedOn);
      if (n > 0) showToast(`Updated ${plural(n, 'vendor option')} for ${order.supplier}.`);
      done.current = true;
      onDone();
    } catch (e) {
      showToast(`Couldn’t update the prices: ${message(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const size = (n: number) => (n > 1 ? ` / pack of ${n}` : '');
  return (
    <Dialog label="Update catalog prices?" onClose={() => !busy && onDone()}>
      <h2 class="h2">Update catalog prices?</h2>
      <p class="dlg-p">The order is saved. {phase.changed.length > 0 ? `These ${order.supplier} prices differ from what was charged.` : `Every ${order.supplier} price matched the catalog.`}</p>
      {phase.changed.length > 0 && (
        <ul class="pc-list">
          {phase.changed.map((c) => (
            <li key={c.itemId}>
              <label class="tick">
                <input type="checkbox" checked={!off.has(c.itemId)} onChange={(e) => setOff((s) => { const n = new Set(s); if ((e.currentTarget as HTMLInputElement).checked) n.delete(c.itemId); else n.add(c.itemId); return n; })} />
                <span>
                  <strong>{c.name}</strong>: {c.fromPriceCents === null ? 'no price' : formatCents(c.fromPriceCents)}
                  {size(c.fromPackSize)} → {formatCents(c.toPriceCents)}
                  {size(c.toPackSize)}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {phase.unchanged.length > 0 && (
        <label class="tick">
          <input type="checkbox" checked={checkUnchanged} onChange={(e) => setCheckUnchanged((e.currentTarget as HTMLInputElement).checked)} />
          <span>Also mark the {plural(phase.unchanged.length, 'unchanged price')} as checked on {order.placedOn}</span>
        </label>
      )}
      <DialogActions>
        <button type="button" class="btn lg" disabled={busy} onClick={onDone}>
          Skip
        </button>
        <button type="button" class="btn pri lg" data-autofocus disabled={busy} onClick={() => void apply()}>
          Update prices
          <PinMark />
        </button>
      </DialogActions>
    </Dialog>
  );
}

/** A named list left empty after Mark ordered offers to delete itself (F27). */
function EmptyListOffer({ result, onClose }: { result: RecordResult; onClose: () => void }) {
  const db = useDb();
  const [busy, setBusy] = useState(false);
  const list = result.list!;
  return (
    <Dialog label="The list is empty now" onClose={() => !busy && onClose()}>
      <h2 class="h2">“{list.name}” is empty now</h2>
      <p class="dlg-p">Everything on it was ordered. Delete the list, or keep it to add to later.</p>
      <DialogActions>
        <button type="button" class="btn lg" data-autofocus disabled={busy} onClick={onClose}>
          Keep the list
        </button>
        <button
          type="button"
          class="btn danger lg"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            deleteOrderList(db, list.id).then(
              () => {
                showToast(`Deleted the list “${list.name}”.`);
                location.hash = '#/order';
                onClose();
              },
              (e: unknown) => {
                setBusy(false);
                showToast(`Couldn’t delete the list: ${message(e)}`);
              },
            );
          }}
        >
          <Icon name="trash" />
          Delete this list
        </button>
      </DialogActions>
    </Dialog>
  );
}
