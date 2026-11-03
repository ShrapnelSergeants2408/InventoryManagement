// Status, condition and season chips (SPEC v2.0 §11): word plus icon, never color alone.
// Stored and OK show no chip. H3 restyles them with the mockups.
import { qtyText } from '../../domain/places';
import type { Condition, Item, Season } from '../../domain/types';
import { Icon } from '../icons';

export function StatusChip({ item }: { item: Pick<Item, 'status' | 'outWhere' | 'lentTo'> }) {
  if (item.status === 'out') {
    return (
      <span class="chip st-out">
        <Icon name="arrowOut" />
        OUT{item.outWhere ? ` · ${item.outWhere}` : ''}
      </span>
    );
  }
  if (item.status === 'lent') {
    return (
      <span class="chip st-lent">
        <Icon name="hand" />
        LENT{item.lentTo ? ` · ${item.lentTo}` : ''}
      </span>
    );
  }
  return null;
}

export const CONDITION_LABEL: Record<Condition, string> = { ok: 'OK', 'needs repair': 'Needs repair', replace: 'Replace', toss: 'Toss' };

export function ConditionChip({ condition }: { condition: Condition }) {
  if (condition === 'ok') return null;
  const icon = condition === 'needs repair' ? 'wrench' : condition === 'replace' ? 'swap' : 'trash';
  return (
    <span class={`chip cond-${condition.replace(' ', '-')}`}>
      <Icon name={icon} />
      {CONDITION_LABEL[condition]}
    </span>
  );
}

export function SeasonChip({ season }: { season: Season | undefined }) {
  if (!season) return null;
  return <span class={`chip season c-${season.color}`}>{season.name}</span>;
}

/** "×3", or "~40" for a bulk line. */
export function Qty({ item }: { item: Pick<Item, 'quantity' | 'approx'> }) {
  return <span class="tnum">{qtyText(item)}</span>;
}
