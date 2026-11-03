// QR labels (SPEC v3.0 F10, §9), for the current part: 1 choose bins (by area, or by season in
// Holiday; "Out-of-date labels" picks the bins whose contents changed), spots or items → 2 layout,
// start position, nudge, preview → print or test print through the browser's print dialog. Bin
// labels carry the code large, the name, the season chip and the contents (5163, the default
// when bins are chosen); printing them records what they say (§4 "Label out of date").
import { createPortal } from 'preact/compat';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { InventorySnapshot } from '../../../data/inventory';
import { getNudge, recordBinLabels, setNudge } from '../../../data/labels';
import { loadLabelChoice, saveLabelChoice } from '../../../data/prefs';
import { kindOfId } from '../../../domain/ids';
import {
  binLabelGroups,
  binLabelState,
  labelFace,
  labelGroups,
  labelPath,
  NO_NUDGE,
  PLAIN_ID,
  PLAIN_QR_SIZES,
  SHEET_LAYOUTS,
  boxAt,
  clampStart,
  layoutById,
  perSheet,
  planSheets,
  plainLayout,
  spotLabelGroups,
  stepNudge,
  type LabelTarget,
  type Nudge,
  type PlainQrSize,
} from '../../../domain/labels';
import { binContents, binLabel, indexPlaces } from '../../../domain/places';
import { PART_NAME, type Item, type Part } from '../../../domain/types';
import { CheckBox, TopBar, plural } from '../../components/common';
import { Dialog, DialogActions } from '../../components/Dialog';
import { useDb, usePartSnapshot, useThumbnail } from '../../data-hooks';
import { Icon } from '../../icons';
import { StorageError } from '../StorageError';
import { SheetPage } from './LabelSheet';

type Kind = 'bin' | 'spot' | 'item';
const KIND_NAME: Readonly<Record<Kind, [string, string]>> = { bin: ['bin', 'Bins'], spot: ['spot', 'Spots'], item: ['item', 'Items'] };

// The selection lives for the session (per part), so leaving Labels and coming back keeps it.
const remembered: Record<Part, Set<string>> = { household: new Set(), holiday: new Set() };

export function LabelsScreen({ part, ids }: { part: Part; ids: string[] }) {
  const { live, snap } = usePartSnapshot(part);
  if (live.state === 'error') {
    return (
      <>
        <TopBar title="QR labels" />
        <StorageError error={live.error} />
      </>
    );
  }
  if (!snap) {
    return (
      <>
        <TopBar title="QR labels" />
        <div class="state" aria-busy="true">
          <p class="state-text muted">Loading…</p>
        </div>
      </>
    );
  }
  return <Labels snap={snap} part={part} ids={ids} />;
}

/** One entry of a choosing group: a bin, spot or item. */
interface Entry {
  id: string;
  title: string;
  sub: string;
  item?: Item;
}
interface Group {
  key: string;
  name: string;
  entries: Entry[];
}

function Labels({ snap, part, ids }: { snap: InventorySnapshot; part: Part; ids: string[] }) {
  const known = useMemo(() => new Set([...snap.items, ...snap.bins, ...snap.spots].map((r) => r.id)), [snap]);
  // Opened from a card ("Print label"): that record, straight to the layout.
  const given = ids.filter((id) => known.has(id));
  const [selected, setSelectedState] = useState<Set<string>>(() => (given.length ? new Set(given) : new Set([...remembered[part]].filter((id) => known.has(id)))));
  const [chosenStep, setStep] = useState<'select' | 'layout'>(() => (given.length ? 'layout' : 'select'));
  const setSelected = (s: Set<string>) => {
    remembered[part] = s;
    setSelectedState(s);
  };
  const [kind, setKind] = useState<Kind>(() => (given[0] ? ((kindOfId(given[0]) as Kind | null) ?? 'bin') : 'bin'));
  const [binBy, setBinBy] = useState<'area' | 'season'>(part === 'holiday' ? 'season' : 'area');
  const [itemBy, setItemBy] = useState<'category' | 'area'>('category');

  const ix = useMemo(() => indexPlaces(snap), [snap]);
  const seasons = useMemo(() => new Map(snap.seasons.map((s) => [s.id, s])), [snap]);
  const stale = useMemo(() => snap.bins.filter((b) => binLabelState(b, snap.items) === 'stale'), [snap]);
  const groups: Record<Kind, Group[]> = useMemo(
    () => ({
      bin: binLabelGroups(snap, snap.seasons, binBy).map((g) => ({
        key: g.key,
        name: g.name,
        entries: g.list.map((b) => ({ id: b.id, title: binLabel(b), sub: binLabelState(b, snap.items) === 'stale' ? 'Label out of date' : binLabelState(b, snap.items) === 'none' ? 'No label yet' : 'Label up to date' })),
      })),
      spot: spotLabelGroups(snap).map((g) => ({ key: g.key, name: g.name, entries: g.list.map((s) => ({ id: s.id, title: s.name, sub: g.name })) })),
      item: labelGroups(snap.items, snap.categories, snap, itemBy).map((g) => ({
        key: g.name,
        name: g.name,
        entries: g.items.map((i) => ({ id: i.id, title: i.name, sub: itemBy === 'category' ? labelPath(i, snap) || 'No home yet' : i.category, item: i })),
      })),
    }),
    [snap, binBy, itemBy],
  );

  // What prints, in order: bins, then spots, then items, each in its groups' order.
  const targets: LabelTarget[] = useMemo(() => {
    const out: LabelTarget[] = [];
    const bins = new Map(snap.bins.map((b) => [b.id, b]));
    const spots = new Map(snap.spots.map((s) => [s.id, s]));
    const items = new Map(snap.items.map((i) => [i.id, i]));
    for (const k of ['bin', 'spot', 'item'] as const) {
      for (const g of groups[k]) {
        for (const e of g.entries) {
          if (!selected.has(e.id)) continue;
          const bin = bins.get(e.id);
          const spot = spots.get(e.id);
          const item = items.get(e.id);
          if (bin) {
            const s = seasons.get(bin.seasonId);
            out.push({ kind: 'bin', bin, contents: binContents(snap.items, bin.id), season: s ? { name: s.name, color: s.color } : null });
          } else if (spot) out.push({ kind: 'spot', spot, areaName: ix.area.get(spot.areaId)?.name ?? '' });
          else if (item) out.push({ kind: 'item', item, path: labelPath(item, snap) });
        }
      }
    }
    return out;
  }, [groups, selected, snap, seasons, ix]);
  const step = targets.length === 0 ? 'select' : chosenStep;

  const steps = (
    <div class="lsteps" aria-label="Steps">
      <span class={step === 'select' ? 'stp on' : 'stp'} aria-current={step === 'select' ? 'step' : undefined}>
        <b>1</b>Choose
      </span>
      <Icon name="chevRight" />
      <span class={step === 'layout' ? 'stp on' : 'stp'} aria-current={step === 'layout' ? 'step' : undefined}>
        <b>2</b>Layout &amp; print
      </span>
    </div>
  );
  return (
    <>
      <TopBar title="QR labels" subtitle={PART_NAME[part]}>
        <span class="grow" />
        {steps}
      </TopBar>
      {step === 'select' ? (
        <Choose
          kind={kind}
          onKind={setKind}
          groups={groups[kind]}
          by={kind === 'bin' ? { value: binBy, options: part === 'holiday' ? ['season', 'area'] : ['area'], set: (v) => setBinBy(v as 'area' | 'season') } : kind === 'item' ? { value: itemBy, options: ['category', 'area'], set: (v) => setItemBy(v as 'category' | 'area') } : null}
          stale={stale.map((b) => b.id)}
          selected={selected}
          targets={targets}
          onChange={setSelected}
          onNext={() => setStep('layout')}
        />
      ) : (
        <Layout targets={targets} onBack={() => setStep('select')} />
      )}
    </>
  );
}

// ── Step 1: choose bins, spots or items ──

const BY_NAME: Record<string, string> = { area: 'By area', season: 'By season', category: 'By category' };

function Choose(props: {
  kind: Kind;
  onKind: (k: Kind) => void;
  groups: Group[];
  by: { value: string; options: string[]; set: (v: string) => void } | null;
  stale: string[];
  selected: Set<string>;
  targets: LabelTarget[];
  onChange: (s: Set<string>) => void;
  onNext: () => void;
}) {
  const { selected, groups } = props;
  const [open, setOpen] = useState<Set<string>>(new Set());
  const set = (ids: string[], on: boolean) => {
    const next = new Set(selected);
    for (const id of ids) on ? next.add(id) : next.delete(id);
    props.onChange(next);
  };
  const toggleOpen = (key: string) => {
    const next = new Set(open);
    next.has(key) ? next.delete(key) : next.add(key);
    setOpen(next);
  };
  const counts = (['bin', 'spot', 'item'] as const).map((k) => [k, props.targets.filter((t) => t.kind === k).length] as const).filter(([, n]) => n > 0);

  return (
    <div class="lbody">
      <div class="lpane">
        <div class="chips-row" role="tablist" aria-label="What to label">
          {(['bin', 'spot', 'item'] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={props.kind === k} class={props.kind === k ? 'fchip on' : 'fchip'} onClick={() => (props.onKind(k), setOpen(new Set()))}>
              {KIND_NAME[k][1]}
            </button>
          ))}
        </div>
        {props.by && props.by.options.length > 1 && (
          <div class="chips-row" role="tablist" aria-label="Group by">
            {props.by.options.map((o) => (
              <button key={o} type="button" role="tab" aria-selected={props.by!.value === o} class={props.by!.value === o ? 'fchip on' : 'fchip'} onClick={() => (props.by!.set(o), setOpen(new Set()))}>
                {BY_NAME[o]}
              </button>
            ))}
          </div>
        )}
        {props.kind === 'bin' && props.stale.length > 0 && (
          <div class="stale" role="note">
            <span>
              <strong>{plural(props.stale.length, 'bin label')} out of date.</strong> Their contents changed since printing.
            </span>
            <button type="button" class="btn" onClick={() => set(props.stale, true)}>
              Select them
            </button>
          </div>
        )}
        {groups.length === 0 && <p class="muted">{props.kind === 'item' ? 'No items yet.' : `No ${KIND_NAME[props.kind][0]}s yet. Add them in More › Areas & spots.`}</p>}
        {groups.map((g) => {
          const ids = g.entries.map((e) => e.id);
          const n = ids.filter((id) => selected.has(id)).length;
          const state = n === 0 ? 'off' : n === ids.length ? 'on' : 'some';
          const isOpen = open.has(g.key);
          return (
            <div key={g.key} class="lgroup">
              <div class="lgrow">
                <button type="button" class="cb" role="checkbox" aria-checked={state === 'on' ? 'true' : state === 'some' ? 'mixed' : 'false'} onClick={() => set(ids, state !== 'on')}>
                  <CheckBox state={state} />
                  <span>
                    <strong>{g.name}</strong> <span class="small muted">{n ? `${n} of ${ids.length} selected` : plural(ids.length, KIND_NAME[props.kind][0])}</span>
                  </span>
                </button>
                <button type="button" class="exp" aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Choose'} ${KIND_NAME[props.kind][1].toLowerCase()} in ${g.name}`} onClick={() => toggleOpen(g.key)}>
                  <Icon name={isOpen ? 'chevDown' : 'chevRight'} />
                </button>
              </div>
              {isOpen &&
                g.entries.map((e) => (
                  <div key={e.id} class="irow">
                    <button type="button" class="cb" role="checkbox" aria-checked={selected.has(e.id)} onClick={() => set([e.id], !selected.has(e.id))}>
                      <CheckBox state={selected.has(e.id) ? 'on' : 'off'} />
                      {e.item ? <RowThumb item={e.item} /> : <span class="ithumb nophoto" />}
                      <span class="irow-t">
                        <strong>{e.title}</strong> <span class="small muted">{e.sub}</span>
                      </span>
                    </button>
                  </div>
                ))}
            </div>
          );
        })}
      </div>
      <aside class="rpane" aria-label="Selected labels">
        <div class="rsum">
          <span class="lbl">Selected</span>
          <span class="bignum">{plural(props.targets.length, 'label')}</span>
          <span class="small muted">{counts.map(([k, n]) => plural(n, KIND_NAME[k][0])).join(' · ') || 'Nothing selected yet'}</span>
        </div>
        <ul class="rlist">
          {props.targets.map((t) => (
            <li key={t.kind === 'bin' ? t.bin.id : t.kind === 'spot' ? t.spot.id : t.item.id} class="small">
              {t.kind === 'bin' ? binLabel(t.bin) : t.kind === 'spot' ? t.spot.name : t.item.name}
            </li>
          ))}
        </ul>
        <div class="racts">
          <button type="button" class="btn pri lg" disabled={props.targets.length === 0} onClick={props.onNext}>
            Next: layout
            <Icon name="chevRight" />
          </button>
          <button type="button" class="btn sm" disabled={props.targets.length === 0} onClick={() => props.onChange(new Set())}>
            Clear selection
          </button>
        </div>
      </aside>
    </div>
  );
}

function RowThumb({ item }: { item: Item }) {
  const url = useThumbnail(item.id, item.hasPhoto);
  return url ? <img class="ithumb" src={url} alt="" /> : <span class="ithumb nophoto" />;
}

// ── Step 2: layout, start position, nudge, preview, print ──

function Layout({ targets, onBack }: { targets: LabelTarget[]; onBack: () => void }) {
  const db = useDb();
  const hasBins = targets.some((t) => t.kind === 'bin');
  const [choice, setChoice] = useState(() => {
    const c = loadLabelChoice();
    const plainQr = (PLAIN_QR_SIZES as readonly number[]).includes(c.plainQr ?? 0) ? (c.plainQr as PlainQrSize) : 1;
    // Bins default to 5163 (§9), which carries their contents.
    const fallback = hasBins ? 'avery-5163' : SHEET_LAYOUTS[0]!.id;
    return { layoutId: c.layoutId && layoutById(c.layoutId) ? c.layoutId : fallback, plainQr };
  });
  const layout = layoutById(choice.layoutId, choice.plainQr)!;
  const chosen = targets;
  const [start, setStart] = useState(0);
  const [nudge, setNudgeState] = useState<Nudge>(NO_NUDGE);
  // The latest nudge, so two quick taps both count.
  const nudgeNow = useRef(nudge);
  nudgeNow.current = nudge;
  const [page, setPage] = useState(0);
  // The print pages are always rendered (hidden on screen); printing picks labels or outlines.
  const [mode, setMode] = useState<'labels' | 'test'>('labels');
  const [printRequest, setPrintRequest] = useState(0);
  const [asking, setAsking] = useState<'labels' | 'test' | null>(null);

  useEffect(() => {
    let alive = true;
    void getNudge(db, layout.id).then((n) => alive && setNudgeState(n));
    return () => {
      alive = false;
    };
  }, [db, layout.id]);

  const pick = (layoutId: string, plainQr = choice.plainQr) => {
    const next = { layoutId, plainQr };
    setChoice(next);
    saveLabelChoice(next);
    setStart(0);
    setPage(0);
  };
  const s = clampStart(layout, start);
  const plan = planSheets(layout, chosen.length, s, nudge);
  const sheets = plan.pages.length;
  const shown = Math.min(page, sheets - 1);
  const offsets = plan.pages.map((p, k) => plan.pages.slice(0, k).reduce((n, q) => n + q.labels.length, 0));
  const pageLabels = (k: number) => plan.pages[k]!.labels.map((box, j) => ({ box, face: labelFace(chosen[offsets[k]! + j]!, layout.content) }));

  const nudgeBy = (field: keyof Nudge, dir: 1 | -1) => {
    const cur = nudgeNow.current;
    const next = { ...cur, [field]: stepNudge(cur[field], dir) };
    nudgeNow.current = next;
    setNudgeState(next);
    void setNudge(db, layout.id, next);
  };
  const mm = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} mm`;

  // After the chosen pages have rendered, open the browser's print dialog.
  useEffect(() => {
    if (printRequest === 0) return;
    const done = () => setMode('labels');
    addEventListener('afterprint', done, { once: true });
    print();
    return () => removeEventListener('afterprint', done);
  }, [printRequest]);

  const startText = s ? `Starting at label ${s + 1} (row ${Math.floor(s / layout.cols) + 1}, column ${(s % layout.cols) + 1}).` : 'Starting at label 1.';
  const pageText = `Sheet ${shown + 1} of ${sheets} · ${layout.short} · ${plural(plan.pages[shown]?.labels.length ?? 0, 'label')} on this sheet${shown === 0 && s ? ` · ${s} already used` : ''}`;
  const allBoxes = Array.from({ length: perSheet(layout) }, (_, k) => boxAt(layout, k, nudge));

  return (
    <div class="cfg">
      <div class="cfgl">
        <button type="button" class="btn sm back-sel" onClick={onBack}>
          <Icon name="chevLeft" />
          {plural(chosen.length, 'label')} selected
        </button>
        <section>
          <h2 class="h2">Label sheet</h2>
          <div class="lays" role="radiogroup" aria-label="Label layout">
            {[...SHEET_LAYOUTS, plainLayout(choice.plainQr)].map((l) => (
              <button key={l.id} type="button" role="radio" aria-checked={l.id === layout.id} class={l.id === layout.id ? 'lay on' : 'lay'} onClick={() => pick(l.id)}>
                <strong>{l.name}</strong>
                <span class="small muted">{l.desc}</span>
              </button>
            ))}
          </div>
          {layout.plain && (
            <div class="chips-row qr-sizes" role="radiogroup" aria-label="QR size">
              <span class="small muted">
                <strong>QR size</strong>
              </span>
              {PLAIN_QR_SIZES.map((q) => (
                <button key={q} type="button" role="radio" aria-checked={choice.plainQr === q} class={choice.plainQr === q ? 'fchip on' : 'fchip'} onClick={() => pick(PLAIN_ID, q)}>
                  {q === 1 ? '1 in' : q === 1.5 ? '1½ in' : '2 in'}
                </button>
              ))}
            </div>
          )}
        </section>
        {!layout.plain && (
          <section>
            <h2 class="h2">Start position</h2>
            <p class="small muted sec-p">Sheet already partly used? Tap the first empty label. {startText}</p>
            <div class="mini" style={{ gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))` }}>
              {allBoxes.map((b) => (
                <button
                  key={b.slot}
                  type="button"
                  class={b.slot < s ? 'cell used' : b.slot === s ? 'cell start' : 'cell'}
                  aria-label={`Start at label ${b.slot + 1}`}
                  aria-pressed={b.slot === s}
                  onClick={() => {
                    setStart(b.slot);
                    setPage(0);
                  }}
                >
                  {b.slot + 1}
                </button>
              ))}
            </div>
          </section>
        )}
        <section>
          <h2 class="h2">Alignment nudge</h2>
          <p class="small muted sec-p">Moves everything in 0.5 mm steps. Saved for {layout.plain ? 'plain paper' : layout.short}.</p>
          <div class="nuds">
            <div class="nud">
              <span class="nud-l">Down</span>
              <button type="button" class="step" aria-label="Move up 0.5 mm" onClick={() => nudgeBy('top', -1)}>
                <Icon name="minus" />
              </button>
              <span class="nv" aria-live="polite" aria-label={`Down ${mm(nudge.top)}`}>
                {mm(nudge.top)}
              </span>
              <button type="button" class="step" aria-label="Move down 0.5 mm" onClick={() => nudgeBy('top', 1)}>
                <Icon name="plus" />
              </button>
            </div>
            <div class="nud">
              <span class="nud-l">Right</span>
              <button type="button" class="step" aria-label="Move left 0.5 mm" onClick={() => nudgeBy('left', -1)}>
                <Icon name="minus" />
              </button>
              <span class="nv" aria-live="polite" aria-label={`Right ${mm(nudge.left)}`}>
                {mm(nudge.left)}
              </span>
              <button type="button" class="step" aria-label="Move right 0.5 mm" onClick={() => nudgeBy('left', 1)}>
                <Icon name="plus" />
              </button>
            </div>
          </div>
        </section>
      </div>

      <div class="prevcol">
        <div class="prev">
          <div class="prev-head">
            {sheets > 1 && (
              <button type="button" class="btn sm" aria-label="Previous sheet" disabled={shown === 0} onClick={() => setPage(shown - 1)}>
                <Icon name="chevLeft" />
              </button>
            )}
            <span class="small muted prev-t">{pageText}</span>
            {sheets > 1 && (
              <button type="button" class="btn sm" aria-label="Next sheet" disabled={shown >= sheets - 1} onClick={() => setPage(shown + 1)}>
                <Icon name="chevRight" />
              </button>
            )}
          </div>
          <div class="prev-page">
            <SheetPage layout={layout} labels={pageLabels(shown)} skipped={plan.pages[shown]!.skipped} />
          </div>
        </div>
        <div class="pfoot">
          <div class="remind" role="note">
            <Icon name="print" />
            <span>
              In the print dialog set Scale to <u>100% / Actual size</u>. “Fit to page” shifts every label.
            </span>
          </div>
          <div class="pacts-row">
            <button type="button" class="btn" onClick={() => setAsking('test')}>
              Test print (outlines only)
            </button>
            <button type="button" class="btn pri lg grow" onClick={() => setAsking('labels')}>
              <Icon name="print" />
              Print {plural(chosen.length, 'label')}
            </button>
          </div>
        </div>
      </div>

      {asking && (
        <Dialog label="Before you print" onClose={() => setAsking(null)}>
          <div class="dlg-head">
            <span class="dlg-ic navy">
              <Icon name="print" />
            </span>
            <h2 class="h2">{asking === 'test' ? 'Test print: outlines on plain paper' : 'Before you print'}</h2>
          </div>
          <p class="dlg-big">In the print dialog that opens next, check three settings:</p>
          <ol class="dlg-list">
            <li>
              Paper size: <strong>Letter</strong>
            </li>
            <li>
              Scale: <strong>100% / Actual size</strong> — <span class="warn-t">not “Fit to page”</span>
            </li>
            <li>
              Pages: <strong>All</strong> ({asking === 'test' ? '1 sheet' : plural(sheets, 'sheet')})
            </li>
          </ol>
          <p class="small muted">
            {asking === 'test'
              ? 'Prints only the label outlines, numbered. Hold the page against a label sheet up to a light; if the boxes are off, adjust the nudge and test again.'
              : 'Labels encode the record’s ID (e.g. hhi:bn-7K2M9QXP), so they keep working after a rename or a move.'}
          </p>
          <DialogActions>
            <button type="button" class="btn lg" onClick={() => setAsking(null)}>
              Back
            </button>
            <button
              type="button"
              class="btn pri lg"
              data-autofocus
              onClick={() => {
                setMode(asking);
                setAsking(null);
                setPrintRequest((n) => n + 1);
                // What a bin label says is recorded as it prints (§4 "Label out of date").
                if (asking === 'labels') void recordBinLabels(db, chosen.flatMap((t) => (t.kind === 'bin' ? [t.bin.id] : [])));
              }}
            >
              Open print dialog
            </button>
          </DialogActions>
        </Dialog>
      )}

      {createPortal(
          <div id="print-root" data-mode={mode}>
            {mode === 'test' ? (
              <SheetPage layout={layout} labels={[]} outlines={allBoxes} caption={`Test print · ${layout.name} · nudge ${mm(nudge.top)} down, ${mm(nudge.left)} right · print at 100%`} />
            ) : (
              plan.pages.map((_, k) => <SheetPage key={k} layout={layout} labels={pageLabels(k)} />)
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
