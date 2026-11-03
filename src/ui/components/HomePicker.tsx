// Choosing a home (SPEC v3.0 F7, F16): for an item, a bin or a spot (or no home yet); for a bin,
// a spot (or no spot). Areas in walk order, each with its spots and the bins on them; bins with
// no spot last. Recently used homes first; a search narrows the list. The places shown are the
// current part's; "Show Holiday places" (or Household) offers the other part's, and choosing one
// moves the item or bin to that part (§3), with the button naming the part.
import { useMemo, useState } from 'preact/hooks';
import type { InventorySnapshot } from '../../data/inventory';
import { partView } from '../../domain/parts';
import { otherPart, PART_NAME, type Part } from '../../domain/types';
import { binLabel, indexPlaces, pathText, spotPath, binPath } from '../../domain/places';
import { normalize } from '../../domain/search';
import { Icon } from '../icons';
import { Dialog, DialogActions } from './Dialog';

type Snap = Pick<InventorySnapshot, 'areas' | 'spots' | 'bins'>;
/** Both parts' records, for the link to the other part's places. */
type All = Pick<InventorySnapshot, 'areas' | 'spots' | 'bins' | 'items' | 'seasons' | 'tags' | 'categories'>;

interface Option {
  id: string;
  kind: 'spot' | 'bin';
  label: string;
  /** The whole path, searched and shown for recent picks. */
  path: string;
  indent: boolean;
}

export function HomePicker(props: {
  snap: Snap;
  /** With `part`: offers the other part's places too. */
  all?: All;
  part?: Part;
  /** item: bins and spots; bin: spots only. */
  mode: 'item' | 'bin';
  title: string;
  /** The current home id ('' for none). */
  current: string;
  recent?: readonly string[];
  submitLabel?: string;
  onPick: (id: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState(props.current);
  const other = props.part ? otherPart(props.part) : null;
  const [across, setAcross] = useState(false);
  const places: Snap = useMemo(() => (across && props.all && other ? partView(props.all, other) : props.snap), [across, props.all, props.snap, other]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const none = props.mode === 'item' ? 'No home yet' : 'No spot';

  const { groups, byId } = useMemo(() => {
    const ix = indexPlaces(places);
    const byId = new Map<string, Option>();
    const opt = (o: Option) => (byId.set(o.id, o), o);
    const binsOn = (spotId: string) => places.bins.filter((b) => b.spotId === spotId).sort((a, b) => a.code.localeCompare(b.code, 'en-US', { numeric: true }));
    const groups: { title: string; options: Option[] }[] = [];
    for (const a of [...places.areas].sort((x, y) => x.order - y.order)) {
      const options: Option[] = [];
      for (const s of places.spots.filter((x) => x.areaId === a.id).sort((x, y) => x.order - y.order)) {
        options.push(opt({ id: s.id, kind: 'spot', label: s.name, path: pathText(spotPath(s, ix)), indent: false }));
        if (props.mode === 'item') for (const b of binsOn(s.id)) options.push(opt({ id: b.id, kind: 'bin', label: binLabel(b), path: pathText(binPath(b, ix)), indent: true }));
      }
      groups.push({ title: `${a.name} (${a.letter})`, options });
    }
    if (props.mode === 'item') {
      const loose = binsOn('').map((b) => opt({ id: b.id, kind: 'bin', label: binLabel(b), path: pathText(binPath(b, ix)), indent: false }));
      if (loose.length) groups.push({ title: 'Bins with no spot', options: loose });
    }
    return { groups, byId };
  }, [places, props.mode]);

  const terms = normalize(q).split(' ').filter(Boolean);
  const matches = (o: Option) => terms.every((t) => normalize(o.path).includes(t));
  const recent = across ? [] : (props.recent ?? []).flatMap((id) => byId.get(id) ?? []).slice(0, 5);
  const chosenText = chosen === '' ? none : (byId.get(chosen)?.path ?? chosen);
  // A home in the other part moves the record there (§3): the button says so.
  const toOther = across && other !== null && chosen !== '' && byId.has(chosen);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await props.onPick(chosen);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const row = (o: Option) => (
    <button key={o.id} type="button" role="radio" aria-checked={chosen === o.id} class={`hp-row${o.indent ? ' in' : ''}${chosen === o.id ? ' on' : ''}`} onClick={() => setChosen(o.id)}>
      <Icon name={o.kind === 'bin' ? 'inventory' : 'pin'} />
      <span class="grow">{terms.length ? o.path : o.label}</span>
      {chosen === o.id && <Icon name="check" />}
    </button>
  );

  return (
    <Dialog label={props.title} wide onClose={() => !busy && props.onClose()}>
      <h2 class="h2">{props.title}</h2>
      <input class="field" type="search" aria-label="Find a place" placeholder="Find an area, spot or bin…" autoComplete="off" value={q} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
      <div class="hp-list" role="radiogroup" aria-label={props.title}>
        {other && props.all && (
          <button
            type="button"
            class="btn sm"
            onClick={() => {
              setAcross(!across);
              setChosen(props.current);
            }}
          >
            {across ? `Back to ${PART_NAME[props.part!]} places` : `Show ${PART_NAME[other]} places`}
          </button>
        )}
        {!terms.length && !across && (
          <button type="button" role="radio" aria-checked={chosen === ''} class={chosen === '' ? 'hp-row on' : 'hp-row'} onClick={() => setChosen('')}>
            <Icon name="close" />
            <span class="grow">{none}</span>
            {chosen === '' && <Icon name="check" />}
          </button>
        )}
        {!terms.length && recent.length > 0 && (
          <div class="hp-group">
            <span class="lbl">Recent</span>
            {recent.map((o) => row({ ...o, label: o.path, indent: false }))}
          </div>
        )}
        {groups.map((g) => {
          const shown = g.options.filter(matches);
          if (terms.length && shown.length === 0) return null;
          return (
            <div class="hp-group" key={g.title}>
              <span class="lbl">{g.title}</span>
              {shown.length ? shown.map(row) : <span class="small muted">No spots yet. Add them in More › Areas & spots.</span>}
            </div>
          );
        })}
        {groups.length === 0 && <p class="muted m0">No areas yet. Add them in More › Areas & spots.</p>}
      </div>
      <p class="small m0">
        Chosen: <strong>{chosenText}</strong>
      </p>
      {toOther && (
        <p class="small m0 warn-t">
          This moves it to {PART_NAME[other!]}: {props.mode === 'bin' ? 'the bin and everything in it lose' : 'it loses'} {props.part === 'holiday' ? 'season and tags' : 'tags'}, and categories are matched by name in {PART_NAME[other!]} (else Other).
        </p>
      )}
      {error && (
        <div class="err" role="alert">
          {error}
        </div>
      )}
      <DialogActions>
        <button type="button" class="btn lg" disabled={busy} onClick={props.onClose}>
          Cancel
        </button>
        <button type="button" class="btn pri lg" disabled={busy || chosen === props.current || (across && !toOther)} onClick={() => void go()}>
          {toOther ? `Move to ${PART_NAME[other!]}` : (props.submitLabel ?? 'Move here')}
        </button>
      </DialogActions>
    </Dialog>
  );
}
