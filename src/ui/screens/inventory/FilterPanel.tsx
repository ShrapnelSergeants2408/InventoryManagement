// Filters panel (F2): side sheet in landscape, bottom sheet in portrait. Category, area, season,
// status, needs attention (condition not OK) and tag.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { InventorySnapshot } from '../../../data/inventory';
import type { Filters } from '../../../domain/filters';
import type { FilterOptions } from '../../../domain/inventory-view';
import { NO_HOME } from '../../../domain/places';
import { ITEM_STATUSES, type ItemStatus } from '../../../domain/types';
import { Icon } from '../../icons';

export const NO_HOME_LABEL = NO_HOME;

const STATUS_LABEL: Record<ItemStatus, string> = { stored: 'Stored', out: 'Out', lent: 'Lent' };

function Choice(props: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" class={props.on ? 'fchip on' : 'fchip'} aria-pressed={props.on} onClick={props.onClick}>
      {props.label}
    </button>
  );
}

function Section(props: { title: string; children: ComponentChildren }) {
  return (
    <section class="fsec">
      <h3>{props.title}</h3>
      <div class="fgrid">{props.children}</div>
    </section>
  );
}

export function FilterPanel(props: {
  filters: Filters;
  options: FilterOptions;
  /** For area and season names. */
  snap: Pick<InventorySnapshot, 'areas' | 'seasons'>;
  shown: number;
  onChange: (f: Filters) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const { filters: f, onChange } = props;
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  const pick = <K extends 'category' | 'area' | 'season' | 'tag'>(k: K, v: string) => onChange({ ...f, [k]: f[k] === v ? null : v });
  const areaName = (id: string) => (id === '' ? NO_HOME_LABEL : (props.snap.areas.find((a) => a.id === id)?.name ?? id));
  const seasonName = (id: string) => (id === '' ? 'No season' : (props.snap.seasons.find((s) => s.id === id)?.name ?? id));

  return (
    <>
      <div class="scrim" onClick={props.onClose} />
      <div class="fpanel" role="dialog" aria-modal="true" aria-label="Filters">
        <div class="fpanel-head">
          <h2 class="h2">Filters</h2>
          <button ref={closeBtn} type="button" class="ib" aria-label="Close filters" onClick={props.onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div class="fpanel-body">
          <Section title="Category">
            {props.options.categories.map((c) => (
              <Choice key={c} on={f.category === c} label={c} onClick={() => pick('category', c)} />
            ))}
          </Section>
          <Section title="Area">
            {props.options.areas.map((a) => (
              <Choice key={a} on={f.area === a} label={areaName(a)} onClick={() => pick('area', a)} />
            ))}
          </Section>
          {props.options.seasons.length > 0 && (
            <Section title="Season">
              {props.options.seasons.map((s) => (
                <Choice key={s} on={f.season === s} label={seasonName(s)} onClick={() => pick('season', s)} />
              ))}
            </Section>
          )}
          <Section title="Status">
            {ITEM_STATUSES.map((s) => (
              <Choice key={s} on={f.status === s} label={STATUS_LABEL[s]} onClick={() => onChange({ ...f, status: f.status === s ? null : s })} />
            ))}
            <Choice on={f.attention} label="Needs attention" onClick={() => onChange({ ...f, attention: !f.attention })} />
          </Section>
          {props.options.tags.length > 0 && (
            <Section title="Tag">
              {props.options.tags.map((t) => (
                <Choice key={t} on={f.tag === t} label={t} onClick={() => pick('tag', t)} />
              ))}
            </Section>
          )}
        </div>
        <div class="fpanel-foot">
          <button type="button" class="btn" onClick={props.onClear}>
            Clear all
          </button>
          <button type="button" class="btn pri grow" onClick={props.onClose}>
            Show {props.shown} {props.shown === 1 ? 'item' : 'items'}
          </button>
        </div>
      </div>
    </>
  );
}
