// Order history (F32, §21.5): the placed orders in a date range, filtered by supplier and
// status, newest first; the spending summary by supplier and by category (cancelled orders
// left out); Export CSV, Export lines CSV and Print summary. Viewing, exporting and printing
// need no PIN (§6). The range is remembered on the device.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { loadHistoryRange, saveHistoryRange, type HistoryRangeChoice } from '../../../data/prefs';
import { formatIsoDate, localIsoDate } from '../../../domain/dates';
import { formatCents } from '../../../domain/money';
import {
  DEFAULT_RANGE,
  RANGE_LABEL,
  STATUS_FILTERS,
  STATUS_FILTER_LABEL,
  filtersText,
  historyOrders,
  matchesStatus,
  offeredRanges,
  rangeDates,
  spendingSummary,
  summaryOrders,
  type DateRange,
  type HistoryFilters,
  type RangeKind,
  type SpendingSummary,
  type StatusFilter,
} from '../../../domain/order-history';
import { orderTotals, type PlacedOrder } from '../../../domain/placed-orders';
import { nameKey, type Category } from '../../../domain/types';
import { categoryRows, historyFileName, serializeHistoryCsv, serializeHistoryLinesCsv, type HistoryExport } from '../../../io/history-csv';
import { shareOrDownload } from '../../../io/share';
import { StateMessage, TopBar, plural } from '../../components/common';
import { useOrderLists, useOrders, useSettings, useSnapshot } from '../../data-hooks';
import { Icon } from '../../icons';
import { href } from '../../shell/router';
import { showToast } from '../../shell/toast';
import { StorageError } from '../StorageError';
import { StatusBadge } from './Placed';
import { ListTabs } from './Order';

type View = 'orders' | 'summary';

/** Suppliers that have orders, each once (named as on its newest order), A–Z. */
function orderSuppliers(orders: readonly PlacedOrder[]): string[] {
  const seen = new Map<string, string>();
  for (const o of orders) if (!seen.has(nameKey(o.supplier))) seen.set(nameKey(o.supplier), o.supplier);
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

export function HistoryScreen() {
  const live = useOrders();
  const lists = useOrderLists();
  const snap = useSnapshot();
  const settings = useSettings();
  const [choice, setChoice] = useState<HistoryRangeChoice>(() => loadHistoryRange());
  const [supplier, setSupplier] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [view, setView] = useState<View>('orders');
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(0);
  const today = localIsoDate();
  const hs = { seasonStart: settings.seasonStart, schoolYearStart: settings.schoolYearStart };
  const offered = offeredRanges(hs);
  // A remembered "This season" whose start was cleared falls back to the default.
  const kind: RangeKind = offered.includes(choice.kind) ? choice.kind : DEFAULT_RANGE;
  const range = rangeDates(kind, today, hs, { from: choice.from, to: choice.to });
  const orders = live.state === 'ready' ? live.value : null;
  const categories: readonly Category[] = snap.state === 'ready' ? snap.value.categories : [];
  const filters: HistoryFilters = { supplier, status };

  const pick = (next: HistoryRangeChoice) => {
    setChoice(next);
    saveHistoryRange(next);
  };

  const suppliers = useMemo(() => (orders ? orderSuppliers(orders) : []), [orders]);
  const shown = useMemo(() => (orders && range ? historyOrders(orders, range, filters) : []), [orders, range?.from, range?.to, supplier, status]);
  const summary = useMemo(() => (orders && range ? spendingSummary(summaryOrders(orders, range, supplier), categories) : null), [orders, range?.from, range?.to, supplier, categories]);
  const counts = useMemo(() => {
    const inRangeOf = orders && range ? historyOrders(orders, range, { supplier, status: 'all' }) : [];
    return Object.fromEntries(STATUS_FILTERS.map((s) => [s, inRangeOf.filter((o) => matchesStatus(o, s)).length])) as Record<StatusFilter, number>;
  }, [orders, range?.from, range?.to, supplier]);

  // After the summary page has rendered, open the browser's print dialog (as for labels, §9).
  useEffect(() => {
    if (printing === 0) return;
    const done = () => setPrinting(0);
    addEventListener('afterprint', done, { once: true });
    print();
    return () => removeEventListener('afterprint', done);
  }, [printing]);

  const exportFile = async (lines: boolean) => {
    if (!range || !summary) return;
    const x: HistoryExport = { kind, range, filters };
    const name = historyFileName(range, lines);
    setBusy(true);
    try {
      const text = lines ? serializeHistoryLinesCsv(x, shown) : serializeHistoryCsv(x, shown, summary);
      const r = await shareOrDownload(new File([text], name, { type: 'text/csv' }), lines ? 'Order lines' : 'Order history');
      if (r !== 'cancelled') showToast(r === 'shared' ? `Shared ${name}.` : `Saved ${name} to Downloads.`);
    } catch (e) {
      showToast(`Couldn’t export: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const spent = summary ? formatCents(summary.total.totalCents) : '';
  const top = (
    <TopBar
      title="Order history"
      subtitle={orders && range && summary ? `${RANGE_LABEL[kind]} · ${plural(summary.total.orders, 'order')} · ${spent} spent` : orders ? RANGE_LABEL[kind] : 'Loading…'}
      actions={
        orders &&
        orders.length > 0 && (
          <>
            <button type="button" class="btn" disabled={busy || !range} onClick={() => void exportFile(false)}>
              <Icon name="upload" />
              Export CSV
            </button>
            <button type="button" class="btn" disabled={busy || !range} onClick={() => void exportFile(true)}>
              <Icon name="upload" />
              Export lines CSV
            </button>
            <button type="button" class="btn" disabled={!range} onClick={() => setPrinting((n) => n + 1)}>
              <Icon name="print" />
              Print summary
            </button>
          </>
        )
      }
    />
  );
  const tabs = <ListTabs lists={lists.state === 'ready' ? lists.value : []} current="placed" />;
  if (live.state === 'error') {
    return (
      <>
        {top}
        <StorageError error={live.error} />
      </>
    );
  }
  if (!orders) {
    return (
      <>
        {top}
        {tabs}
        <div class="state" aria-busy="true">
          <p class="state-text muted">Loading orders…</p>
        </div>
      </>
    );
  }
  if (orders.length === 0) {
    return (
      <>
        {top}
        {tabs}
        <StateMessage
          icon="truck"
          title="No orders recorded yet"
          actions={
            <a class="btn" href={href.tab('order')}>
              Open the order list
            </a>
          }
        >
          <p class="state-text">
            After ordering on a supplier’s site, tap <strong>Mark ordered…</strong> on that supplier’s group in an order list. The order is kept here with its tax,
            shipping and discount, and its parts show as on order until they arrive.
          </p>
        </StateMessage>
      </>
    );
  }

  return (
    <>
      {top}
      {tabs}
      <div class="hi-bar">
        <label class="hi-f">
          <span class="lbl">Dates</span>
          <select class="field" aria-label="Date range" value={kind} onChange={(e) => pick({ ...choice, kind: (e.currentTarget as HTMLSelectElement).value as RangeKind })}>
            {offered.map((k) => (
              <option key={k} value={k}>
                {RANGE_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        {kind === 'custom' && (
          <>
            <label class="hi-f">
              <span class="lbl">From</span>
              <input class="field" type="date" aria-label="From" value={choice.from} max={today} onInput={(e) => pick({ ...choice, from: (e.currentTarget as HTMLInputElement).value })} />
            </label>
            <label class="hi-f">
              <span class="lbl">To</span>
              <input class="field" type="date" aria-label="To" value={choice.to} max={today} onInput={(e) => pick({ ...choice, to: (e.currentTarget as HTMLInputElement).value })} />
            </label>
          </>
        )}
        <label class="hi-f">
          <span class="lbl">Supplier</span>
          <select class="field" aria-label="Supplier" value={supplier ?? ''} onChange={(e) => setSupplier((e.currentTarget as HTMLSelectElement).value || null)}>
            <option value="">Any supplier</option>
            {suppliers.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        {range && (
          <span class="hi-dates small muted">
            {formatIsoDate(range.from)} – {formatIsoDate(range.to)}
          </span>
        )}
      </div>
      {!range ? (
        <p class="state-text muted po-none">Choose the From and To dates.</p>
      ) : (
        <>
          <div class="po-bar">
            <div class="seg" role="group" aria-label="Show">
              <button type="button" class={view === 'orders' ? 'segb on' : 'segb'} aria-pressed={view === 'orders'} onClick={() => setView('orders')}>
                Orders
              </button>
              <button type="button" class={view === 'summary' ? 'segb on' : 'segb'} aria-pressed={view === 'summary'} onClick={() => setView('summary')}>
                Spending summary
              </button>
            </div>
            {view === 'orders' && (
              <div class="seg" role="group" aria-label="Status">
                {STATUS_FILTERS.map((s) => (
                  <button key={s} type="button" class={status === s ? 'segb on' : 'segb'} aria-pressed={status === s} onClick={() => setStatus(s)}>
                    {STATUS_FILTER_LABEL[s]} ({counts[s]})
                  </button>
                ))}
              </div>
            )}
          </div>
          {view === 'orders' ? (
            <div class="olist">
              {shown.length === 0 && <p class="state-text muted po-none">No orders match these dates and filters.</p>}
              {shown.map((o) => (
                <a key={o.id} class="po-row" href={href.placedOrder(o.id)}>
                  <span class="po-date">{formatIsoDate(o.placedOn)}</span>
                  <span class="po-main">
                    <span class="lt">{o.supplier}</span>
                    <span class="small muted">
                      {[o.orderNo && `# ${o.orderNo}`, plural(o.lines.length, 'line'), o.receipts.length > 0 && plural(o.receipts.length, 'receipt')].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <StatusBadge order={o} />
                  <span class={o.cancelled ? 'po-total mut' : 'po-total'}>{formatCents(orderTotals(o).totalCents)}</span>
                  <Icon name="chevRight" />
                </a>
              ))}
            </div>
          ) : (
            summary && (
              <div class="hi-sum">
                <p class="small muted">Every order in these dates{supplier ? ` from ${supplier}` : ''}, whatever its status, except cancelled orders.</p>
                <SummaryTables summary={summary} />
              </div>
            )
          )}
        </>
      )}
      {printing > 0 &&
        range &&
        summary &&
        createPortal(
          <div id="print-root">
            <PrintedSummary kind={kind} range={range} filters={filters} summary={summary} orders={shown} today={today} />
          </div>,
          document.body,
        )}
    </>
  );
}

/** The two summaries (§21.5): by supplier, then by category; both end on the same total. */
function SummaryTables({ summary }: { summary: SpendingSummary }) {
  const t = summary.total;
  if (t.orders === 0) return <p class="state-text muted">Nothing was spent in these dates.</p>;
  const m = formatCents;
  const neg = (c: number) => (c > 0 ? `−${m(c)}` : m(0));
  return (
    <>
      <h2 class="h2">By supplier</h2>
      <div class="hi-tw">
        <table class="hi-t" aria-label="Spending by supplier">
          <thead>
            <tr>
              <th>Supplier</th>
              <th class="r">Orders</th>
              <th class="r">Parts</th>
              <th class="r">Discount</th>
              <th class="r">Tax</th>
              <th class="r">Shipping</th>
              <th class="r">Fees</th>
              <th class="r">Total</th>
            </tr>
          </thead>
          <tbody>
            {[...summary.suppliers, t].map((r) => (
              <tr key={r.supplier} class={r === t ? 'tot' : undefined}>
                <td>{r.supplier}</td>
                <td class="r">{r.orders}</td>
                <td class="r">{m(r.partsCents)}</td>
                <td class="r">{neg(r.discountCents)}</td>
                <td class="r">{m(r.taxCents)}</td>
                <td class="r">{m(r.shippingCents)}</td>
                <td class="r">{m(r.feesCents)}</td>
                <td class="r">{m(r.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 class="h2">By category</h2>
      <div class="hi-tw cat">
        <table class="hi-t" aria-label="Spending by category">
          <tbody>
            {categoryRows(summary).map(([c, cents], i, all) => (
              <tr key={i} class={i === all.length - 1 ? 'tot' : i === summary.categories.length ? 'sep' : undefined}>
                <td>{c}</td>
                <td class="r">{cents < 0 ? `−${m(-cents)}` : m(cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** One printable page (§21.5): title, range, filters, printed date, both summaries, then the orders. */
function PrintedSummary(props: { kind: RangeKind; range: DateRange; filters: HistoryFilters; summary: SpendingSummary; orders: readonly PlacedOrder[]; today: string }) {
  const { range } = props;
  return (
    <div class="psum">
      <h1>FRC 2408 order history</h1>
      <p>
        <strong>{RANGE_LABEL[props.kind]}:</strong> {formatIsoDate(range.from)} – {formatIsoDate(range.to)} · {filtersText(props.filters)} · Printed {formatIsoDate(props.today)}
      </p>
      <SummaryTables summary={props.summary} />
      <h2 class="h2">Orders ({props.orders.length})</h2>
      <table class="hi-t">
        <thead>
          <tr>
            <th>Placed</th>
            <th>Supplier</th>
            <th>Order #</th>
            <th>Status</th>
            <th class="r">Total</th>
          </tr>
        </thead>
        <tbody>
          {props.orders.map((o) => (
            <tr key={o.id}>
              <td>{formatIsoDate(o.placedOn)}</td>
              <td>{o.supplier}</td>
              <td>{o.orderNo}</td>
              <td>
                <StatusBadge order={o} />
              </td>
              <td class="r">{formatCents(orderTotals(o).totalCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="small">Cancelled orders are listed but not counted in the summaries.</p>
    </div>
  );
}
