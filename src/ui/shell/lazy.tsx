// Screens loaded on demand (review R8, M33). The everyday screens are in the main bundle; the rest
// (and the libraries only they use, such as JSZip) come in their own files, fetched in the background
// shortly after the app starts so that opening one is still instant. The service worker caches every
// file, so this changes nothing offline.
import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { StateMessage } from '../components/common';
import { updateAndReload } from './UpdateBanner';

const loaders: Array<() => Promise<unknown>> = [];

/**
 * A screen component that loads its code the first time it is shown (or by preloadScreens). `load`
 * imports the module and returns the component; a failed load is tried again next time.
 */
export function lazyScreen<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  const get = () => {
    pending ??= load().then(
      (c) => (loaded = c),
      (e: unknown) => {
        // Not cached, so the next try fetches again.
        pending = null;
        throw e;
      },
    );
    return pending;
  };
  loaders.push(() => get().catch(() => undefined));

  return function LazyScreen(props: P) {
    const [, setReady] = useState(0);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
      if (loaded) return;
      let alive = true;
      get().then(
        () => alive && setReady((n) => n + 1),
        () => alive && setFailed(true),
      );
      return () => {
        alive = false;
      };
    }, []);
    const Screen = loaded;
    if (Screen) return <Screen {...props} />;
    if (failed) {
      return (
        <StateMessage
          icon="retry"
          tone="alert"
          role="alert"
          title="Couldn’t open this screen"
          actions={
            <button type="button" class="btn pri" onClick={() => void updateAndReload()}>
              Reload the app
            </button>
          }
        >
          <p class="state-text">This copy of the app may be out of date. Reloading gets the newest one; nothing on this tablet changes.</p>
        </StateMessage>
      );
    }
    return <div class="list" aria-busy="true" aria-label="Loading" />;
  };
}

/** Fetches every on-demand screen in the background (after the first screen is up). */
export function preloadScreens(delayMs = 1500): void {
  setTimeout(() => {
    for (const l of loaders) void l();
  }, delayMs);
}
