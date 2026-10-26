// The bar shown in Select mode (Inventory, F28; the automatic order list, F27): how many are
// selected and how many of those the search or filter hides, Select all shown, Clear, then the
// screen's own actions.
import type { ComponentChildren } from 'preact';
import { plural } from './common';

export function SelectBar(props: {
  count: number;
  /** "item" or "line". */
  noun: string;
  hidden: number;
  shown: number;
  allShown: boolean;
  onAll: () => void;
  onClear: () => void;
  children: ComponentChildren;
}) {
  return (
    <div class="selbar" role="toolbar" aria-label={`Selected ${props.noun}s`}>
      <span class="selcount">
        <strong>{plural(props.count, props.noun)} selected</strong>
        {props.hidden > 0 && <span class="small muted"> · {props.hidden} not shown by this search or filter</span>}
      </span>
      <button type="button" class="btn" disabled={props.allShown} onClick={props.onAll}>
        Select all shown ({props.shown})
      </button>
      <button type="button" class="btn" disabled={props.count === 0} onClick={props.onClear}>
        Clear
      </button>
      {props.children}
    </div>
  );
}
