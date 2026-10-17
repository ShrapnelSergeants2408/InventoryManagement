// Inventory (home): grouped list (F1), rows (F2), quick adjust (F3), search (F4), filters (F5).
import { useEffect, useMemo, useState } from 'preact/hooks';
import { adjustOnHand, setOnHand } from '../../../data/inventory';
import { loadExpanded, loadFilters, saveExpanded, saveFilters } from '../../../data/prefs';
import { NO_FILTERS, activeFilterCount, type Filters } from '../../../domain/filters';
import { buildInventoryView, filterOptions, type InventoryView } from '../../../domain/inventory-view';
import { GroupChips, StateMessage, TopBar } from '../../components/common';
import { useDb, useSnapshot } from '../../data-hooks';
import { Icon } from '../../icons';
import { href } from '../../shell/router';
import { showToast } from '../../shell/toast';
import { FilterPanel, NO_LOCATION_LABEL } from './FilterPanel';
import { ItemRow } from './ItemRow';
import { StorageError } from '../StorageError';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Skeleton() {
  return (
    <div class="list" aria-busy="true" aria-label="Loading inventory">
      <div class="cathdr static">
        <div class="skel" style={{ width: 220, height: 24 }} />
        <span class="hc">Loading inventory from this tablet…</span>
      </div>
      {[1, 2, 3, 4, 5, 6, 7].map((k) => (
        <div class="row" key={k}>
          <div class="skel-name">
            <div class="thumb nophoto" />
            <div style={{ flex: 1 }}>
              <div class="skel" style={{ width: '80%' }} />
              <div class="skel" style={{ width: '45%', marginTop: 10, height: 14 }} />
            </div>
          </div>
          <div class="skel" style={{ height: 40 }} />
          <div class="skel" style={{ height: 34, width: 110 }} />
          <div class="skel" style={{ height: 64 }} />
        </div>
      ))}
    </div>
  );
}

export function InventoryScreen() {
  const live = useSnapshot();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Filters>(() => loadFilters());
  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpanded());
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => saveFilters(filters), [filters]);
  useEffect(() => saveExpanded(expanded), [expanded]);

  const snap = live.state === 'ready' ? live.value : null;
  const view = useMemo(
    () => (snap ? buildInventoryView({ items: snap.items, categories: snap.categories, query, filters, expanded }) : null),
    [snap, query, filters, expanded],
  );
  const options = useMemo(() => (snap ? filterOptions(snap.items, snap.categories, snap.locations) : null), [snap]);

  if (live.state === 'error') {
    return (
      <>
        <TopBar title="Inventory" subtitle="Storage unavailable" />
        <StorageError error={live.error} />
      </>
    );
  }

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const clearAll = () => {
    setQuery('');
    setFilters({ ...NO_FILTERS });
  };
  const nFilters = activeFilterCount(filters);
  const summary = view
    ? `${plural(view.totals.items, 'item')} · ${view.totals.short} short · ${view.totals.low} low spares`
    : 'Loading…';

  return (
    <>
      <TopBar title="Inventory" subtitle={summary}>
        <div class="searchwrap">
          <Icon name="search" />
          <input
            class="field"
            type="search"
            aria-label="Search inventory"
            placeholder="Search name, part #, supplier, location…"
            value={query}
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
        <button type="button" class="btn" onClick={() => setPanelOpen(true)}>
          <Icon name="filter" />
          {nFilters ? `Filters (${nFilters})` : 'Filters'}
        </button>
        <a class="btn pri" href={href.add()}>
          <Icon name="plus" />
          Add item
        </a>
      </TopBar>

      <QuickFilters view={view} filters={filters} query={query} setFilters={setFilters} openPanel={() => setPanelOpen(true)} clearAll={clearAll} />

      {!view || !snap ? (
        <Skeleton />
      ) : snap.items.length === 0 ? (
        <StateMessage
          icon="inventory"
          title="No items on this tablet yet"
          actions={
            <a class="btn pri" href={href.add()}>
              <Icon name="plus" />
              Add an item
            </a>
          }
        >
          <p class="state-text">Add the first item, or a mentor can load the starter catalog or restore a backup.</p>
        </StateMessage>
      ) : view.filtering && view.shown === 0 ? (
        <StateMessage
          icon="search"
          title={query.trim() ? `No items match “${query.trim()}”` : 'No items match these filters'}
          actions={
            <>
              <button type="button" class="btn" onClick={clearAll}>
                Clear search and filters
              </button>
              <a class="btn pri" href={href.add(query.trim())}>
                <Icon name="plus" />
                {query.trim() ? `Add “${query.trim()}” as a new item` : 'Add an item'}
              </a>
            </>
          }
        >
          <p class="state-text">
            Search looks at names, part numbers, suppliers, locations and notes. Try fewer letters, or a part number like REV-21-1653.
          </p>
        </StateMessage>
      ) : (
        <List view={view} toggle={toggle} />
      )}

      {panelOpen && view && options && (
        <FilterPanel
          filters={filters}
          options={options}
          totals={view.totals}
          shown={view.shown}
          onChange={setFilters}
          onClear={clearAll}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </>
  );
}

function QuickFilters(props: {
  view: InventoryView | null;
  filters: Filters;
  query: string;
  setFilters: (f: Filters) => void;
  openPanel: () => void;
  clearAll: () => void;
}) {
  const { filters: f, setFilters } = props;
  const t = props.view?.totals ?? { needsOrder: 0, short: 0, low: 0, items: 0 };
  const tog = (on: boolean) => (on ? 'fchip on' : 'fchip');
  const loc = f.location === null ? 'All' : f.location || NO_LOCATION_LABEL;
  return (
    <div class="frow" role="toolbar" aria-label="Quick filters">
      <button type="button" class={tog(f.needsOrder)} aria-pressed={f.needsOrder} onClick={() => setFilters({ ...f, needsOrder: !f.needsOrder })}>
        Needs order · {t.needsOrder}
      </button>
      <button type="button" class={tog(f.short)} aria-pressed={f.short} onClick={() => setFilters({ ...f, short: !f.short })}>
        <Icon name="short" />
        Short only · {t.short}
      </button>
      <button type="button" class={tog(f.low)} aria-pressed={f.low} onClick={() => setFilters({ ...f, low: !f.low })}>
        <Icon name="low" />
        Low spares only · {t.low}
      </button>
      <button type="button" class={tog(f.category !== null)} onClick={props.openPanel}>
        Category: {f.category ?? 'All'}
        <Icon name="chevDown" />
      </button>
      <button type="button" class={tog(f.supplier !== null)} onClick={props.openPanel}>
        Supplier: {f.supplier ?? 'All'}
        <Icon name="chevDown" />
      </button>
      <button type="button" class={tog(f.location !== null)} onClick={props.openPanel}>
        Location: {loc}
        <Icon name="chevDown" />
      </button>
      {(props.query.trim() !== '' || activeFilterCount(f) > 0) && (
        <button type="button" class="fchip link" onClick={props.clearAll}>
          Clear all
        </button>
      )}
    </div>
  );
}

function List({ view, toggle }: { view: InventoryView; toggle: (key: string) => void }) {
  const db = useDb();
  const fail = (e: unknown) => showToast(`Couldn't save the count: ${e instanceof Error ? e.message : String(e)}`);
  const onStep = (id: string, d: number) => void adjustOnHand(db, id, d).catch(fail);
  const onSet = (id: string, n: number) =>
    setOnHand(db, id, n).catch((e: unknown) => {
      fail(e);
      throw e;
    });
  return (
    <div class="list">
      {view.lines.map((ln) => {
        if (ln.kind === 'item') return <ItemRow key={ln.info.item.id} info={ln.info} onStep={onStep} onSet={onSet} />;
        const isCat = ln.kind === 'category';
        const sub = isCat
          ? view.filtering
            ? `${ln.matching} of ${plural(ln.total, 'item')} match`
            : `${plural(ln.total, 'item')} · ${ln.counted} counted`
          : plural(ln.total, 'item');
        return (
          <button
            type="button"
            key={ln.key}
            class={isCat ? 'cathdr' : 'subhdr'}
            aria-expanded={ln.expanded}
            disabled={view.filtering}
            onClick={() => toggle(ln.key)}
          >
            <Icon name={ln.expanded ? 'chevDown' : 'chevRight'} />
            <span class={isCat ? 'cn' : undefined}>{ln.name}</span>
            <span class="hc">{sub}</span>
            <span class="sp" />
            <GroupChips counts={ln} />
          </button>
        );
      })}
      <div class="list-foot small muted">
        {view.filtering
          ? `${plural(view.shown, 'matching item')}`
          : 'Tap a category to expand or collapse it — the app remembers which are open. Tap an item for its detail card.'}
      </div>
    </div>
  );
}
