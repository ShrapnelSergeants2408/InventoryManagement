// Plain-language lines on the item detail card (F10, mockup 2a).
import { formatCents } from './money';
import { orderLineFor } from './order';
import { stockStatus } from './status';
import type { Item, Vendor } from './types';

export interface TwoLines {
  title: string;
  sub: string;
}

/** "Short 8 for current needs" / "Desired 8 + spares 0 = 8 each". */
export function stockLines(item: Item): TwoLines {
  const target = item.desired + item.spares;
  const sub = `Desired ${item.desired} + spares ${item.spares} = ${target} ${item.unit}`;
  const s = stockStatus(item.onHand, item.desired, item.spares);
  if (s.kind === 'short') return { title: `Short ${s.short} for current needs`, sub };
  if (s.kind === 'low') return { title: `Enough for current needs, ${target - item.onHand} short of spares`, sub };
  return { title: 'Stocked: covers desired and spares', sub };
}

/** "Order 8 each" / "8 × $55.00 = $440.00 from REV (preferred vendor)" (§4); units on order count (F30). */
export function orderLines(item: Item, onOrder = 0): TwoLines {
  const line = orderLineFor(item, onOrder);
  if (!line) return { title: 'Nothing to order', sub: onOrder > 0 ? `On hand + ${onOrder} on order covers desired + spares` : 'On hand covers desired + spares' };
  const { vendor, packs, orderQty } = line;
  const title = `Order ${orderQty} ${item.unit}`;
  const from = `from ${vendor.supplier} (preferred vendor)`;
  const count = vendor.packSize > 1 ? `${packs} ${packs === 1 ? 'pack' : 'packs'} of ${vendor.packSize}` : `${packs}`;
  if (vendor.packPriceCents === null || line.lineTotalCents === null) return { title, sub: `${count} ${from} · no price` };
  return { title, sub: `${count} × ${formatCents(vendor.packPriceCents)} = ${formatCents(line.lineTotalCents)} ${from}` };
}

/** "Pack of 50" or "Sold individually". */
export function packText(v: Vendor): string {
  return v.packSize > 1 ? `Pack of ${v.packSize}` : 'Sold individually';
}
