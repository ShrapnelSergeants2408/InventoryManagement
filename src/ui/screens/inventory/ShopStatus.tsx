// Shop status strip on Inventory (v0.17): links to what needs a look, shown only when there is
// something: orders on the way (and overdue), new items from helpers, stale prices (F14).
import { useMemo } from 'preact/hooks';
import { localIsoDate } from '../../../domain/dates';
import { hasShopStatus, shopStatus } from '../../../domain/shop-status';
import type { Item } from '../../../domain/types';
import { plural } from '../../components/common';
import { useOnOrder, useOrders, usePending, useSettings } from '../../data-hooks';
import { Icon } from '../../icons';
import { href } from '../../shell/router';

export function ShopStatusStrip({ items }: { items: readonly Item[] }) {
  const orders = useOrders();
  const pending = usePending();
  const onOrder = useOnOrder();
  const settings = useSettings();
  const today = localIsoDate();
  const s = useMemo(
    () =>
      shopStatus({
        orders: orders.state === 'ready' ? orders.value : [],
        pending: pending.state === 'ready' ? pending.value.length : 0,
        items,
        onOrder,
        today,
        staleDays: settings.staleDays,
        overdueDays: settings.overdueDays,
      }),
    [orders, pending, items, onOrder, today, settings.staleDays, settings.overdueDays],
  );
  if (!hasShopStatus(s)) return null;
  return (
    <nav class="shopst" aria-label="Shop status">
      {s.open > 0 && (
        <a class="sschip" href={href.placed}>
          <Icon name="truck" />
          {plural(s.open, 'order')} on the way
        </a>
      )}
      {s.overdue > 0 && (
        <a class="sschip att" href={href.placed}>
          <Icon name="clock" />
          {s.overdue} overdue (over {settings.overdueDays} days)
        </a>
      )}
      {s.pending > 0 && (
        <a class="sschip" href={href.pending}>
          <Icon name="count" />
          {plural(s.pending, 'new item')} from helpers to review
        </a>
      )}
      {s.staleLines > 0 && (
        <a class="sschip att" href={href.tab('order')}>
          <Icon name="low" />
          {s.staleLines} of {s.pricedLines} order prices out of date
        </a>
      )}
    </nav>
  );
}
