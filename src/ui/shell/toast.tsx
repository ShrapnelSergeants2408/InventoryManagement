// One-line messages (e.g. a save that failed). Shown just below the screen's top bar, not at the
// bottom where the main buttons are, and never in the way: taps go through it to what's
// underneath, and any tap elsewhere hides it. A toast may carry one action ("Undo", F21), which
// is the only part of it that takes a tap.
import { useEffect, useRef, useState } from 'preact/hooks';

export interface ToastAction {
  label: string;
  run: () => void;
}

interface Toast {
  message: string;
  action: ToastAction | null;
}

type Listener = (t: Toast) => void;
const listeners = new Set<Listener>();

export function showToast(message: string, action: ToastAction | null = null): void {
  for (const l of listeners) l({ message, action });
}

/** Where the toast goes: 12 px below the visible top bar, measured from the app frame. */
function topBelowHeader(host: HTMLElement | null): number | null {
  const frame = host?.offsetParent;
  const header = document.querySelector<HTMLElement>('.main .top, .main .ctop');
  if (!(frame instanceof HTMLElement) || !header) return null;
  return header.getBoundingClientRect().bottom - frame.getBoundingClientRect().top + 12;
}

export function ToastHost() {
  const [toast, setToast] = useState<Toast | null>(null);
  const [top, setTop] = useState<number | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const l: Listener = (t) => {
      setTop(topBelowHeader(host.current));
      setToast(t);
      clearTimeout(timer);
      timer = setTimeout(() => setToast(null), 6000);
    };
    listeners.add(l);
    return () => {
      listeners.delete(l);
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (toast === null) return;
    // The tap still reaches its button; it only hides the message (unless it's the action).
    const hide = (e: Event) => {
      if (actionRef.current && e.target instanceof Node && actionRef.current.contains(e.target)) return;
      setToast(null);
    };
    document.addEventListener('pointerdown', hide, true);
    return () => document.removeEventListener('pointerdown', hide, true);
  }, [toast]);
  return (
    <div ref={host} class="toast-host" role="status" aria-live="polite" style={top === null ? undefined : { top: `${top}px`, bottom: 'auto' }}>
      {toast && (
        <div class={toast.action ? 'toast act' : 'toast'}>
          <span>{toast.message}</span>
          {toast.action && (
            <button
              ref={actionRef}
              type="button"
              class="toast-btn"
              onClick={() => {
                const run = toast.action!.run;
                setToast(null);
                run();
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
