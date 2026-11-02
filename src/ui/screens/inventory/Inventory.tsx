// Inventory (home): grouped list, rows with a quantity stepper, search and recently viewed (F1),
// filters (F2), Select and bulk Move to a bin or spot (F7) or Category…. H2b adds Find and the
// By place and By season views.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { adjustQuantity, setQuantity } from '../../../data/inventory';
import { getRecentHomes, moveItemsHome } from '../../../data/items';
import { changeItemsCategory } from '../../../data/lists';
import { loadExpanded, loadFilters, loadRecent, saveExpanded, saveFilters } from '../../../data/prefs';
import { NO_FILTERS, activeFilterCount, type Filters } from '../../../domain/filters';
import { buildInventoryView, filterOptions, type InventoryView } from '../../../domain/inventory-view';
import { placeLabel } from '../../../domain/lists';
import { indexPlaces, itemPath, NO_HOME, pathText, type PlaceIndex } from '../../../domain/places';
import { keepExisting, selectState, withIds } from '../../../domain/selection';
import type { Item } from '../../../domain/types';
import { CheckBox, StateMessage, TopBar, plural } from '../../components/common';
import { HomePicker } from '../../components/HomePicker';
import { useDb, useSnapshot } from '../../data-hooks';
import { Icon } from '../../icons';
import { href } from '../../shell/router';
import { showToast } from '../../shell/toast';
import { BackupBanner } from '../../shell/BackupBanner';
import { toHome } from '../item/Detail';
import { FilterPanel, NO_HOME_LABEL } from './FilterPanel';
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
  const [moveOpen, setMoveOpen] = useState<'home' | 'category' | null>(null);
  const [recentHomes, setRecentHomes] = useState<string[]>([]);
  useEffect(() => void getRecentHomes(db).then(setRecentHomes), [db, moveOpen]);

  useEffect(() => saveFilters(filters), [filters]);
  useEffect(() => saveExpanded(expanded), [expanded]);

  const snap = live.state === 'ready' ? live.value : null;
  const view = useMemo(
    () => (snap ? buildInventoryView({ items: snap.items, categories: snap.categories, places: snap, seasons: snap.seasons, query, filters, expanded }) : null),
    [snap, query, filters, expanded],
  );
  const options = useMemo(() => (snap ? filterOptions(snap.items, snap.categories, snap, snap.seasons, snap.tags) : null), [snap]);
  const ix = useMemo(() => (snap ? indexPlaces(snap) : null), [snap]);
  const where = (i: Item) => (ix ? pathText(itemPath(i, ix)) : '');
  const recent = useMemo(() => {
    if (!snap || !searching || query !== '') return [];
    const byId = new Map(snap.items.map((i) => [i.id, i]));
    return loadRecent().flatMap((id) => byId.get(id) ?? []);
  }, [snap, searching, query]);
  // Items deleted while selecting drop out of the selection.
  const selected = useMemo(() => (snap ? keepExisting(picked, snap.items) : picked), [snap, picked]);

  // A saved filter can name a category, area, season or tag that was since renamed or removed;
  // drop it rather than show an empty list.
  useEffect(() => {
    if (!options) return;
    setFilters((f) => {
      const keep = (v: string | null, list: readonly string[]) => (v !== null && v !== '' && !list.includes(v) ? null : v);
      const next = { ...f, category: keep(f.category, options.categories), area: keep(f.area, options.areas), season: keep(f.season, options.seasons), tag: keep(f.tag, options.tags) };
      return JSON.stringify(next) === JSON.stringify(f) ? f : next;
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
            placeholder="Search name, place, season, tags, notes…"
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
                      {placeLabel(i)} · {where(i)}
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
      <QuickFilters view={view} filters={filters} query={query} setFilters={setFilters} openPanel={() => setPanelOpen(true)} clearAll={clearAll} ix={ix} seasonName={(id) => snap?.seasons.find((s) => s.id === id)?.name} />
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
          <button type="button" class="btn pri" disabled={selected.size === 0} onClick={() => setMoveOpen('home')}>
            <Icon name="pin" />
            Move to…
          </button>
          <button type="button" class="btn" disabled={selected.size === 0} onClick={() => setMoveOpen('category')}>
            <Icon name="folder" />
            Category…
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
            Search looks at names, places, seasons, tags, categories, notes, barcodes and serials. Try fewer letters.
          </p>
        </StateMessage>
      ) : (
        <List view={view} toggle={toggle} where={where} select={selecting ? { selected, set: (ids, on) => setPicked(withIds(selected, ids, on)) } : null} />
      )}

      {moveOpen === 'home' && snap && ix && chosen.length > 0 && (
        <HomePicker
          snap={snap}
          mode="item"
          title={`Move ${plural(chosen.length, 'item')} to…`}
          current={chosen.length === 1 ? chosen[0]!.binId || chosen[0]!.spotId : '\u0000'}
          recent={recentHomes}
          onClose={() => setMoveOpen(null)}
          onPick={async (to) => {
            const n = await moveItemsHome(db, chosen.map((i) => i.id), toHome(to));
            setMoveOpen(null);
            endSelect();
            showToast(`Moved ${plural(n, 'item')} to ${to ? where({ ...chosen[0]!, binId: to.startsWith('bn-') ? to : '', spotId: to.startsWith('sp-') ? to : '' }) : NO_HOME}${n < chosen.length ? ` (${chosen.length - n} already there)` : ''}.`);
          }}
        />
      )}
      {moveOpen === 'category' && snap && chosen.length > 0 && (
        <MoveDialog
          chosen={chosen}
          categories={snap.categories}
          onClose={() => setMoveOpen(null)}
          onMove={async (to, create) => {
            const n = await changeItemsCategory(db, chosen.map((i) => i.id), to, { create });
            setMoveOpen(null);
            endSelect();
            showToast(`Moved ${plural(n, 'item')} to ${placeLabel(to)}`);
          }}
        />
      )}

      {panelOpen && view && options && (
        <FilterPanel
          filters={filters}
          options={options}
          snap={snap!}
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
  ix: PlaceIndex | null;
  seasonName: (id: string) => string | undefined;
}) {
  const { filters: f, setFilters } = props;
  const tog = (on: boolean) => (on ? 'fchip on' : 'fchip');
  const area = f.area === null ? 'All' : f.area === '' ? NO_HOME_LABEL : (props.ix?.area.get(f.area)?.name ?? '…');
  const season = f.season === null ? 'All' : f.season === '' ? 'None' : (props.seasonName(f.season) ?? '…');
  return (
    <div class="frow" role="toolbar" aria-label="Quick filters">
      <button type="button" class={tog(f.category !== null)} onClick={props.openPanel}>
        Category: {f.category ?? 'All'}
        <Icon name="chevDown" />
      </button>
      <button type="button" class={tog(f.area !== null)} onClick={props.openPanel}>
        Area: {area}
        <Icon name="chevDown" />
      </button>
      <button type="button" class={tog(f.season !== null)} onClick={props.openPanel}>
        Season: {season}
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

function List({ view, toggle, where, select }: { view: InventoryView; toggle: (key: string) => void; where: (i: Item) => string; select: Selection | null }) {
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
          if (select) return <SelectRow key={ln.item.id} item={ln.item} where={where(ln.item)} select={select} />;
          return <ItemRow key={ln.item.id} item={ln.item} where={where(ln.item)} onStep={onStep} onSet={onSet} />;
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
function SelectRow({ item, where, select }: { item: Item; where: string; select: Selection }) {
  const on = select.selected.has(item.id);
  return (
    <div class="irow selrow">
      <button type="button" class="cb" role="checkbox" aria-checked={on} onClick={() => select.set([item.id], !on)}>
        <CheckBox state={on ? 'on' : 'off'} />
        <Thumb itemId={item.id} hasPhoto={item.hasPhoto} />
        <span class="irow-t">
          <strong>{item.name}</strong>{' '}
          <span class="small muted">
            {placeLabel(item)} · {where}
          </span>
        </span>
      </button>
    </div>
  );
}
