// Inventory (home): grouped list, rows with a quantity stepper, search and recently viewed (F1),
// filters (F2), Select and bulk move (F7).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { adjustQuantity, setQuantity } from '../../../data/inventory';
import { moveItemsTo } from '../../../data/lists';
import { loadExpanded, loadFilters, loadRecent, saveExpanded, saveFilters } from '../../../data/prefs';
import { NO_FILTERS, activeFilterCount, type Filters } from '../../../domain/filters';
import { buildInventoryView, filterOptions, type InventoryView } from '../../../domain/inventory-view';
import { placeLabel } from '../../../domain/lists';
import { keepExisting, selectState, withIds } from '../../../domain/selection';
import type { Item } from '../../../domain/types';
import { CheckBox, StateMessage, TopBar, plural } from '../../components/common';
import { useDb, useSnapshot } from '../../data-hooks';
import { Icon } from '../../icons';
import { href } from '../../shell/router';
import { showToast } from '../../shell/toast';
import { BackupBanner } from '../../shell/BackupBanner';
import { FilterPanel, NO_LOCATION_LABEL } from './FilterPanel';
import { ItemRow, Thumb } from './ItemRow';
import { SelectBar } from '../../components/SelectBar';
import { MoveDialog } from './MoveDialog';
import { StorageError } from '../StorageError';

function Skeleton() {
  return (
    <div class="list" aria-busy="true" aria-label="Loading inventory">
      <div class="cathdr static">
        <div class="skel" style={{ width: 220, height: 24 }} />
        <span class="hc">Loading inventory…</span>
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
  const db = useDb();
  const live = useSnapshot();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Filters>(() => loadFilters());
  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpanded());
  const [panelOpen, setPanelOpen] = useState(false);
  // Recently viewed: offered while the search box is focused and empty.
  const [searching, setSearching] = useState(false);
  // Select mode: checkboxes on rows and group headers, then Move to….
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);

  useEffect(() => saveFilters(filters), [filters]);
  useEffect(() => saveExpanded(expanded), [expanded]);

  const snap = live.state === 'ready' ? live.value : null;
  const view = useMemo(
    () => (snap ? buildInventoryView({ items: snap.items, categories: snap.categories, query, filters, expanded }) : null),
    [snap, query, filters, expanded],
  );
  const options = useMemo(() => (snap ? filterOptions(snap.items, snap.categories, snap.locations) : null), [snap]);
  const recent = useMemo(() => {
    if (!snap || !searching || query !== '') return [];
    const byId = new Map(snap.items.map((i) => [i.id, i]));
    return loadRecent().flatMap((id) => byId.get(id) ?? []);
  }, [snap, searching, query]);
  // Items deleted while selecting drop out of the selection.
  const selected = useMemo(() => (snap ? keepExisting(picked, snap.items) : picked), [snap, picked]);

  // A saved filter can name a category or location that was since renamed or removed; drop it
  // rather than show an empty list.
  useEffect(() => {
    if (!options) return;
    setFilters((f) => {
      const category = f.category !== null && !options.categories.includes(f.category) ? null : f.category;
      const location = f.location !== null && f.location !== '' && !options.locations.includes(f.location) ? null : f.location;
      return category === f.category && location === f.location ? f : { ...f, category, location };
    });
  }, [options]);

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
  const endSelect = () => {
    setSelecting(false);
    setPicked(new Set());
  };
  const chosen: Item[] = snap ? snap.items.filter((i) => selected.has(i.id)) : [];
  const summary = view ? plural(view.total, 'item') : 'Loading…';

  return (
    <>
      <TopBar
        title="Inventory"
        subtitle={summary}
        search={
        <div class="searchwrap">
          <Icon name="search" />
          <input
            class="field"
            type="search"
            aria-label="Search inventory"
            placeholder="Search name, category, location, notes…"
            value={query}
            onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
            onFocus={() => setSearching(true)}
            onBlur={() => setSearching(false)}
            autoComplete="off"
            spellcheck={false}
          />
          {query && (
            <button type="button" class="clr" aria-label="Clear search" onClick={() => setQuery('')}>
              <Icon name="close" />
            </button>
          )}
          {recent.length > 0 && (
            // pointerdown keeps the box focused, so the tap reaches the link before the list closes.
            <nav class="recent" aria-label="Recently viewed" onPointerDown={(e) => e.preventDefault()}>
              <span class="lbl">Recently viewed</span>
              {recent.map((i) => (
                <a key={i.id} class="recent-i" href={href.item(i.id)}>
                  <Thumb itemId={i.id} hasPhoto={i.hasPhoto} />
                  <span class="recent-t">
                    <strong>{i.name}</strong>
                    <span class="small muted">
                      {placeLabel(i)} · {i.location || 'No location'}
                    </span>
                  </span>
                </a>
              ))}
            </nav>
          )}
        </div>
        }
      >
        <button type="button" class="btn" onClick={() => setPanelOpen(true)}>
          <Icon name="filter" />
          {nFilters ? `Filters (${nFilters})` : 'Filters'}
        </button>
        {selecting ? (
          <button type="button" class="btn pri" onClick={endSelect}>
            Done
          </button>
        ) : (
          <>
            <button type="button" class="btn" disabled={!snap || snap.items.length === 0} onClick={() => setSelecting(true)}>
              <Icon name="check" />
              Select
            </button>
            <a class="btn pri" href={href.add()}>
              <Icon name="plus" />
              Add item
            </a>
          </>
        )}
      </TopBar>

      <BackupBanner />
      <QuickFilters view={view} filters={filters} query={query} setFilters={setFilters} openPanel={() => setPanelOpen(true)} clearAll={clearAll} />
      {selecting && view && (
        <SelectBar
          count={selected.size}
          noun="item"
          hidden={[...selected].filter((id) => !view.shownIds.includes(id)).length}
          shown={view.shownIds.length}
          allShown={view.shownIds.length > 0 && view.shownIds.every((id) => selected.has(id))}
          onAll={() => setPicked(withIds(selected, view.shownIds, true))}
          onClear={() => setPicked(new Set())}
        >
          <button type="button" class="btn pri" disabled={selected.size === 0} onClick={() => setMoveOpen(true)}>
            <Icon name="folder" />
            Move to…
          </button>
        </SelectBar>
      )}

      {!view || !snap ? (
        <Skeleton />
      ) : snap.items.length === 0 ? (
        <StateMessage
          icon="inventory"
          title="No items yet"
          actions={
            <a class="btn pri" href={href.add()}>
              <Icon name="plus" />
              Add an item
            </a>
          }
        >
          <p class="state-text">Add the first item, or restore a backup in More › Backup & restore.</p>
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
            Search looks at names, categories, locations, notes and barcodes. Try fewer letters.
          </p>
        </StateMessage>
      ) : (
        <List view={view} toggle={toggle} select={selecting ? { selected, set: (ids, on) => setPicked(withIds(selected, ids, on)) } : null} />
      )}

      {moveOpen && snap && chosen.length > 0 && (
        <MoveDialog
          chosen={chosen}
          categories={snap.categories}
          onClose={() => setMoveOpen(false)}
          onMove={async (to, create) => {
            const n = await moveItemsTo(db, chosen.map((i) => i.id), to, { create });
            setMoveOpen(false);
            endSelect();
            showToast(`Moved ${plural(n, 'item')} to ${placeLabel(to)}`);
          }}
        />
      )}

      {panelOpen && view && options && (
        <FilterPanel
          filters={filters}
          options={options}
          locations={snap?.locations ?? []}
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
  const tog = (on: boolean) => (on ? 'fchip on' : 'fchip');
  const loc = f.location === null ? 'All' : f.location || NO_LOCATION_LABEL;
  return (
    <div class="frow" role="toolbar" aria-label="Quick filters">
      <button type="button" class={tog(f.category !== null)} onClick={props.openPanel}>
        Category: {f.category ?? 'All'}
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

// Where the list was scrolled, so coming back from an item's detail card keeps the place.
let savedScroll = 0;

interface Selection {
  selected: ReadonlySet<string>;
  set: (ids: readonly string[], on: boolean) => void;
}

function List({ view, toggle, select }: { view: InventoryView; toggle: (key: string) => void; select: Selection | null }) {
  const db = useDb();
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (box.current) box.current.scrollTop = savedScroll;
  }, []);
  const fail = (e: unknown) => showToast(`Couldn't save the quantity: ${e instanceof Error ? e.message : String(e)}`);
  const onStep = (id: string, d: number) => void adjustQuantity(db, id, d).catch(fail);
  const onSet = (id: string, n: number) =>
    setQuantity(db, id, n).catch((e: unknown) => {
      fail(e);
      throw e;
    });
  return (
    <div class="list" ref={box} onScroll={(e) => (savedScroll = (e.currentTarget as HTMLDivElement).scrollTop)}>
      {view.lines.map((ln) => {
        if (ln.kind === 'item') {
          if (select) return <SelectRow key={ln.item.id} item={ln.item} select={select} />;
          return <ItemRow key={ln.item.id} item={ln.item} onStep={onStep} onSet={onSet} />;
        }
        const isCat = ln.kind === 'category';
        const sub = view.filtering ? `${ln.matching} of ${plural(ln.total, 'item')} match` : plural(ln.total, 'item');
        if (select) {
          // Select mode: the checkbox takes every item shown under the header, collapsed or not.
          const state = selectState(ln.ids, select.selected);
          const n = ln.ids.filter((id) => select.selected.has(id)).length;
          return (
            <div key={ln.key} class={isCat ? 'cathdr sel' : 'subhdr sel'}>
              <button
                type="button"
                class="cb"
                role="checkbox"
                aria-checked={state === 'on' ? 'true' : state === 'some' ? 'mixed' : 'false'}
                disabled={ln.ids.length === 0}
                onClick={() => select.set(ln.ids, state !== 'on')}
              >
                <CheckBox state={state} />
                <span class={isCat ? 'cn' : undefined}>{ln.name}</span>
                <span class="hc">{n ? `${n} of ${plural(ln.ids.length, 'item')} selected` : sub}</span>
              </button>
              {!view.filtering && (
                <button type="button" class="exp" aria-expanded={ln.expanded} aria-label={`${ln.expanded ? 'Collapse' : 'Expand'} ${ln.name}`} onClick={() => toggle(ln.key)}>
                  <Icon name={ln.expanded ? 'chevDown' : 'chevRight'} />
                </button>
              )}
            </div>
          );
        }
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

/** A row in Select mode: the whole row toggles it. No stepper, so a quantity can't change by accident. */
function SelectRow({ item, select }: { item: Item; select: Selection }) {
  const on = select.selected.has(item.id);
  return (
    <div class="irow selrow">
      <button type="button" class="cb" role="checkbox" aria-checked={on} onClick={() => select.set([item.id], !on)}>
        <CheckBox state={on ? 'on' : 'off'} />
        <Thumb itemId={item.id} hasPhoto={item.hasPhoto} />
        <span class="irow-t">
          <strong>{item.name}</strong>{' '}
          <span class="small muted">
            {placeLabel(item)} · {item.location || 'No location'}
          </span>
        </span>
      </button>
    </div>
  );
}
