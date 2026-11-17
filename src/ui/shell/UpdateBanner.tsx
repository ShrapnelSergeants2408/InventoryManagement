// Offline install (SPEC §2): registers the service worker. When a new version has been
// downloaded, a banner offers Reload instead of reloading by itself, so nobody loses a typed
// count or an open form.
import { registerSW } from 'virtual:pwa-register';
import { useEffect, useState } from 'preact/hooks';
import { CHECK_EVERY_MS, dueForCheck, type UpdateResult } from '../../domain/update-check';
import { Icon } from '../icons';

let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null;
let waiting = false;
const listeners = new Set<() => void>();
let registration: ServiceWorkerRegistration | undefined;
let lastCheck = 0;

function announce(): void {
  waiting = true;
  for (const l of listeners) l();
}

/** Asks the browser to look for a new version, unless one was looked for recently (v0.26, R2). */
function checkSoon(now = Date.now()): void {
  if (!registration || !navigator.onLine || !dueForCheck(now, lastCheck)) return;
  lastCheck = now;
  void registration.update().catch(() => undefined);
}

export function startServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  applyUpdate = registerSW({
    onNeedRefresh: announce,
    onRegisteredSW(_url, reg) {
      registration = reg;
      // Registering has just checked.
      lastCheck = Date.now();
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && checkSoon());
      setInterval(() => document.visibilityState === 'visible' && checkSoon(), CHECK_EVERY_MS);
    },
  });
}

/**
 * More › About › Check for updates (v0.26, R2): looks now and waits for a new version to finish
 * downloading. When one is ready, the Reload banner shows (again, if it was put off with Later).
 */
export async function checkForUpdate(): Promise<UpdateResult> {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  if (!navigator.onLine) return 'offline';
  const reg = registration ?? (await navigator.serviceWorker.getRegistration().catch(() => undefined));
  if (!reg) return 'unsupported';
  lastCheck = Date.now();
  try {
    await reg.update();
  } catch {
    return navigator.onLine ? 'failed' : 'offline';
  }
  const sw = reg.installing;
  if (sw) {
    await new Promise<void>((done) => {
      const t = setTimeout(done, 60_000);
      sw.addEventListener('statechange', () => {
        if (sw.state !== 'installing') {
          clearTimeout(t);
          done();
        }
      });
    });
  }
  if (!reg.waiting && !waiting) return 'current';
  announce();
  return 'ready';
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
    const l = () => {
      setReady(true);
      setLater(false);
    };
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
