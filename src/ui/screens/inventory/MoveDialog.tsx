// Bulk move (F28): pick a category and subcategory (or type a new one); the dialog is the
// confirmation, saying how many items move and from where. No PIN (F7, §6).
import { useState } from 'preact/hooks';
import { placeLabel, type CategoryPlace } from '../../../domain/lists';
import { fromText, moveSummary } from '../../../domain/selection';
import type { Category, Item } from '../../../domain/types';
import { Dialog, DialogActions } from '../../components/Dialog';
import { plural } from '../../components/common';

const NEW = '\u0000new';

export function MoveDialog(props: {
  chosen: Item[];
  categories: Category[];
  onClose: () => void;
  /** Saves the move; `create` when a new category or subcategory was typed. */
  onMove: (to: CategoryPlace, create: boolean) => Promise<void>;
}) {
  const cats = [...props.categories].sort((a, b) => a.order - b.order);
  const [category, setCategory] = useState(cats[0]?.name ?? NEW);
  const [newCategory, setNewCategory] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [newSubcategory, setNewSubcategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typingCategory = category === NEW;
  const typingSub = subcategory === NEW;
  const subs = typingCategory ? [] : (cats.find((c) => c.name === category)?.subcategories ?? []);
  const to: CategoryPlace = {
    category: typingCategory ? newCategory.trim() : category,
    subcategory: typingSub ? newSubcategory.trim() : subcategory,
  };
  const ready = to.category !== '' && (!typingSub || to.subcategory !== '');
  const s = moveSummary(props.chosen, to);
  const moving = s.count - s.staying;

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await props.onMove(to, typingCategory || typingSub);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Dialog label="Move items" onClose={() => !busy && props.onClose()}>
      <h2 class="h2">{ready ? `Move ${plural(s.count, 'item')} to ${placeLabel(to)}?` : `Move ${plural(s.count, 'item')} to…`}</h2>
      <div class="row2">
        <div>
          <label class="lbl" for="mvcat">
            Category
          </label>
          <select
            id="mvcat"
            class="field"
            value={category}
            onChange={(e) => {
              setCategory((e.currentTarget as HTMLSelectElement).value);
              setSubcategory('');
            }}
          >
            {cats.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
            <option value={NEW}>+ New category…</option>
          </select>
        </div>
        <div>
          <label class="lbl" for="mvsub">
            Subcategory
          </label>
          <select id="mvsub" class="field" value={subcategory} onChange={(e) => setSubcategory((e.currentTarget as HTMLSelectElement).value)}>
            <option value="">None</option>
            {subs.map((sub) => (
              <option key={sub} value={sub}>
                {sub}
              </option>
            ))}
            <option value={NEW}>+ New subcategory…</option>
          </select>
        </div>
      </div>
      {typingCategory && (
        <div>
          <label class="lbl" for="mvnc">
            New category
          </label>
          <input id="mvnc" class="field" value={newCategory} onInput={(e) => setNewCategory((e.currentTarget as HTMLInputElement).value)} placeholder="Name of the new category" autoComplete="off" />
        </div>
      )}
      {typingSub && (
        <div>
          <label class="lbl" for="mvns">
            New subcategory in {to.category || 'the new category'}
          </label>
          <input id="mvns" class="field" value={newSubcategory} onInput={(e) => setNewSubcategory((e.currentTarget as HTMLInputElement).value)} placeholder="Name of the new subcategory" autoComplete="off" />
        </div>
      )}
      <p class="dlg-p mv-from">
        {s.from.length > 0 ? `From ${fromText(s.from)}.` : 'All of them are already there.'}
        {s.staying > 0 && s.from.length > 0 ? ` ${plural(s.staying, 'item is', 'items are')} already there and stay${s.staying === 1 ? 's' : ''} as ${s.staying === 1 ? 'it is' : 'they are'}.` : ''}
      </p>
      <p class="small muted">Only the category and subcategory change. Counts, prices and everything else stay as they are.</p>
      {error && (
        <div class="err" role="alert">
          {error}
        </div>
      )}
      <DialogActions>
        <button type="button" class="btn lg" disabled={busy} onClick={props.onClose}>
          Cancel
        </button>
        <button type="button" class="btn pri lg" disabled={busy || !ready || moving === 0} onClick={() => void go()}>
          {`Move ${plural(s.count, 'item')}`}
        </button>
      </DialogActions>
    </Dialog>
  );
}
