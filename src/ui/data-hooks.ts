// Live data for screens: Dexie liveQuery re-runs the query whenever a table it read changes.
import { liveQuery } from 'dexie';
import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import type { InventoryDb } from '../data/db';
import { loadSnapshot, type InventorySnapshot } from '../data/inventory';
import { loadHelpers } from '../data/helpers';
import { loadOrderLists } from '../data/order-lists';
import { getThumbnail } from '../data/photos';
import type { Helper } from '../domain/helpers';
import type { NamedOrderList } from '../domain/order-lists';
import { DEFAULT_SETTINGS, getSettings, type Settings } from '../data/settings';
import { makeThumbnail } from '../io/image';

export const DbContext = createContext<InventoryDb | null>(null);

export function useDb(): InventoryDb {
  const db = useContext(DbContext);
  if (!db) throw new Error('no database');
  return db;
}

export type Live<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'error'; error: unknown };

export function useSnapshot(): Live<InventorySnapshot> {
  const db = useDb();
  const [live, setLive] = useState<Live<InventorySnapshot>>({ state: 'loading' });
  useEffect(() => {
    const sub = liveQuery(() => loadSnapshot(db)).subscribe({
      next: (value) => setLive({ state: 'ready', value }),
      error: (error: unknown) => setLive({ state: 'error', error }),
    });
    return () => sub.unsubscribe();
  }, [db]);
  return live;
}

/** Named order lists (F27), A–Z, live. */
export function useOrderLists(): Live<NamedOrderList[]> {
  const db = useDb();
  const [live, setLive] = useState<Live<NamedOrderList[]>>({ state: 'loading' });
  useEffect(() => {
    const sub = liveQuery(() => loadOrderLists(db)).subscribe({
      next: (value) => setLive({ state: 'ready', value }),
      error: (error: unknown) => setLive({ state: 'error', error }),
    });
    return () => sub.unsubscribe();
  }, [db]);
  return live;
}

/** Device settings (stale-price age etc.), live; defaults until loaded or if the read fails. */
export function useSettings(): Settings {
  const db = useDb();
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS });
  useEffect(() => {
    const sub = liveQuery(() => getSettings(db)).subscribe({ next: setSettings, error: () => undefined });
    return () => sub.unsubscribe();
  }, [db]);
  return settings;
}

// Thumbnails: object URLs cached for the session, made one at a time so a fully expanded
// list doesn't decode 128 full-size photos at once.
const thumbUrls = new Map<string, Promise<string | null>>();
let queue: Promise<unknown> = Promise.resolve();

function thumbUrl(db: InventoryDb, itemId: string): Promise<string | null> {
  let p = thumbUrls.get(itemId);
  if (!p) {
    p = queue.then(() => getThumbnail(db, itemId, (full) => makeThumbnail(full))).then((b) => (b ? URL.createObjectURL(b) : null));
    queue = p.catch(() => null);
    // A failure isn't cached, so the next mount tries again.
    p.catch(() => thumbUrls.delete(itemId));
    thumbUrls.set(itemId, p);
  }
  return p;
}

// Mounted thumbnails listen here, so a replaced photo shows without leaving the screen.
const thumbListeners = new Set<(itemId: string | null) => void>();

/** Drops a cached thumbnail after its photo changes; mounted thumbnails reload. */
export function forgetThumbnail(itemId: string): void {
  dropThumbnail(itemId);
  for (const l of thumbListeners) l(itemId);
}

function dropThumbnail(itemId: string): void {
  const p = thumbUrls.get(itemId);
  thumbUrls.delete(itemId);
  void p?.then((url) => url && URL.revokeObjectURL(url));
}

/** Drops every cached thumbnail (after a restore replaces the photos). */
export function forgetAllThumbnails(): void {
  for (const id of [...thumbUrls.keys()]) dropThumbnail(id);
  for (const l of thumbListeners) l(null);
}

/** The current time, updated every `ms` (banners that depend on the clock). */
export function useNow(ms = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Persistent-storage status and space used (§2); null fields when the browser can't say. */
export type StorageStatus = { persisted: boolean | null; usage: number | null };

export function useStorageStatus(): StorageStatus | null {
  const [s, setS] = useState<StorageStatus | null>(null);
  useEffect(() => {
    const st = navigator.storage;
    Promise.all([st?.persisted?.().catch(() => null) ?? null, st?.estimate?.().catch(() => null) ?? null]).then(([p, e]) =>
      setS({ persisted: p, usage: e?.usage ?? null }),
    );
  }, []);
  return s;
}

/** The full-size photo (detail card, §8) while the screen is open. */
export type PhotoView = {
  url: string;
  /** Taken or chosen on this tablet (not an imported starter or backup photo). */
  taken: boolean;
};

export function usePhoto(itemId: string, hasPhoto: boolean): PhotoView | null {
  const db = useDb();
  const [view, setView] = useState<PhotoView | null>(null);
  useEffect(() => {
    if (!hasPhoto) {
      setView(null);
      return;
    }
    let current: string | null = null;
    const sub = liveQuery(() => db.photos.get(itemId)).subscribe({
      next: (row) => {
        if (current) URL.revokeObjectURL(current);
        current = row ? URL.createObjectURL(row.full) : null;
        setView(row && current ? { url: current, taken: row.taken !== undefined } : null);
      },
      error: () => setView(null),
    });
    return () => {
      sub.unsubscribe();
      if (current) URL.revokeObjectURL(current);
    };
  }, [db, itemId, hasPhoto]);
  return view;
}

export function useThumbnail(itemId: string, hasPhoto: boolean): string | null {
  const db = useDb();
  const [url, setUrl] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const l = (id: string | null) => (id === null || id === itemId) && setVersion((v) => v + 1);
    thumbListeners.add(l);
    return () => void thumbListeners.delete(l);
  }, [itemId]);
  useEffect(() => {
    if (!hasPhoto) {
      setUrl(null);
      return;
    }
    let alive = true;
    thumbUrl(db, itemId).then(
      (u) => alive && setUrl(u),
      () => alive && setUrl(null),
    );
    return () => {
      alive = false;
    };
  }, [db, itemId, hasPhoto, version]);
  return url;
}

/** Helper devices (§18.1), A–Z, live. */
export function useHelpers(): Live<Helper[]> {
  const db = useDb();
  const [live, setLive] = useState<Live<Helper[]>>({ state: 'loading' });
  useEffect(() => {
    const sub = liveQuery(() => loadHelpers(db)).subscribe({
      next: (value) => setLive({ state: 'ready', value }),
      error: (error: unknown) => setLive({ state: 'error', error }),
    });
    return () => sub.unsubscribe();
  }, [db]);
  return live;
}
