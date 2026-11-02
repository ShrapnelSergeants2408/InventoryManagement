// First launch (SPEC v2.0 §12.5): choose what the inventory starts with: a fresh start with the
// default categories, or a backup file (a replacement phone, or storage that was cleared).
// The inventory and "setup done" are saved together, so closing the app part-way shows this
// screen again. H4 adds sign-in and the first download from the server before this step.
import { useRef, useState } from 'preact/hooks';
import type { ReplaceAllInput } from '../../data/inventory';
import { emptyStart, requestPersistentStorage, startInventory, type StartChoice } from '../../data/setup';
import { formatDateTime } from '../../domain/dates';
import { APP_NAME } from '../../io/backup';
import { readRestoreFile, type RestorePlan } from '../../io/restore';
import { plural } from '../components/common';
import { forgetAllThumbnails, useDb } from '../data-hooks';
import { Icon } from '../icons';
import { href } from '../shell/router';

const BACKUP_ACCEPT = '.zip,.csv,application/zip,application/x-zip-compressed,text/csv,text/comma-separated-values';

type Stage =
  | { kind: 'choose' }
  | { kind: 'saving' }
  | { kind: 'checking'; name: string }
  | { kind: 'restore'; plan: RestorePlan }
  | { kind: 'refused'; name: string; problems: string[] }
  | { kind: 'ready'; result: Result };

interface Result {
  choice: StartChoice;
  items: number;
  photos: number;
  categories: number;
  fileName?: string;
  persisted: boolean | null;
}

const EMPTY_SNAPSHOT = { items: [], locations: [], categories: [] };

export function SetupScreen({ onDone }: { onDone: () => void }) {
  const db = useDb();
  const [choice, setChoice] = useState<StartChoice>('empty');
  const [stage, setStage] = useState<Stage>({ kind: 'choose' });
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const start = async (c: StartChoice, data: ReplaceAllInput, fileName?: string) => {
    const photos = await startInventory(db, data);
    forgetAllThumbnails();
    const persisted = await requestPersistentStorage();
    setStage({ kind: 'ready', result: { choice: c, items: data.items.length, photos, categories: data.categories.length, fileName, persisted } });
  };
  const fail = (e: unknown) => {
    setStage({ kind: 'choose' });
    setError(`Nothing was changed: ${e instanceof Error ? e.message : String(e)}`);
  };

  const go = () => {
    setError(null);
    if (choice === 'restore') {
      file.current?.click();
      return;
    }
    setStage({ kind: 'saving' });
    start('empty', emptyStart()).catch(fail);
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

  let body;
  if (stage.kind === 'saving' || stage.kind === 'checking') {
    body = (
      <div class="setup-start" aria-busy="true">
        <h2 class="setup-h">{stage.kind === 'checking' ? `Checking ${stage.name}…` : 'Setting up…'}</h2>
      </div>
    );
  } else if (stage.kind === 'ready') {
    body = <Ready result={stage.result} onDone={onDone} />;
  } else if (stage.kind === 'restore' || stage.kind === 'refused') {
    const p = stage.kind === 'restore' ? stage.plan : null;
    body = (
      <div class="setup-start">
        <h2 class="setup-h">{p ? 'Restore this backup?' : 'Can’t use this file'}</h2>
        {p ? (
          <div class="card sfile">
            <strong class="mono">{p.fileName}</strong>
            <span>
              {plural(p.items.length, 'item')} · {p.kind === 'zip' ? plural(p.photos.size, 'photo') : 'no photos (CSV only)'} · {plural(p.locations.length, 'location')}
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
                setStage({ kind: 'saving' });
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
  } else {
    const options: Array<{ k: StartChoice; title: string; desc: string }> = [
      { k: 'empty', title: 'Start fresh', desc: 'Household categories (Decorations, Lights, Tools…), no items yet. Add things as you label bins and shelves.' },
      { k: 'restore', title: 'Restore a backup file', desc: 'A full-backup ZIP or a CSV made by this app, e.g. from another phone' },
    ];
    body = (
      <div class="setup-start">
        <h2 class="setup-h">What should the inventory start with?</h2>
        <p class="setup-cleared small">
          <Icon name="info" />
          <span>
            If this phone had inventory before, its storage was cleared. Choose <strong>Restore a backup file</strong>.
          </span>
        </p>
        <div class="sopts" role="radiogroup" aria-label="Start with">
          {options.map((o) => (
            <button key={o.k} type="button" role="radio" aria-checked={choice === o.k} class={choice === o.k ? 'sopt on' : 'sopt'} onClick={() => setChoice(o.k)}>
              <span class="sdot" aria-hidden="true" />
              <span class="sopt-t">
                <span class="sopt-h">{o.title}</span>
                <span class="small muted">{o.desc}</span>
              </span>
            </button>
          ))}
        </div>
        {error && (
          <p class="pin-err" role="alert">
            {error}
          </p>
        )}
        <div class="setup-acts">
          <button type="button" class="btn pri lg" onClick={go}>
            {choice === 'restore' ? 'Choose a backup file…' : 'Start fresh'}
            <Icon name="chevRight" />
          </button>
        </div>
        {picker}
      </div>
    );
  }

  return (
    <div class="setup">
      <aside class="setup-side">
        <h1 class="setup-title">{APP_NAME}</h1>
        <p class="small">First-time setup on this phone</p>
      </aside>
      <main class="setup-main">{body}</main>
    </div>
  );
}

function Ready({ result: r, onDone }: { result: Result; onDone: () => void }) {
  const open = (to: string) => {
    location.hash = to;
    onDone();
  };
  const what =
    r.choice === 'restore'
      ? `${plural(r.items, 'item')} and ${plural(r.photos, 'photo')} from ${r.fileName ?? 'the backup'}`
      : `${plural(r.categories, 'category', 'categories')}; no items yet`;
  const storage =
    r.persisted === true
      ? 'Persistent storage granted: works offline'
      : 'This browser didn’t promise to keep the data permanently; keep making backups (sync to the server arrives in a later version)';
  return (
    <div class="setup-start">
      <span class="done-ic">
        <Icon name="check" />
      </span>
      <h2 class="setup-h">{r.choice === 'restore' ? `Ready: ${plural(r.items, 'item')} restored` : 'Ready'}</h2>
      <ul class="sdone">
        <li>
          <Icon name="check" />
          {what}
        </li>
        <li>
          <Icon name={r.persisted ? 'check' : 'info'} />
          {storage}
        </li>
      </ul>
      <div class="setup-acts">
        <button type="button" class="btn pri lg" onClick={() => open(r.choice === 'restore' ? href.tab('inventory') : href.add())}>
          {r.choice === 'restore' ? 'Go to inventory' : 'Add the first item'}
        </button>
      </div>
    </div>
  );
}
