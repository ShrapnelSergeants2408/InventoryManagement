// First-launch setup (§6, F22, spec-questions Q2; mockups 9f–9k): set the mentor PIN (typed
// twice), write down the recovery code, then choose what the inventory starts with: the
// starter catalog, a backup file (a wiped or replacement tablet), or empty lists. The PIN and
// recovery code are saved together after "I wrote it down"; the inventory and "setup done"
// are saved together at the end, so closing the app part-way shows the remaining step again.
import { useRef, useState } from 'preact/hooks';
import logoUrl from '../../../assets/team-logo-512.png?url';
import seedUrl from '../../../seed/frc2408-starter-catalog-2026-10-21.zip?url';
import type { ReplaceAllInput } from '../../data/inventory';
import { savePinAndRecovery } from '../../data/pin';
import { emptyStart, requestPersistentStorage, startInventory, type StartChoice } from '../../data/setup';
import { orderTotalCents } from '../../domain/count';
import { formatDateTime } from '../../domain/dates';
import { formatCents } from '../../domain/money';
import { readRestoreFile, type RestorePlan } from '../../io/restore';
import { readSeed } from '../../io/seed';
import { newRecoveryCode } from '../../security/pin';
import { plural } from '../components/common';
import { NewPinPad } from '../components/PinPad';
import { forgetAllThumbnails, useDb } from '../data-hooks';
import { Icon } from '../icons';
import { RecoveryCodeCard } from '../shell/PinFlows';
import { href } from '../shell/router';

const STEPS = ['Set mentor PIN', 'Save recovery code', 'Load starter catalog'];
const BACKUP_ACCEPT = '.zip,.csv,application/zip,application/x-zip-compressed,text/csv,text/comma-separated-values';

export function SetupScreen({ pinSet, onDone }: { pinSet: boolean; onDone: () => void }) {
  const db = useDb();
  const [pin, setPin] = useState<string | null>(null);
  const [saved, setSaved] = useState(pinSet);
  const [code] = useState(newRecoveryCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const step = finished ? 3 : saved ? 2 : pin === null ? 0 : 1;

  const savePin = async () => {
    if (pin === null) return;
    setBusy(true);
    try {
      await savePinAndRecovery(db, pin, code);
      setSaved(true);
    } catch (e) {
      setError(`Couldn’t save the PIN on this tablet: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="setup">
      <aside class="setup-side">
        <img class="setup-logo" src={logoUrl} alt="Shrapnel Sergeants, FRC Team 2408" />
        <h1 class="setup-title">FRC 2408 Inventory Management</h1>
        <p class="small">First-time setup · about 2 minutes · a mentor should do this</p>
        <ol class="setup-steps">
          {STEPS.map((s, i) => (
            <li key={s} class={i === step ? 'now' : i < step ? 'done' : undefined} aria-current={i === step ? 'step' : undefined}>
              <span class="sn">{i < step ? <Icon name="check" /> : i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </aside>
      <main class="setup-main">
        {step === 0 && (
          <div class="setup-pin">
            <div class="setup-text">
              <h2 class="setup-h">Welcome! First, a mentor PIN.</h2>
              <p>
                Students can use almost everything without it. The PIN protects the few things that are hard to undo: deleting items, changing vendors and prices, managing
                suppliers, restoring backups and changing settings.
              </p>
              <p>Pick 4–6 digits. Once entered, it stays unlocked for 5 minutes.</p>
              <p class="small muted">This stops accidents, not a determined hacker. Don’t reuse a PIN that protects anything important.</p>
              <p class="setup-cleared small">
                <Icon name="info" />
                <span>
                  If this tablet had inventory before, its storage was cleared. Set a PIN, then choose <strong>Restore a backup file</strong>.
                </span>
              </p>
            </div>
            <div class="setup-card">
              <NewPinPad
                title="Set a mentor PIN"
                submitLabel="Next"
                onDone={setPin}
                footer={(back) =>
                  back && (
                    <button type="button" class="btn lg" onClick={back}>
                      Back
                    </button>
                  )
                }
              />
            </div>
          </div>
        )}
        {step === 1 && (
          <div class="setup-code">
            <RecoveryCodeCard code={code} next="Next" busy={busy} onNext={() => void savePin()} />
            {error && (
              <p class="pin-err" role="alert">
                {error}
              </p>
            )}
            <div>
              <button type="button" class="btn lg" disabled={busy} onClick={() => setPin(null)}>
                <Icon name="chevLeft" />
                Choose a different PIN
              </button>
            </div>
          </div>
        )}
        {step >= 2 && <StartStep onStarted={() => setFinished(true)} onDone={onDone} />}
      </main>
    </div>
  );
}

// ── Step 3: what the inventory starts with (9h), loading (9i), ready (9j) ──

type Stage =
  | { kind: 'choose' }
  | { kind: 'loading'; items: number | null; photos: number; photoTotal: number | null; saving: boolean }
  | { kind: 'checking'; name: string }
  | { kind: 'restore'; plan: RestorePlan }
  | { kind: 'refused'; name: string; problems: string[] }
  | { kind: 'ready'; result: Result };

interface Result {
  choice: StartChoice;
  items: number;
  photos: number;
  suppliers: number;
  categories: number;
  orderCents: number;
  fileName?: string;
  persisted: boolean | null;
}

const EMPTY_SNAPSHOT = { items: [], suppliers: [], locations: [], categories: [] };

async function fetchSeed(onPhoto?: (done: number, total: number, items: number) => void): Promise<ReplaceAllInput> {
  const res = await fetch(seedUrl);
  if (!res.ok) throw new Error(`the starter catalog couldn’t be loaded (${res.status})`);
  const seed = await readSeed(await res.arrayBuffer(), onPhoto);
  if (!seed.ok) throw new Error(seed.problems.map((p) => p.message).join('; '));
  return seed.data;
}

function StartStep(props: { onStarted: () => void; onDone: () => void }) {
  const db = useDb();
  const [choice, setChoice] = useState<StartChoice>('starter');
  const [stage, setStage] = useState<Stage>({ kind: 'choose' });
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const start = async (c: StartChoice, data: ReplaceAllInput, fileName?: string) => {
    const photos = await startInventory(db, c, data);
    forgetAllThumbnails();
    const persisted = await requestPersistentStorage();
    props.onStarted();
    setStage({
      kind: 'ready',
      result: { choice: c, items: data.items.length, photos, suppliers: data.suppliers.length, categories: data.categories.length, orderCents: orderTotalCents(data.items), fileName, persisted },
    });
  };
  const fail = (e: unknown) => {
    setStage({ kind: 'choose' });
    setError(`Nothing was changed: ${e instanceof Error ? e.message : String(e)}`);
  };

  const go = async () => {
    setError(null);
    if (choice === 'restore') {
      file.current?.click();
      return;
    }
    setStage({ kind: 'loading', items: null, photos: 0, photoTotal: null, saving: false });
    try {
      if (choice === 'starter') {
        const data = await fetchSeed((done, total, items) => setStage({ kind: 'loading', items, photos: done, photoTotal: total, saving: false }));
        setStage((s) => (s.kind === 'loading' ? { ...s, saving: true } : s));
        await start('starter', data);
      } else {
        const seed = await fetchSeed();
        await start('empty', emptyStart(seed));
      }
    } catch (e) {
      fail(e);
    }
  };

  const picked = async (f: File) => {
    setError(null);
    setStage({ kind: 'checking', name: f.name });
    try {
      const read = await readRestoreFile({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }, EMPTY_SNAPSHOT);
      if (read.ok) setStage({ kind: 'restore', plan: read.plan });
      else setStage({ kind: 'refused', name: f.name, problems: read.problems.map((p) => (p.row === null ? `${p.file}: ${p.message}` : `${p.file} row ${p.row}: ${p.message}`)) });
    } catch (e) {
      fail(e);
    }
  };

  const picker = (
    <input
      ref={file}
      type="file"
      accept={BACKUP_ACCEPT}
      class="vh"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(e) => {
        const f = (e.currentTarget as HTMLInputElement).files?.[0];
        (e.currentTarget as HTMLInputElement).value = '';
        if (f) void picked(f);
      }}
    />
  );

  if (stage.kind === 'loading') {
    return (
      <div class="setup-start" aria-busy="true">
        <h2 class="setup-h">{choice === 'starter' ? 'Loading the starter catalog…' : 'Setting up…'}</h2>
        {choice === 'starter' && (
          <>
            <Progress label="Items" done={stage.items} total={stage.items} />
            <Progress label="Photos" done={stage.photoTotal === null ? null : stage.photos} total={stage.photoTotal} />
          </>
        )}
        <p class="setup-note">{stage.saving ? 'Saving to this tablet…' : 'Keep the app open. This takes under a minute and only happens once.'}</p>
      </div>
    );
  }

  if (stage.kind === 'ready') return <Ready result={stage.result} onDone={props.onDone} />;

  if (stage.kind === 'checking') {
    return (
      <div class="setup-start" aria-busy="true">
        <h2 class="setup-h">Checking {stage.name}…</h2>
      </div>
    );
  }

  if (stage.kind === 'restore' || stage.kind === 'refused') {
    const p = stage.kind === 'restore' ? stage.plan : null;
    return (
      <div class="setup-start">
        <h2 class="setup-h">{p ? 'Restore this backup?' : 'Can’t use this file'}</h2>
        {p ? (
          <div class="card sfile">
            <strong class="mono">{p.fileName}</strong>
            <span>
              {plural(p.items.length, 'item')} · {p.kind === 'zip' ? plural(p.photos.size, 'photo') : 'no photos (CSV only)'} · {plural(p.suppliers.length, 'supplier')} ·{' '}
              {plural(p.locations.length, 'location')}
            </span>
            <span class="small muted">Saved {p.savedAt ? formatDateTime(p.savedAt) : 'at an unknown time'}</span>
            {p.warnings.length > 0 && (
              <ul class="small swarn">
                {p.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div class="card sfile" role="alert">
            <strong class="mono">{stage.kind === 'refused' && stage.name}</strong>
            <ul class="small swarn">
              {stage.kind === 'refused' &&
                stage.problems.slice(0, 10).map((m) => (
                  <li key={m}>{m}</li>
                ))}
            </ul>
            <span class="small muted">Nothing was changed. Choose a full-backup ZIP or an inventory CSV made by this app.</span>
          </div>
        )}
        <div class="setup-acts">
          {p && (
            <button
              type="button"
              class="btn pri lg"
              onClick={() => {
                setStage({ kind: 'loading', items: null, photos: 0, photoTotal: null, saving: true });
                start('restore', p, p.fileName).catch(fail);
              }}
            >
              Restore this backup
              <Icon name="chevRight" />
            </button>
          )}
          <button type="button" class="btn lg" onClick={() => file.current?.click()}>
            Choose another file
          </button>
          <button type="button" class="btn lg" onClick={() => setStage({ kind: 'choose' })}>
            Back
          </button>
        </div>
        {picker}
      </div>
    );
  }

  const options: Array<{ k: StartChoice; title: string; desc: string; rec?: boolean }> = [
    {
      k: 'starter',
      title: 'Load the starter catalog',
      desc: '129 FRC parts for a NEO 2.0 swerve robot and practice tank chassis · vendor photos · recommended desired amounts · on hand starts at 0 · about 5.4 MB',
      rec: true,
    },
    { k: 'restore', title: 'Restore a backup file', desc: 'Use a full-backup ZIP or a CSV from this or another tablet' },
    { k: 'empty', title: 'Start empty', desc: 'Categories and suppliers only; add every item yourself' },
  ];
  return (
    <div class="setup-start">
      <h2 class="setup-h">What should the inventory start with?</h2>
      <div class="sopts" role="radiogroup" aria-label="Start with">
        {options.map((o) => (
          <button key={o.k} type="button" role="radio" aria-checked={choice === o.k} class={choice === o.k ? 'sopt on' : 'sopt'} onClick={() => setChoice(o.k)}>
            <span class="sdot" aria-hidden="true" />
            <span class="sopt-t">
              <span class="sopt-h">
                {o.title}
                {o.rec && <span class="chip mut">Recommended</span>}
              </span>
              <span class="small muted">{o.desc}</span>
            </span>
          </button>
        ))}
      </div>
      <p class="small muted">Chrome will also be asked to keep this app’s data permanently (persistent storage), so it isn’t cleared to free up space.</p>
      {error && (
        <p class="pin-err" role="alert">
          {error}
        </p>
      )}
      <div class="setup-acts">
        <button type="button" class="btn pri lg" onClick={() => void go()}>
          {choice === 'starter' ? 'Load starter catalog' : choice === 'restore' ? 'Choose a backup file…' : 'Start empty'}
          <Icon name="chevRight" />
        </button>
      </div>
      {picker}
    </div>
  );
}

function Progress({ label, done, total }: { label: string; done: number | null; total: number | null }) {
  const pct = done === null || !total ? 0 : Math.round((100 * done) / total);
  return (
    <div class="sprog">
      <div class="sprog-t">
        <strong>{label}</strong>
        <strong class="tnum">{done === null || total === null ? 'Reading…' : `${done} of ${total}`}</strong>
      </div>
      <div class="bar rust" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total ?? 0} aria-valuenow={done ?? 0}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Ready({ result: r, onDone }: { result: Result; onDone: () => void }) {
  const open = (to: string) => {
    location.hash = to;
    onDone();
  };
  const title = r.choice === 'starter' ? `Ready — ${plural(r.items, 'item')} loaded` : r.choice === 'restore' ? `Ready — ${plural(r.items, 'item')} restored` : 'Ready — an empty inventory';
  const what =
    r.choice === 'starter'
      ? `${plural(r.items, 'starter item')}, ${plural(r.photos, 'photo')}, ${plural(r.suppliers, 'supplier')}`
      : r.choice === 'restore'
        ? `${plural(r.items, 'item')} and ${plural(r.photos, 'photo')} from ${r.fileName ?? 'the backup'}`
        : `${plural(r.categories, 'category', 'categories')} and ${plural(r.suppliers, 'supplier')}; no items yet`;
  const storage =
    r.persisted === true
      ? 'Persistent storage granted — works offline'
      : r.persisted === false
        ? 'Persistent storage not granted yet. Chrome usually grants it once the app is installed to the home screen; keep making backups either way'
        : 'This browser didn’t say whether it keeps the data permanently; keep making backups';
  return (
    <div class="setup-start">
      <span class="done-ic">
        <Icon name="check" />
      </span>
      <h2 class="setup-h">{title}</h2>
      <ul class="sdone">
        <li>
          <Icon name="check" />
          Mentor PIN set · recovery code saved
        </li>
        <li>
          <Icon name="check" />
          {what}
        </li>
        <li>
          <Icon name={r.persisted ? 'check' : 'info'} />
          {storage}
        </li>
      </ul>
      {r.choice === 'starter' && (
        <div class="card snext">
          <strong>Next: count what’s already in the shop</strong>
          <span>
            Every item starts at 0 on hand, so the order list says <strong>{formatCents(r.orderCents)}</strong> until you count. Count-in walks you through it category by
            category.
          </span>
        </div>
      )}
      <div class="setup-acts">
        {r.choice === 'empty' ? (
          <button type="button" class="btn pri lg" onClick={() => open(href.add())}>
            <Icon name="plus" />
            Add the first item
          </button>
        ) : (
          <button type="button" class="btn pri lg" onClick={() => open(href.tab('count'))}>
            {r.choice === 'starter' ? 'Start count-in' : 'Open count-in'}
          </button>
        )}
        <button type="button" class="btn lg" onClick={() => open(href.tab('inventory'))}>
          Go to inventory
        </button>
      </div>
    </div>
  );
}
