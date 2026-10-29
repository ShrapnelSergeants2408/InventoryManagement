// One-line messages (e.g. a save that failed). v0.16: shown just below the screen's top bar, not
// at the bottom where the main buttons are (Save & next, Skip for now), and never in the way:
// taps go through it to what's underneath, and any tap hides it.
import { useEffect, useRef, useState } from 'preact/hooks';

type Listener = (msg: string) => void;
const listeners = new Set<Listener>();

export function showToast(message: string): void {
  for (const l of listeners) l(message);
}

/** Where the toast goes: 12 px below the visible top bar, measured from the app frame. */
function topBelowHeader(host: HTMLElement | null): number | null {
  const frame = host?.offsetParent;
  const header = document.querySelector<HTMLElement>('.main .top, .main .ctop');
  if (!(frame instanceof HTMLElement) || !header) return null;
  return header.getBoundingClientRect().bottom - frame.getBoundingClientRect().top + 12;
}

export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  const [top, setTop] = useState<number | null>(null);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const l: Listener = (m) => {
      setTop(topBelowHeader(host.current));
      setMsg(m);
      clearTimeout(timer);
      timer = setTimeout(() => setMsg(null), 6000);
    };
    listeners.add(l);
    return () => {
      listeners.delete(l);
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (msg === null) return;
    // The tap still reaches its button; it only hides the message.
    const hide = () => setMsg(null);
    document.addEventListener('pointerdown', hide, true);
    return () => document.removeEventListener('pointerdown', hide, true);
  }, [msg]);
  return (
    <div ref={host} class="toast-host" role="status" aria-live="polite" style={top === null ? undefined : { top: `${top}px`, bottom: 'auto' }}>
      {msg && (
        <div class="toast">
          <span>{msg}</span>
        </div>
      )}
    </div>
  );
}
