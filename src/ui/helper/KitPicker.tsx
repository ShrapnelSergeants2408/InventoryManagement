// Choosing a count kit file (§18.2 Joining): first launch › Join as a helper, and Send ›
// Open a new kit. The kit is read and checked here; nothing is saved until the caller says so.
import { useRef, useState } from 'preact/hooks';
import { plural } from '../components/common';
import { readCountKit, type ReadKit } from '../../io/count-kit';
import { Icon } from '../icons';

const KIT_ACCEPT = '.zip,application/zip,application/x-zip-compressed';

export function KitPicker(props: { label: string; primary?: boolean; onRead: (read: ReadKit, fileName: string) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refused, setRefused] = useState<{ name: string; newer: boolean; problems: string[] } | null>(null);

  const picked = async (f: File) => {
    setRefused(null);
    setBusy(f.name);
    try {
      const r = await readCountKit(new Uint8Array(await f.arrayBuffer()));
      if (r.ok) props.onRead(r.read, f.name);
      else setRefused({ name: f.name, newer: r.newer, problems: r.problems });
    } catch (e) {
      setRefused({ name: f.name, newer: false, problems: [`This file couldn’t be read: ${e instanceof Error ? e.message : String(e)}`] });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div class="kitpick">
      <button type="button" class={props.primary ? 'btn pri lg' : 'btn lg'} disabled={busy !== null} onClick={() => file.current?.click()}>
        <Icon name="upload" />
        {busy ? `Reading ${busy}…` : props.label}
      </button>
      <input
        ref={file}
        type="file"
        accept={KIT_ACCEPT}
        class="vh"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const f = (e.currentTarget as HTMLInputElement).files?.[0];
          (e.currentTarget as HTMLInputElement).value = '';
          if (f) void picked(f);
        }}
      />
      {refused && (
        <div class="card sfile" role="alert">
          <strong class="mono">{refused.name}</strong>
          <ul class="small swarn">
            {refused.problems.slice(0, 8).map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          {refused.problems.length > 8 && <span class="small muted">and {plural(refused.problems.length - 8, 'more problem')}</span>}
          {refused.newer ? (
            <button type="button" class="btn pri lg" onClick={() => location.reload()}>
              <Icon name="retry" />
              Reload the app
            </button>
          ) : (
            <span class="small muted">Nothing was changed. Ask the shop tablet for a new count kit (Count › Helper devices › Send count kit).</span>
          )}
        </div>
      )}
    </div>
  );
}

/** What the kit holds, before joining. */
export function KitSummary({ read }: { read: ReadKit }) {
  const k = read.kit;
  return (
    <div class="card sfile">
      <strong>{k.helperName}</strong>
      <span>
        {k.kind === 'category' ? 'Categories' : 'Locations'}: {k.groups.join(', ')}
      </span>
      <span class="small muted">
        {plural(read.data.items.length, 'item')} · {plural(read.data.photos.size, 'photo')} · {k.allowNewItems ? 'new items allowed' : 'no new items'}
      </span>
    </div>
  );
}
