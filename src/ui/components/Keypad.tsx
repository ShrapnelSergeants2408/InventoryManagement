// Count-in keypad (F24; mockup 10b): digits, delete, None (0), "= desired" and ±1. Keys are
// 68 px (§17). Typing on a hardware keyboard works too, for testing on a desktop.
import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { pressKey, type PadKey } from '../../domain/count';
import { Icon } from '../icons';

const DIGITS: PadKey[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

export function Keypad(props: { entry: string; desired: number; onEntry: (entry: string) => void; disabled?: boolean }) {
  const press = (k: PadKey) => props.onEntry(pressKey(props.entry, k, props.desired));
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (props.disabled || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (/^[0-9]$/.test(e.key)) press(e.key as PadKey);
      else if (e.key === 'Backspace') press('back');
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  });
  const key = (k: PadKey, label: ComponentChildren, aria: string, cls = '') => (
    <button key={k} type="button" class={cls} aria-label={aria} disabled={props.disabled} onClick={() => press(k)}>
      {label}
    </button>
  );
  return (
    <>
      <div class="pad">
        {DIGITS.map((d) => key(d, d, d))}
        {key('back', <Icon name="backspace" />, 'Delete last digit', 'alt')}
        {key('0', '0', '0')}
        {key('none', 'None', 'None — zero', 'alt')}
      </div>
      <div class="quick">
        <button type="button" class="fchip" disabled={props.disabled} onClick={() => press('desired')}>
          = desired ({props.desired})
        </button>
        <button type="button" class="fchip" aria-label="Minus 1" disabled={props.disabled} onClick={() => press('minus')}>
          −1
        </button>
        <button type="button" class="fchip" aria-label="Plus 1" disabled={props.disabled} onClick={() => press('plus')}>
          +1
        </button>
      </div>
    </>
  );
}
