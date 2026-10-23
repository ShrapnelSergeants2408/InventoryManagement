// Offline install (SPEC §2): registers the service worker. When a new version has been
// downloaded, a banner offers Reload instead of reloading by itself, so nobody loses a typed
// count or an open form.
import { registerSW } from 'virtual:pwa-register';
import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../icons';

let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null;
let waiting = false;
const listeners = new Set<() => void>();

export function startServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  applyUpdate = registerSW({
    onNeedRefresh() {
      waiting = true;
      for (const l of listeners) l();
    },
  });
}

/**
 * Gets the newest copy of the app now (the out-of-date screen, Stage 5 finding 6): checks for
 * a new version, lets a waiting one take over, then reloads. Falls back to a plain reload.
 */
export async function updateAndReload(): Promise<void> {
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
  await reg?.update().catch(() => undefined);
  const next = reg?.waiting ?? reg?.installing;
  if (!next) {
    location.reload();
    return;
  }
  const done = () => location.reload();
  navigator.serviceWorker.addEventListener('controllerchange', done, { once: true });
  setTimeout(done, 5000);
  next.postMessage({ type: 'SKIP_WAITING' });
}

export function UpdateBanner() {
  const [ready, setReady] = useState(waiting);
  const [later, setLater] = useState(false);
  useEffect(() => {
    const l = () => setReady(true);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  if (!ready || later) return null;
  return (
    <div class="banner" role="status">
      <Icon name="retry" />
      <span class="grow">A new version of the app is ready. Reload when you’re not in the middle of something.</span>
      <button type="button" class="btn onb" onClick={() => void applyUpdate?.(true)}>
        Reload
      </button>
      <button type="button" class="btn onb" onClick={() => setLater(true)}>
        Later
      </button>
    </div>
  );
}
