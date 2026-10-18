// PIN pad (mockup 0b): dots, 3 × 4 keys (72 px), Clear and ⌫, one big action. Digits and
// Backspace/Enter also work from a keyboard. 4–6 digits (§6).
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../icons';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
export const PIN_MIN = 4;
export const PIN_MAX = 6;

export function PinPad(props: {
  title: string;
  sub: string;
  submitLabel: string;
  onSubmit: (pin: string) => void;
  /** Red line under the dots (wrong PIN, PINs don't match). */
  error?: string | null;
  /** Keys and action disabled (checking, or waiting after wrong tries). */
  disabled?: boolean;
  /** Changing it clears the digits (after a wrong PIN). */
  clearKey?: number;
  /** Cancel / Back / Forgot PIN? row under the action. */
  footer?: ComponentChildren;
}) {
  const [pin, setPin] = useState('');
  useEffect(() => setPin(''), [props.clearKey]);

  const ready = pin.length >= PIN_MIN && !props.disabled;
  const press = (k: string) => !props.disabled && setPin((p) => (p.length < PIN_MAX ? p + k : p));
  const back = () => setPin((p) => p.slice(0, -1));
  const submit = () => ready && props.onSubmit(pin);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') back();
      else if (e.key === 'Enter') submit();
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  const slots = Math.max(PIN_MIN, Math.min(PIN_MAX, pin.length + (pin.length >= PIN_MIN ? 1 : 0)));
  return (
    <div class="pinpad">
      <div class="dlg-head">
        <span class="dlg-ic navy">
          <Icon name="lock" />
        </span>
        <div class="grow">
          <h2 class="h2">{props.title}</h2>
          <div class="pin-sub">{props.sub}</div>
        </div>
      </div>
      <div class="pin-dots" role="status" aria-label={`${pin.length} of ${PIN_MIN} to ${PIN_MAX} digits entered`}>
        {Array.from({ length: slots }, (_, i) => (
          <span key={i} class={i < pin.length ? 'on' : undefined} />
        ))}
      </div>
      <p class="pin-err" role="alert">
        {props.error ?? ''}
      </p>
      <div class="pin-keys">
        {KEYS.map((k) => (
          <button key={k} type="button" class="pkey" disabled={props.disabled} onClick={() => press(k)}>
            {k}
          </button>
        ))}
        <button type="button" class="pkey fn" aria-label="Delete last digit" disabled={props.disabled || !pin} onClick={back}>
          <Icon name="backspace" />
        </button>
        <button type="button" class="pkey" disabled={props.disabled} onClick={() => press('0')}>
          0
        </button>
        <button type="button" class="pkey fn" disabled={props.disabled || !pin} onClick={() => setPin('')}>
          Clear
        </button>
      </div>
      <button type="button" class="btn pri xl pin-go" disabled={!ready} onClick={submit}>
        {props.submitLabel}
      </button>
      {props.footer && <div class="pin-foot">{props.footer}</div>}
    </div>
  );
}

/** Choose a PIN, then type it again (setup, change PIN, recovery). */
export function NewPinPad(props: { title: string; submitLabel: string; onDone: (pin: string) => void; footer?: (back: (() => void) | null) => ComponentChildren; disabled?: boolean }) {
  const [first, setFirst] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clearKey, setClearKey] = useState(0);
  const again = first !== null;
  const back = again
    ? () => {
        setFirst(null);
        setError(null);
        setClearKey((k) => k + 1);
      }
    : null;
  return (
    <PinPad
      title={props.title}
      sub={again ? 'Type the same PIN again' : 'Choose 4–6 digits'}
      submitLabel={again ? props.submitLabel : 'Next'}
      error={error}
      clearKey={clearKey}
      disabled={props.disabled}
      onSubmit={(pin) => {
        setClearKey((k) => k + 1);
        if (!again) {
          setFirst(pin);
          setError(null);
        } else if (pin === first) props.onDone(pin);
        else {
          setFirst(null);
          setError('The two PINs didn’t match. Choose the PIN again.');
        }
      }}
      footer={props.footer?.(back)}
    />
  );
}
