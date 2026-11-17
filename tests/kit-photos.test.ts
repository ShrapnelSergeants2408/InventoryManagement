// M32 (SPEC v0.27): photos made small for count kits (src/data/kit-photos.ts).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetKitPhotos, kitPhotos } from '../src/data/kit-photos';
import { KIT_PHOTO_LONG_SIDE, fitWithin } from '../src/domain/image-size';

const blob = (bytes: number) => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
const row = (itemId: string, bytes: number, updatedAt = 1) => ({ itemId, full: blob(bytes), updatedAt });

beforeEach(() => forgetKitPhotos());

describe('kitPhotos', () => {
  it('puts the small copy in, item by item, and says how far it got', async () => {
    const shrink = vi.fn(async (full: Blob) => blob(Math.round(full.size / 10)));
    const progress: [number, number][] = [];
    const out = await kitPhotos([row('a', 1000), row('b', 2000)], shrink, (d, t) => progress.push([d, t]));
    expect([out.get('a')!.size, out.get('b')!.size]).toEqual([100, 200]);
    expect(progress).toEqual([[1, 2], [2, 2]]);
  });

  it('keeps the stored photo when it is already smaller than the copy', async () => {
    const out = await kitPhotos([row('a', 50)], async () => blob(80));
    expect(out.get('a')!.size).toBe(50);
  });

  it('keeps the stored photo when it cannot be read, so no photo is lost from a kit', async () => {
    const out = await kitPhotos([row('a', 500), row('b', 600)], async (full) => {
      if (full.size === 500) throw new Error('unreadable');
      return blob(60);
    });
    expect([out.get('a')!.size, out.get('b')!.size]).toEqual([500, 60]);
  });

  it('makes each photo small once: the next kit (Send all kits) reuses it', async () => {
    const shrink = vi.fn(async () => blob(10));
    const rows = [row('a', 1000), row('b', 1000)];
    await kitPhotos(rows, shrink);
    const again = await kitPhotos(rows, shrink);
    expect(shrink).toHaveBeenCalledTimes(2);
    expect(again.get('a')!.size).toBe(10);
  });

  it('a photo replaced since (new updatedAt) is made small again', async () => {
    const shrink = vi.fn(async () => blob(10));
    await kitPhotos([row('a', 1000, 1)], shrink);
    await kitPhotos([row('a', 1000, 2)], shrink);
    expect(shrink).toHaveBeenCalledTimes(2);
  });

  it('no photos: an empty map and no progress calls', async () => {
    const progress = vi.fn();
    expect((await kitPhotos([], async () => blob(1), progress)).size).toBe(0);
    expect(progress).not.toHaveBeenCalled();
  });
});

describe('kit photo size', () => {
  it('is 320 px on the long side, never enlarged', () => {
    expect(KIT_PHOTO_LONG_SIDE).toBe(320);
    expect(fitWithin(1024, 768, KIT_PHOTO_LONG_SIDE)).toEqual({ width: 320, height: 240 });
    expect(fitWithin(768, 1024, KIT_PHOTO_LONG_SIDE)).toEqual({ width: 240, height: 320 });
    expect(fitWithin(200, 100, KIT_PHOTO_LONG_SIDE)).toEqual({ width: 200, height: 100 });
  });
});
