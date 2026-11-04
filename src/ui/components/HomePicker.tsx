// Choosing a home (SPEC v3.0 F7, F16): for an item, a bin or a spot (or no home yet); for a bin,
// a spot (or no spot). Areas in walk order, each with its spots and the bins on them; bins with
// no spot last. Recently used homes first; a search narrows the list. The places shown are the
// current part's; "Show Holiday places" (or Household) offers the other part's, and choosing one
// moves the item or bin to that part (§3), with the button naming the part.
// A missing area or spot can be added right here, and an item can be "Loose in" an area: on its
// Loose spot, made when first chosen (Dan, 2026-11-04). These are stored at once, unlike the item.
import { useMemo, useState } from 'preact/hooks';
import type { InventorySnapshot } from '../../data/inventory';
import { addArea, addSpot } from '../../data/places';
import { partView } from '../../domain/parts';
import { otherPart, PART_NAME, type Part } from '../../domain/types';
import { binLabel, indexPlaces, isLooseSpot, LOOSE_SPOT, pathText, spotPath, binPath } from '../../domain/places';
import { normalize } from '../../domain/search';
import { useDb } from '../data-hooks';
import { Icon } from '../icons';
import { getPart } from '../part';
import { Dialog, DialogActions } from './Dialog';

type Snap = Pick<InventorySnapshot, 'areas' | 'spots' | 'bins'>;
/** Both parts' records, for the link to the other part's places. */
type All = Pick<InventorySnapshot, 'areas' | 'spots' | 'bins' | 'items' | 'seasons' | 'tags' | 'categories'>;

/** A "Loose in" row whose area has no Loose spot yet: the spot is made on Choose. */
const LOOSE_NEW = 'loose:';

interface Option {
  id: string;
  kind: 'spot' | 'bin' | 'loose';
  label: string;
  /** The whole path, searched and shown for recent picks. */
  path: string;
  indent: boolean;
}

type Adding = { kind: 'area' } | { kind: 'spot'; areaId: string } | null;

export function HomePicker(props: {
  snap: Snap;
  /** With `all`: offers the other part's places too. Also the part new areas go in (else the part in use). */
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
  const db = useDb();
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState(props.current);
  const other = props.part ? otherPart(props.part) : null;
  const [across, setAcross] = useState(false);
  const places: Snap = useMemo(() => (across && props.all && other ? partView(props.all, other) : props.snap), [across, props.all, props.snap, other]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<Adding>(null);
  const [newName, setNewName] = useState('');
  const none = props.mode === 'item' ? 'No home yet' : 'No spot';

  const { groups, byId } = useMemo(() => {
    const ix = indexPlaces(places);
    const byId = new Map<string, Option>();
    const opt = (o: Option) => (byId.set(o.id, o), o);
    const binsOn = (spotId: string) => places.bins.filter((b) => b.spotId === spotId).sort((a, b) => a.code.localeCompare(b.code, 'en-US', { numeric: true }));
    const groups: { areaId: string; title: string; options: Option[] }[] = [];
    for (const a of [...places.areas].sort((x, y) => x.order - y.order)) {
      const options: Option[] = [];
      const spots = places.spots.filter((x) => x.areaId === a.id).sort((x, y) => x.order - y.order);
      const loose = spots.find(isLooseSpot);
      const spotRow = (s: (typeof spots)[number]) => {
        options.push(opt({ id: s.id, kind: 'spot', label: s.name, path: pathText(spotPath(s, ix)), indent: false }));
        if (props.mode === 'item') for (const b of binsOn(s.id)) options.push(opt({ id: b.id, kind: 'bin', label: binLabel(b), path: pathText(binPath(b, ix)), indent: true }));
      };
      if (props.mode === 'item') {
        // First in each area, so a loose item never needs a made-up spot.
        options.push(opt({ id: loose?.id ?? LOOSE_NEW + a.id, kind: 'loose', label: `Loose in ${a.name} (no set spot)`, path: `${a.name} › ${LOOSE_SPOT}`, indent: false }));
        if (loose) for (const b of binsOn(loose.id)) options.push(opt({ id: b.id, kind: 'bin', label: binLabel(b), path: pathText(binPath(b, ix)), indent: true }));
        spots.filter((s) => s !== loose).forEach(spotRow);
      } else spots.forEach(spotRow);
      groups.push({ areaId: a.id, title: a.name, options });
    }
    if (props.mode === 'item') {
      const loose = binsOn('').map((b) => opt({ id: b.id, kind: 'bin', label: binLabel(b), path: pathText(binPath(b, ix)), indent: false }));
      if (loose.length) groups.push({ areaId: '', title: 'Bins with no spot', options: loose });
    }
    return { groups, byId };
  }, [places, props.mode]);

  const terms = normalize(q).split(' ').filter(Boolean);
  const matches = (o: Option) => terms.every((t) => normalize(o.path).includes(t));
  const recent = across ? [] : (props.recent ?? []).flatMap((id) => byId.get(id) ?? []).slice(0, 5);
  const chosenText = chosen === '' ? none : (byId.get(chosen)?.path ?? chosen);
  // A home in the other part moves the record there (§3): the button says so.
  const toOther = across && other !== null && chosen !== '' && byId.has(chosen);
  const canAdd = !across && terms.length === 0;

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      let id = chosen;
      if (id.startsWith(LOOSE_NEW)) id = (await addSpot(db, id.slice(LOOSE_NEW.length), { name: LOOSE_SPOT })).id;
      await props.onPick(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const startAdding = (a: Adding) => {
    setAdding(a);
    setNewName('');
    setError(null);
  };

  const add = async () => {
    if (!adding || newName.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      if (adding.kind === 'area') {
        const area = await addArea(db, props.part ?? getPart(), { name: newName });
        // An item can live loose in the new area straight away; a bin needs a spot in it.
        if (props.mode === 'item') {
          setChosen(LOOSE_NEW + area.id);
          setAdding(null);
        } else setAdding({ kind: 'spot', areaId: area.id });
      } else {
        const spot = await addSpot(db, adding.areaId, { name: newName });
        setChosen(spot.id);
        setAdding(null);
      }
      setNewName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const addForm = (label: string, placeholder: string) => (
    <div class="inline-add">
      <input
        class="field"
        aria-label={label}
        placeholder={placeholder}
        autoComplete="off"
        value={newName}
        ref={(el) => el?.focus()}
        onInput={(e) => setNewName((e.currentTarget as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void add();
          }
          if (e.key === 'Escape') {
            e.stopPropagation();
            setAdding(null);
          }
        }}
      />
      <button type="button" class="btn" disabled={busy || newName.trim() === ''} onClick={() => void add()}>
        Add
      </button>
      <button type="button" class="btn" aria-label="Cancel adding" disabled={busy} onClick={() => setAdding(null)}>
        <Icon name="close" />
      </button>
    </div>
  );

  const row = (o: Option) => (
    <button key={o.id} type="button" role="radio" aria-checked={chosen === o.id} class={`hp-row${o.indent ? ' in' : ''}${o.kind === 'loose' ? ' loose' : ''}${chosen === o.id ? ' on' : ''}`} onClick={() => setChosen(o.id)}>
      <Icon name={o.kind === 'bin' ? 'inventory' : o.kind === 'loose' ? 'area' : 'pin'} />
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
              setAdding(null);
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
          const addingHere = adding?.kind === 'spot' && adding.areaId === g.areaId;
          return (
            <div class="hp-group" key={g.areaId || g.title}>
              <span class="lbl">{g.title}</span>
              {shown.length ? shown.map(row) : <span class="small muted">No spots yet.</span>}
              {canAdd && g.areaId !== '' &&
                (addingHere ? (
                  addForm(`New spot in ${g.title}`, `New spot in ${g.title} — e.g. Top shelf`)
                ) : (
                  <button type="button" class="btn sm hp-add" disabled={busy} onClick={() => startAdding({ kind: 'spot', areaId: g.areaId })}>
                    <Icon name="plus" />
                    Add a spot in {g.title}
                  </button>
                ))}
            </div>
          );
        })}
        {groups.length === 0 && <p class="muted m0">No areas yet. Add one below: a room or zone, like Garage or Guest closet.</p>}
        {canAdd && (
          <div class="hp-group">
            {adding?.kind === 'area' ? (
              addForm('New area', 'New area — e.g. Guest closet')
            ) : (
              <button type="button" class="btn sm hp-add" disabled={busy} onClick={() => startAdding({ kind: 'area' })}>
                <Icon name="plus" />
                Add an area
              </button>
            )}
          </div>
        )}
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
