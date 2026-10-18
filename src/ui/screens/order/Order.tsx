// Order list (F12): every item to order, grouped by preferred supplier with subtotals and a
// grand total; stale-price flags and banner (F14); count-in banner; CSV export (F13).
import { useMemo, useState } from 'preact/hooks';
import { formatIsoDate, localIsoDate } from '../../../domain/dates';
import { formatCents } from '../../../domain/money';
import { buildOrderList, type OrderLine, type OrderList } from '../../../domain/order';
import { orderAlerts, priceAge, staleLabel } from '../../../domain/stale';
import { nameKey, type Supplier } from '../../../domain/types';
import { safeHref } from '../../../domain/url';
import { StateMessage, TopBar, plural } from '../../components/common';
import { useSettings, useSnapshot, useThumbnail } from '../../data-hooks';
import { Icon } from '../../icons';
import { href } from '../../shell/router';
import { StorageError } from '../StorageError';
import { ExportDialog } from './ExportDialog';
import { PriceRefreshDialog } from './PriceRefreshDialog';

export function OrderScreen() {
  const live = useSnapshot();
  const settings = useSettings();
  const [exporting, setExporting] = useState(false);
  const [refreshHelp, setRefreshHelp] = useState(false);
  const today = localIsoDate();
  const snap = live.state === 'ready' ? live.value : null;
  const list = useMemo(() => (snap ? buildOrderList(snap.items) : null), [snap]);
  const alerts = useMemo(() => (snap && list ? orderAlerts(list, snap.items, today, settings.staleDays) : null), [snap, list, today, settings.staleDays]);

  const empty = !!list && list.lineCount === 0;
  const top = (
    <TopBar title="Order list" subtitle={`Grouped by preferred supplier · ${formatIsoDate(today)}`}>
      <span class="sp" />
      <button type="button" class="btn pri" disabled={!list || empty} onClick={() => setExporting(true)}>
        <Icon name="upload" />
        Export CSV
      </button>
    </TopBar>
  );

  if (live.state === 'error') {
    return (
      <>
        {top}
        <StorageError error={live.error} />
      </>
    );
  }
  if (!snap || !list || !alerts) {
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
      {alerts.countBanner && (
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
      {empty ? (
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
          <Summary list={list} staleLines={alerts.staleLines} staleDays={settings.staleDays} />
          <Lines list={list} suppliers={snap.suppliers} today={today} staleDays={settings.staleDays} />
        </>
      )}
      {exporting && <ExportDialog list={list} onClose={() => setExporting(false)} />}
      {refreshHelp && <PriceRefreshDialog onClose={() => setRefreshHelp(false)} />}
    </>
  );
}

function Summary({ list, staleLines, staleDays }: { list: OrderList; staleLines: number; staleDays: number }) {
  return (
    <div class="sum">
      <div class="tile big">
        <span class="k">Grand total</span>
        <span class="v">{formatCents(list.grandTotalCents)}</span>
      </div>
      <div class="tile">
        <span class="k">Lines</span>
        <span class="v">{list.lineCount}</span>
      </div>
      <div class="tile">
        <span class="k">Suppliers</span>
        <span class="v">{list.groups.length}</span>
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

function Lines(props: { list: OrderList; suppliers: Supplier[]; today: string; staleDays: number }) {
  const sites = new Map(props.suppliers.map((s) => [nameKey(s.name), safeHref(s.website)]));
  return (
    <div class="olist">
      <div class="ogrid colh" aria-hidden="true">
        <span>Item</span>
        <span>Part #</span>
        <span class="r">Need</span>
        <span class="r">Pack</span>
        <span class="r">Packs</span>
        <span class="r">Order qty</span>
        <span class="r">Pack price</span>
        <span class="r">Line total</span>
      </div>
      {props.list.groups.map((g) => {
        const site = sites.get(nameKey(g.supplier));
        return (
          <section key={g.supplier} aria-label={`${g.supplier}: ${plural(g.lines.length, 'line')}, subtotal ${formatCents(g.subtotalCents)}`}>
            <div class="shdr">
              <h2 class="oname">{g.supplier}</h2>
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
            </div>
            {g.lines.map((l) => (
              <Line key={l.item.id} l={l} today={props.today} staleDays={props.staleDays} />
            ))}
          </section>
        );
      })}
      <div class="gt">
        <span class="muted">{props.list.noPriceCount > 0 ? `${plural(props.list.noPriceCount, 'item')} without prices not included` : 'Every line has a price'}</span>
        <span class="gt-v">Grand total {formatCents(props.list.grandTotalCents)}</span>
      </div>
    </div>
  );
}

function Line({ l, today, staleDays }: { l: OrderLine; today: string; staleDays: number }) {
  const thumb = useThumbnail(l.item.id, l.item.hasPhoto);
  const v = l.vendor;
  const stale = staleLabel(priceAge(v, today, staleDays));
  const price = v.packPriceCents === null ? 'No price' : formatCents(v.packPriceCents);
  const total = l.lineTotalCents === null ? '—' : formatCents(l.lineTotalCents);
  const packsText = v.packSize > 1 ? `${l.packs} × pack of ${v.packSize}` : `${l.packs} × 1`;
  return (
    <div class="ogrid line">
      <a class="lname" href={href.item(l.item.id)} aria-label={`Open details for ${l.item.name}`}>
        {thumb ? <img src={thumb} alt="" /> : <span class="nophoto" />}
        <span class="lname-t">
          <span class="lt">{l.item.name}</span>
          {(stale || v.packPriceCents === null) && (
            <span class="lchips">
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
      </a>
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
        {v.partNo ? `${v.partNo} · ` : ''}need {l.need} · {packsText} · {price} → {total}
      </span>
    </div>
  );
}
