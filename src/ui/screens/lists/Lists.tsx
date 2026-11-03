// Lists tab (SPEC v3.0 §10). Household: Out on loan and Warranties ending (F12, F13). Holiday:
// To buy, Needs attention and Out now (F24, F9). H3 shows what's in each; the actions on them
// (Returned, Fixed, Put back, ticking To buy) come with their milestones (H4–H8).
import { useMemo } from 'preact/hooks';
import { indexPlaces, itemPath, itemSeasonId, pathText } from '../../../domain/places';
import type { Item, Part } from '../../../domain/types';
import { ConditionChip } from '../../components/chips';
import { plural } from '../../components/common';
import { PartSwitch } from '../../components/PartSwitch';
import { usePartSnapshot, useNow } from '../../data-hooks';
import { href } from '../../shell/router';
import { StorageError } from '../StorageError';

const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

function Row({ item, sub }: { item: Item; sub: string }) {
  return (
    <a class="lrow" href={href.item(item.id)}>
      <span class="t">
        <strong>{item.name}</strong>
        <span>{sub}</span>
      </span>
      <ConditionChip condition={item.condition} />
    </a>
  );
}

function Section({ title, empty, children, count }: { title: string; empty: string; count: number; children: preact.ComponentChildren }) {
  return (
    <section class="lsec" aria-label={title}>
      <h2>
        {title} {count > 0 && <span class="muted small">· {count}</span>}
      </h2>
      {count === 0 ? <p class="empty m0">{empty}</p> : children}
    </section>
  );
}

export function ListsScreen({ part }: { part: Part }) {
  const { live, snap } = usePartSnapshot(part);
  const now = useNow(3_600_000);
  const lists = useMemo(() => {
    if (!snap) return null;
    const ix = indexPlaces(snap);
    const where = (i: Item) => pathText(itemPath(i, ix));
    const seasons = new Map(snap.seasons.map((s) => [s.id, s.name]));
    const today = isoDay(now);
    const soon = isoDay(now + 60 * DAY);
    const ended = isoDay(now - 30 * DAY);
    return {
      where,
      season: (i: Item) => seasons.get(itemSeasonId(i, ix)) ?? 'No season',
      lent: snap.items.filter((i) => i.status === 'lent'),
      warranty: snap.items.filter((i) => i.warrantyUntil !== '' && i.warrantyUntil >= ended && i.warrantyUntil <= soon).sort((a, b) => a.warrantyUntil.localeCompare(b.warrantyUntil)),
      today,
      attention: snap.items.filter((i) => i.condition !== 'ok'),
      out: snap.items.filter((i) => i.status === 'out').sort((a, b) => a.outWhere.localeCompare(b.outWhere) || a.name.localeCompare(b.name)),
    };
  }, [snap, now]);

  const head = (
    <header class="phead top">
      <PartSwitch part={part} />
      <h1 class="h1">Lists</h1>
    </header>
  );
  if (live.state === 'error') {
    return (
      <>
        {head}
        <StorageError error={live.error} />
      </>
    );
  }
  return (
    <>
      {head}
      <div class="fbody">
        {!lists ? (
          <p class="fnote" aria-busy="true">
            Loading…
          </p>
        ) : part === 'household' ? (
          <>
            <Section title="Out on loan" count={lists.lent.length} empty="Nothing is lent out.">
              {lists.lent.map((i) => (
                <Row key={i.id} item={i} sub={`${i.lentTo || 'Someone'}${i.lentOn ? ` · since ${i.lentOn}` : ''}`} />
              ))}
            </Section>
            <Section title="Warranties ending" count={lists.warranty.length} empty="No warranty ends in the next 60 days or ended in the last 30.">
              {lists.warranty.map((i) => (
                <Row key={i.id} item={i} sub={`${i.warrantyUntil < lists.today ? 'Ended' : 'Ends'} ${i.warrantyUntil} · ${lists.where(i)}`} />
              ))}
            </Section>
          </>
        ) : (
          <>
            <Section title="To buy" count={0} empty="The To buy list arrives with the takedown update (H6).">
              {null}
            </Section>
            <Section title="Needs attention" count={lists.attention.length} empty="Every decoration is OK.">
              {lists.attention.map((i) => (
                <Row key={i.id} item={i} sub={`${lists.season(i)}${i.conditionNote ? ` · ${i.conditionNote}` : ''}`} />
              ))}
            </Section>
            <Section title="Out now" count={lists.out.length} empty="Nothing is out.">
              {lists.out.map((i) => (
                <Row key={i.id} item={i} sub={`${i.outWhere || 'Out'} · home ${lists.where(i)}`} />
              ))}
            </Section>
          </>
        )}
        {lists && <p class="fnote">{part === 'household' ? `${plural(snap!.items.length, 'item')} in Household.` : `${plural(snap!.items.length, 'item')} in Holiday.`}</p>}
      </div>
    </>
  );
}
