// Add / rename dialog for suppliers, locations, categories and subcategories (mockup 7b).
// Duplicate names show as you type and disable the button; anything the save rejects is
// shown in the dialog.
import { useState } from 'preact/hooks';
import { checkName } from '../../../domain/lists';
import { Dialog, DialogActions } from '../../components/Dialog';

export interface EntryValues {
  name: string;
  website: string;
  notes: string;
}

export function EntryDialog(props: {
  title: string;
  /** "Supplier", "Location", … for messages. */
  what: string;
  existing: readonly string[];
  /** Current name when renaming. */
  self?: string;
  initial?: Partial<EntryValues>;
  website?: boolean;
  notes?: boolean;
  /** False keeps the name as is (the `other` supplier). */
  nameEditable?: boolean;
  placeholder?: string;
  notesPlaceholder?: string;
  explain?: string;
  submitLabel: string;
  onSubmit: (v: EntryValues) => Promise<void>;
  onClose: () => void;
}) {
  const [v, setV] = useState<EntryValues>({ name: '', website: '', notes: '', ...props.initial });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const check = checkName(v.name, props.existing, props.what, props.self);
  const showDup = !check.ok && v.name.trim() !== '';

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!check.ok || busy) return;
    setBusy(true);
    try {
      await props.onSubmit({ ...v, name: check.name });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Dialog label={props.title} onClose={() => !busy && props.onClose()}>
      <form class="dlg-form" onSubmit={(e) => void submit(e)}>
        <h2 class="h2">{props.title}</h2>
        <div>
          <label class="lbl" for="en-name">
            Name <span class="req">*</span>
          </label>
          <input
            id="en-name"
            class={showDup ? 'field bad' : 'field'}
            value={v.name}
            disabled={props.nameEditable === false}
            onInput={(e) => {
              setError(null);
              setV({ ...v, name: (e.currentTarget as HTMLInputElement).value });
            }}
            placeholder={props.placeholder}
            autoComplete="off"
            aria-invalid={showDup ? 'true' : undefined}
          />
          {showDup && (
            <div class="err" role="alert">
              {check.error}
            </div>
          )}
        </div>
        {props.website && (
          <div>
            <label class="lbl" for="en-site">
              Website <span class="lbl-opt">(optional)</span>
            </label>
            <input id="en-site" class="field" inputMode="url" value={v.website} onInput={(e) => setV({ ...v, website: (e.currentTarget as HTMLInputElement).value })} placeholder="https://" autoComplete="off" />
          </div>
        )}
        {props.notes && (
          <div>
            <label class="lbl" for="en-notes">
              Notes <span class="lbl-opt">(optional)</span>
            </label>
            <input id="en-notes" class="field" value={v.notes} onInput={(e) => setV({ ...v, notes: (e.currentTarget as HTMLInputElement).value })} placeholder={props.notesPlaceholder} autoComplete="off" />
          </div>
        )}
        {props.explain && <p class="dlg-p small muted">{props.explain}</p>}
        {error && (
          <div class="err" role="alert">
            {error}
          </div>
        )}
        <DialogActions>
          <button type="button" class="btn lg" disabled={busy} onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" class="btn pri lg" disabled={!check.ok || busy}>
            {props.submitLabel}
          </button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
