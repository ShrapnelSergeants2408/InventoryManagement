import { describe, expect, it } from 'vitest';
import { PHOTO_LONG_SIDE, THUMB_LONG_SIDE, fitWithin } from '../src/domain/image-size';

describe('image resize math (SPEC §8)', () => {
  it.each([
    ['landscape', 4000, 3000, 1024, { width: 1024, height: 768 }],
    ['portrait', 3000, 4000, 1024, { width: 768, height: 1024 }],
    ['square', 2048, 2048, 1024, { width: 1024, height: 1024 }],
    ['already small: not upscaled', 640, 480, 1024, { width: 640, height: 480 }],
    ['exactly the limit', 1024, 300, 1024, { width: 1024, height: 300 }],
    ['thumbnail from a 1024 photo', 1024, 768, 160, { width: 160, height: 120 }],
    ['very thin strip keeps at least 1 px', 5000, 2, 160, { width: 160, height: 1 }],
  ])('%s', (_name, w, h, max, out) => {
    expect(fitWithin(w, h, max)).toEqual(out);
  });

  it('rejects empty or invalid sizes', () => {
    expect(() => fitWithin(0, 10, 100)).toThrow(RangeError);
    expect(() => fitWithin(NaN, 10, 100)).toThrow(RangeError);
  });

  it('constants', () => {
    expect([PHOTO_LONG_SIDE, THUMB_LONG_SIDE]).toEqual([1024, 160]);
  });
});
