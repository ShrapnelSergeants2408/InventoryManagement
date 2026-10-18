// QR labels (F20, SPEC §9; mockups 6a–6d): 1 choose items (by category, or by location in
// walk order) → 2 layout, start position, nudge, preview → print or test print through the
// browser's print dialog. No PIN.
import { createPortal } from 'preact/compat';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { InventorySnapshot } from '../../../data/inventory';
import { getNudge, setNudge } from '../../../data/labels';
import { loadLabelChoice, saveLabelChoice } from '../../../data/prefs';
import {
  NO_NUDGE,
  PLAIN_ID,
  PLAIN_QR_SIZES,
  SHEET_LAYOUTS,
  boxAt,
  clampStart,
  labelGroups,
  layoutById,
  perSheet,
  planSheets,
  plainLayout,
  stepNudge,
  type LabelGroup,
  type Nudge,
  type PlainQrSize,
} from '../../../domain/labels';
import type { Item } from '../../../domain/types';
import { TopBar, plural } from '../../components/common';
import { Dialog, DialogActions } from '../../components/Dialog';
import { useDb, useSnapshot, useThumbnail } from '../../data-hooks';
import { Icon } from '../../icons';
import { StorageError } from '../StorageError';
import { SheetPage } from './LabelSheet';

// The selection lives for the session, so leaving Labels and coming back keeps it.
let remembered = new Set<string>();

export function LabelsScreen({ ids }: { ids: string[] | null }) {
  const live = useSnapshot();
  if (live.state === 'error') {
    return (
      <>
        <TopBar title="QR labels" />
        <StorageError error={live.error} />
      </>
    );
  }
  if (live.state === 'loading') {
    return (
      <>
        <TopBar title="QR labels" />
        <div class="state" aria-busy="true">
          <p class="state-text muted">Loading…</p>
        </div>
      </>
    );
  }
  return <Labels snap={live.value} ids={ids} />;
}

function Labels({ snap, ids }: { snap: InventorySnapshot; ids: string[] | null }) {
  const known = useMemo(() => new Set(snap.items.map((i) => i.id)), [snap.items]);
  // Opened from an item's card ("Print QR label"): that item, straight to the layout.
  const [selected, setSelectedState] = useState<Set<string>>(() => (ids ? new Set(ids.filter((id) => known.has(id))) : new Set([...remembered].filter((id) => known.has(id)))));
  const [chosenStep, setStep] = useState<'select' | 'layout'>(() => (ids && ids.some((id) => known.has(id)) ? 'layout' : 'select'));
  const setSelected = (s: Set<string>) => {
    remembered = s;
    setSelectedState(s);
  };
  // Grouping chosen in step 1; labels print in that order (by location: the walk order, F25).
  const [by, setBy] = useState<'category' | 'location'>('category');
  const groups = useMemo(() => labelGroups(snap.items, snap.categories, snap.locations, by), [snap, by]);
  // Deleted items drop out of the selection.
  const chosen = groups.flatMap((g) => g.items).filter((i) => selected.has(i.id));
  const step = chosen.length === 0 ? 'select' : chosenStep;

  const steps = (
    <div class="lsteps" aria-label="Steps">
      <span class={step === 'select' ? 'stp on' : 'stp'} aria-current={step === 'select' ? 'step' : undefined}>
        <b>1</b>Choose items
      </span>
      <Icon name="chevRight" />
      <span class={step === 'layout' ? 'stp on' : 'stp'} aria-current={step === 'layout' ? 'step' : undefined}>
        <b>2</b>Layout &amp; print
      </span>
    </div>
  );
  return (
    <>
      <TopBar title="QR labels">
        <span class="grow" />
        {steps}
      </TopBar>
      {step === 'select' ? (
        <Choose groups={groups} by={by} onBy={setBy} selected={selected} chosen={chosen} onChange={setSelected} onNext={() => setStep('layout')} />
      ) : (
        <Layout chosen={chosen} onBack={() => setStep('select')} />
      )}
    </>
  );
}

// ── Step 1: choose items ──

function Box({ state }: { state: 'on' | 'some' | 'off' }) {
  return <span class={state === 'off' ? 'cbox' : `cbox ${state}`}>{state === 'on' ? <Icon name="check" /> : state === 'some' ? <Icon name="minus" /> : null}</span>;
}

function Choose(props: {
  groups: LabelGroup[];
  by: 'category' | 'location';
  onBy: (by: 'category' | 'location') => void;
  selected: Set<string>;
  chosen: Item[];
  onChange: (s: Set<string>) => void;
  onNext: () => void;
}) {
  const { selected, groups, by } = props;
  const [open, setOpen] = useState<Set<string>>(new Set());
  const set = (ids: string[], on: boolean) => {
    const next = new Set(selected);
    for (const id of ids) on ? next.add(id) : next.delete(id);
    props.onChange(next);
  };
  const toggleOpen = (name: string) => {
    const next = new Set(open);
    next.has(name) ? next.delete(name) : next.add(name);
    setOpen(next);
  };
  const byCat = new Map<string, number>();
  for (const i of props.chosen) byCat.set(i.category, (byCat.get(i.category) ?? 0) + 1);

  return (
    <div class="lbody">
      <div class="lpane">
        <div class="chips-row" role="tablist" aria-label="Group items">
          {(['category', 'location'] as const).map((b) => (
            <button
              key={b}
              type="button"
              role="tab"
              aria-selected={by === b}
              class={by === b ? 'fchip on' : 'fchip'}
              onClick={() => {
                props.onBy(b);
                setOpen(new Set());
              }}
            >
              {b === 'category' ? 'By category' : 'By location'}
            </button>
          ))}
        </div>
        {groups.map((g) => {
          const n = g.items.filter((i) => selected.has(i.id)).length;
          const state = n === 0 ? 'off' : n === g.items.length ? 'on' : 'some';
          const isOpen = open.has(g.name);
          return (
            <div key={g.name} class="lgroup">
              <div class="lgrow">
                <button type="button" class="cb" role="checkbox" aria-checked={state === 'on' ? 'true' : state === 'some' ? 'mixed' : 'false'} onClick={() => set(g.items.map((i) => i.id), state !== 'on')}>
                  <Box state={state} />
                  <span>
                    <strong>{g.name}</strong> <span class="small muted">{n ? `${n} of ${g.items.length} selected` : plural(g.items.length, 'item')}</span>
                  </span>
                </button>
                <button type="button" class="exp" aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Choose'} items in ${g.name}`} onClick={() => toggleOpen(g.name)}>
                  <Icon name={isOpen ? 'chevDown' : 'chevRight'} />
                </button>
              </div>
              {isOpen &&
                g.items.map((i) => (
                  <div key={i.id} class="irow">
                    <button type="button" class="cb" role="checkbox" aria-checked={selected.has(i.id)} onClick={() => set([i.id], !selected.has(i.id))}>
                      <Box state={selected.has(i.id) ? 'on' : 'off'} />
                      <RowThumb item={i} />
                      <span class="irow-t">
                        <strong>{i.name}</strong> <span class="small muted">{by === 'category' ? i.location : i.category}</span>
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
          <span class="bignum">{plural(props.chosen.length, 'label')}</span>
          <span class="small muted">{[...byCat].map(([c, k]) => `${c} ${k}`).join(' · ') || 'Nothing selected yet'}</span>
        </div>
        <ul class="rlist">
          {props.chosen.map((i) => (
            <li key={i.id} class="small">
              {i.name}
            </li>
          ))}
        </ul>
        <div class="racts">
          <button type="button" class="btn pri lg" disabled={props.chosen.length === 0} onClick={props.onNext}>
            Next: layout
            <Icon name="chevRight" />
          </button>
          <button type="button" class="btn sm" disabled={props.chosen.length === 0} onClick={() => props.onChange(new Set())}>
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

function Layout({ chosen, onBack }: { chosen: Item[]; onBack: () => void }) {
  const db = useDb();
  const [choice, setChoice] = useState(() => {
    const c = loadLabelChoice();
    const plainQr = (PLAIN_QR_SIZES as readonly number[]).includes(c.plainQr ?? 0) ? (c.plainQr as PlainQrSize) : 1;
    return { layoutId: c.layoutId && layoutById(c.layoutId) ? c.layoutId : SHEET_LAYOUTS[0]!.id, plainQr };
  });
  const layout = layoutById(choice.layoutId, choice.plainQr)!;
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
  const pageLabels = (k: number) => plan.pages[k]!.labels.map((box, j) => ({ box, item: chosen[offsets[k]! + j]! }));

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
          {plural(chosen.length, 'item')} selected
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
              : 'Labels encode the item ID (e.g. 2408:st-0063), so they keep working if the item is renamed.'}
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
