// Quantity stepper: −, typed number, +. Used in list rows, on the detail card and on a scan result.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { parseWholeNumber } from '../../domain/validate';
import { Icon } from '../icons';

export function CountStepper(props: {
  value: number;
  itemName: string;
  onStep: (delta: number) => void;
  /** Saves a typed number; a rejected promise puts the old number back. */
  onSet: (value: number) => Promise<unknown>;
  /** 'xl' = 80 px (detail card, §11); default 64 px (lists). */
  size?: 'xl';
  /** Shown above the buttons (list rows: "Quantity · tap − / + or type"). */
  caption?: ComponentChildren;
}) {
  // While typing, the box holds the draft; otherwise it shows the stored value.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const editing = useRef(false);
  // Escape blurs the box too; this stops that blur from saving the abandoned draft.
  const cancelled = useRef(false);

  useEffect(() => {
    if (draft === null) setError(null);
  }, [props.value]);

  // Reads the box itself, not the draft state: a blur right after typing (fast Enter)
  // can arrive before the re-render that would update the state.
  const commit = (el: HTMLInputElement) => {
    if (!editing.current) return;
    editing.current = false;
    setDraft(null);
    const raw = el.value;
    // Preact skips the DOM when the value prop is unchanged, so put the shown number back by hand.
    const show = (n: number) => (el.value = String(n));
    if (cancelled.current) {
      cancelled.current = false;
      show(props.value);
      return;
    }
    if (raw.trim() === '' || raw.trim() === String(props.value)) {
      setError(null);
      show(props.value);
      return;
    }
    const parsed = parseWholeNumber(raw, 'Quantity');
    if (!parsed.ok) {
      setError(parsed.error);
      show(props.value);
      return;
    }
    setError(null);
    show(parsed.value);
    const before = props.value;
    props.onSet(parsed.value).catch(() => show(before));
  };

  const xl = props.size === 'xl';
  return (
    <div class={xl ? 'stepper xl' : 'stepper'} role="group" aria-label={`Quantity for ${props.itemName}`}>
      {props.caption}
      <div class="stepper-row">
        <button
          class="step"
          type="button"
          aria-label="Minus one"
          disabled={props.value <= 0}
          onClick={() => {
            setDraft(null);
            props.onStep(-1);
          }}
        >
          <Icon name="minus" />
        </button>
        <input
          ref={input}
          class={error ? 'num bad' : 'num'}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          enterKeyHint="done"
          autoComplete="off"
          aria-label="Quantity"
          aria-invalid={error ? 'true' : undefined}
          value={draft ?? String(props.value)}
          onFocus={(e) => {
            editing.current = true;
            setDraft(String(props.value));
            (e.currentTarget as HTMLInputElement).select();
          }}
          onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
          onBlur={(e) => commit(e.currentTarget as HTMLInputElement)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') input.current?.blur();
            if (e.key === 'Escape') {
              cancelled.current = true;
              setError(null);
              input.current?.blur();
            }
          }}
        />
        <button
          class="step plus"
          type="button"
          aria-label="Plus one"
          onClick={() => {
            setDraft(null);
            props.onStep(1);
          }}
        >
          <Icon name="plus" />
        </button>
      </div>
      {error && (
        <span class="step-err" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/** The list-row stepper: "Quantity · tap − / + or type". */
export function QuantityStepper(props: {
  value: number;
  itemName: string;
  onStep: (delta: number) => void;
  onSet: (value: number) => Promise<unknown>;
}) {
  return (
    <CountStepper
      value={props.value}
      itemName={props.itemName}
      onStep={props.onStep}
      onSet={props.onSet}
      caption={
        <span class="cl ohl">
          Quantity <span class="ohl-hint">· tap − / + or type</span>
        </span>
      }
    />
  );
}
