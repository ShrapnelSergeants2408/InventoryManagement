// Live data for screens: Dexie liveQuery re-runs the query whenever a table it read changes.
import { liveQuery } from 'dexie';
import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import type { InventoryDb } from '../data/db';
import { loadSnapshot, type InventorySnapshot } from '../data/inventory';
import { getThumbnail } from '../data/photos';
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

/** Drops a cached thumbnail after its photo changes (M7). */
export function forgetThumbnail(itemId: string): void {
  const p = thumbUrls.get(itemId);
  thumbUrls.delete(itemId);
  void p?.then((url) => url && URL.revokeObjectURL(url));
}

/** The full-size photo (detail card, §8) as an object URL while the screen is open. */
export function usePhotoUrl(itemId: string, hasPhoto: boolean): string | null {
  const db = useDb();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!hasPhoto) {
      setUrl(null);
      return;
    }
    let current: string | null = null;
    const sub = liveQuery(() => db.photos.get(itemId)).subscribe({
      next: (row) => {
        if (current) URL.revokeObjectURL(current);
        current = row ? URL.createObjectURL(row.full) : null;
        setUrl(current);
      },
      error: () => setUrl(null),
    });
    return () => {
      sub.unsubscribe();
      if (current) URL.revokeObjectURL(current);
    };
  }, [db, itemId, hasPhoto]);
  return url;
}

export function useThumbnail(itemId: string, hasPhoto: boolean): string | null {
  const db = useDb();
  const [url, setUrl] = useState<string | null>(null);
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
  }, [db, itemId, hasPhoto]);
  return url;
}
