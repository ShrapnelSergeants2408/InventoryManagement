// Find (SPEC v3.0 F1, H3 mockup 1): one search box over the current part, results grouped Items /
// Bins / Spots with their paths and thumbnails, and one line for the other part's matches. With
// the box empty: the records of this part opened most recently on this phone and, in Holiday,
// the ways into Browse.
import { useMemo, useState } from 'preact/hooks';
import { loadRecent, RECENT_MAX, saveBrowseBy } from '../../../data/prefs';
import type { BrowseBy } from '../../../domain/browse';
import { findIn, NO_RESULTS } from '../../../domain/find';
import { partView } from '../../../domain/parts';
import { binLabel, binPath, indexPlaces, itemPath, pathText, qtyText, spotPath } from '../../../domain/places';
import { otherPart, PART_NAME, type Bin, type Item, type Part, type Spot } from '../../../domain/types';
import { StateMessage, plural } from '../../components/common';
import { PartSwitch } from '../../components/PartSwitch';
import { usePartSnapshot, useThumbnail } from '../../data-hooks';
import { Icon } from '../../icons';
import { href } from '../../shell/router';
import { BackupBanner } from '../../shell/BackupBanner';
import { Thumb } from '../inventory/ItemRow';
import { StorageError } from '../StorageError';

export function FindScreen({ part, q: initial }: { part: Part; q: string }) {
  const { live, snap, all } = usePartSnapshot(part);
  const [q, setQ] = useState(initial);
  const results = useMemo(() => (snap ? findIn(snap, q) : NO_RESULTS), [snap, q]);
  const other = otherPart(part);
  const otherCount = useMemo(() => (all && q.trim() ? findIn(partView(all, other), q, 0).total : 0), [all, other, q]);
  const recent = useMemo(() => {
    if (!snap) return [];
    const ix = indexPlaces(snap);
    const out: Array<{ kind: 'item'; item: Item; path: string } | { kind: 'bin'; bin: Bin; path: string } | { kind: 'spot'; spot: Spot; path: string }> = [];
    for (const id of loadRecent()) {
      const item = snap.items.find((i) => i.id === id);
      if (item) out.push({ kind: 'item', item, path: pathText(itemPath(item, ix)) });
      const bin = snap.bins.find((b) => b.id === id);
      if (bin) out.push({ kind: 'bin', bin, path: pathText(binPath(bin, ix).slice(0, -1)) || 'No spot' });
      const spot = snap.spots.find((s) => s.id === id);
      if (spot) out.push({ kind: 'spot', spot, path: pathText(spotPath(spot, ix).slice(0, -1)) });
      if (out.length >= RECENT_MAX) break;
    }
    return out;
  }, [snap]);

  const searching = q.trim() !== '';
  const head = (
    <header class="phead top">
      <PartSwitch part={part} tab="find" q={q.trim()} />
      <div class="prow">
        <div class="fbox grow">
          <Icon name="search" />
          <input
            type="search"
            aria-label={`Search ${PART_NAME[part]}`}
            placeholder={part === 'holiday' ? 'Search decorations, bins, seasons…' : 'Search items, bins, places…'}
            value={q}
            onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)}
            autoComplete="off"
            spellcheck={false}
          />
          {q && (
            <button type="button" class="ib clr" aria-label="Clear search" onClick={() => setQ('')}>
              <Icon name="close" />
            </button>
          )}
        </div>
        <a class="btn pri" href={href.add(q.trim())}>
          <Icon name="plus" />
          Add
        </a>
      </div>
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
      <BackupBanner />
      <div class="fbody">
        {!snap ? (
          <p class="fnote" aria-busy="true">
            Loading…
          </p>
        ) : !searching ? (
          <>
            {part === 'holiday' && <BrowseLinks />}
            {recent.length > 0 ? (
              <>
                <p class="flbl">Recently viewed</p>
                {recent.map((r) => (r.kind === 'item' ? <ItemResult key={r.item.id} item={r.item} path={r.path} /> : r.kind === 'bin' ? <BinResult key={r.bin.id} bin={r.bin} path={r.path} /> : <SpotResult key={r.spot.id} spot={r.spot} path={r.path} />))}
              </>
            ) : (
              <p class="fnote">
                {snap.items.length === 0 && snap.bins.length === 0
                  ? `Nothing in ${PART_NAME[part]} yet. Add your areas and spots in More › Areas & spots, then add bins and items.`
                  : 'Type a name, a bin code like A-04, a place or a tag. Things you open show here next time.'}
              </p>
            )}
          </>
        ) : results.total === 0 ? (
          <StateMessage
            icon="search"
            title={`Nothing in ${PART_NAME[part]} matches “${q.trim()}”`}
            actions={
              <a class="btn pri" href={href.add(q.trim())}>
                <Icon name="plus" />
                Add “{q.trim()}” as a new item
              </a>
            }
          >
            <p class="state-text">Search looks at names, places, bin codes, categories, tags, notes, barcodes and serials{part === 'holiday' ? ', and seasons' : ''}.</p>
          </StateMessage>
        ) : (
          <>
            {results.items.length > 0 && <p class="flbl">Items · {results.items.length}</p>}
            {results.items.map((r) => (
              <ItemResult key={r.item.id} item={r.item} path={r.path} />
            ))}
            {results.bins.length > 0 && <p class="flbl">Bins · {results.bins.length}</p>}
            {results.bins.map((r) => (
              <BinResult key={r.bin.id} bin={r.bin} path={r.path} />
            ))}
            {results.spots.length > 0 && <p class="flbl">Spots · {results.spots.length}</p>}
            {results.spots.map((r) => (
              <SpotResult key={r.spot.id} spot={r.spot} path={r.path} />
            ))}
          </>
        )}
        {searching && snap && (
          <>
            <a class="fother" href={href.tab(other, 'find', q.trim())}>
              <span>{otherCount === 0 ? `No matches in ${PART_NAME[other]}` : `${plural(otherCount, 'match', 'matches')} in ${PART_NAME[other]}`}</span>
              <Icon name="chevRight" />
            </a>
            <p class="fnote">Search looks in the part you're in; the other part's count shows here.</p>
          </>
        )}
      </div>
    </>
  );
}

function BrowseLinks() {
  const go = (by: BrowseBy) => {
    saveBrowseBy('holiday', by);
    location.hash = href.tab('holiday', 'browse');
  };
  return (
    <>
      <p class="flbl">Browse</p>
      <div class="fbrowse">
        <button type="button" class="btn" onClick={() => go('season')}>
          <Icon name="season" />
          By season
        </button>
        <button type="button" class="btn" onClick={() => go('place')}>
          <Icon name="area" />
          By place
        </button>
        <button type="button" class="btn" onClick={() => go('category')}>
          <Icon name="folder" />
          By category
        </button>
      </div>
    </>
  );
}

function ItemResult({ item, path }: { item: Item; path: string }) {
  return (
    <a class="fres" href={href.item(item.id)}>
      <Thumb itemId={item.id} hasPhoto={item.hasPhoto} />
      <span class="rt">
        <strong>{item.name}</strong>
        <span>{path}</span>
      </span>
      <span class="q">{qtyText(item)}</span>
    </a>
  );
}

function PlaceThumb({ id, icon }: { id: string; icon: 'inventory' | 'pin' }) {
  const url = useThumbnail(id);
  return url ? (
    <img class="thumb" src={url} alt="" />
  ) : (
    <span class="fic">
      <Icon name={icon} />
    </span>
  );
}

function BinResult({ bin, path }: { bin: Bin; path: string }) {
  return (
    <a class="fres" href={href.bin(bin.id)} aria-label={binLabel(bin)}>
      <PlaceThumb id={bin.id} icon="inventory" />
      <span class="rt">
        <span class="code" style={{ color: 'var(--ink)' }}>
          {bin.code}
        </span>
        <span>
          {bin.name} · {path}
        </span>
      </span>
    </a>
  );
}

function SpotResult({ spot, path }: { spot: Spot; path: string }) {
  return (
    <a class="fres" href={href.spot(spot.id)}>
      <PlaceThumb id={spot.id} icon="pin" />
      <span class="rt">
        <strong>{spot.name}</strong>
        <span>{path}</span>
      </span>
    </a>
  );
}
