// Centered modal dialog over the whole app (mockups 2c, 7b, 7c, 7g, 7j). Escape or a tap
// outside closes it; focus goes to the first field (or the element marked data-autofocus)
// and back where it was afterwards.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

export function Dialog(props: {
  label: string;
  /** alertdialog for confirmations of destructive actions. */
  role?: 'dialog' | 'alertdialog';
  onClose: () => void;
  children: ComponentChildren;
}) {
  const box = useRef<HTMLDivElement>(null);
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const first =
      box.current?.querySelector<HTMLElement>('[data-autofocus]') ??
      box.current?.querySelector<HTMLElement>('input:not([disabled]), select, textarea, button:not([disabled])');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose.current();
    };
    addEventListener('keydown', onKey, true);
    return () => {
      removeEventListener('keydown', onKey, true);
      before?.focus?.();
    };
  }, []);

  return (
    <div class="scrim center" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div ref={box} class="dlg" role={props.role ?? 'dialog'} aria-modal="true" aria-label={props.label}>
        {props.children}
      </div>
    </div>
  );
}

export function DialogActions({ children }: { children: ComponentChildren }) {
  return <div class="dlg-actions">{children}</div>;
}
