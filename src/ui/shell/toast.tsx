// One-line messages at the bottom of the screen (e.g. a save that failed).
import { useEffect, useState } from 'preact/hooks';

type Listener = (msg: string) => void;
const listeners = new Set<Listener>();

export function showToast(message: string): void {
  for (const l of listeners) l(message);
}

export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const l: Listener = (m) => {
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
  return (
    <div class="toast-host" role="status" aria-live="polite">
      {msg && (
        <div class="toast">
          <span>{msg}</span>
          <button type="button" class="btn onb" onClick={() => setMsg(null)}>
            OK
          </button>
        </div>
      )}
    </div>
  );
}
