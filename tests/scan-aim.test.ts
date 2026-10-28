// Aim and hold for the camera (SPEC F21, F29; §20): with several codes in view, only one in
// the square counts, nearest its center, and it is used once held there for HOLD_MS.
import { describe, expect, it } from 'vitest';
import { HOLD_GAP_MS, HOLD_MS, pickAimed, stepHold, toView, type Hold, type Seen } from '../src/domain/scan-aim';

// A 640×480 video shown in a 1000×500 view: cover scales by 1000/640 = 1.5625, so the frame
// is 750 tall and 125 px is cropped off the top and bottom.
const video = { width: 640, height: 480 };
const view = { width: 1000, height: 500 };
const aim = { x: 400, y: 150, width: 200, height: 200 };
/** A 40×40 code centered at video point (cx, cy). */
const at = (rawValue: string, cx: number, cy: number): Seen => ({ rawValue, format: 'qr_code', boundingBox: { x: cx - 20, y: cy - 20, width: 40, height: 40 } });
const pick = (found: Seen[], box: typeof aim | null = aim) => pickAimed(found, video, view, box)?.rawValue ?? null;

describe('where the video shows on screen (object-fit: cover)', () => {
  it('scales to fill and crops the overflow equally', () => {
    expect(toView(320, 240, video, view)).toEqual({ x: 500, y: 250 });
    expect(toView(0, 0, video, view)).toEqual({ x: 0, y: -125 });
    expect(toView(640, 480, video, view)).toEqual({ x: 1000, y: 625 });
  });

  it('crops the sides when the view is taller than the video', () => {
    expect(toView(0, 240, video, { width: 300, height: 480 })).toEqual({ x: -170, y: 240 });
  });
});

describe('aim: which code counts (F21, F29)', () => {
  it('a code in the square counts; one outside it does not', () => {
    expect(pick([at('Tools 7', 320, 240)])).toBe('Tools 7');
    expect(pick([at('Tools 8', 100, 240)])).toBeNull();
  });

  it('with several codes in view, the one in the square wins, wherever it is in the list', () => {
    expect(pick([at('Tools 6', 60, 240), at('Tools 7', 320, 240), at('Tools 8', 580, 240)])).toBe('Tools 7');
  });

  it('with several in the square, the one nearest its center wins', () => {
    expect(pick([at('Tools 6', 270, 200), at('Tools 7', 325, 245)])).toBe('Tools 7');
  });

  it('a code in the cropped-off part of the frame never counts, even with no square', () => {
    // Video y = 10 shows at 1.5625 × 10 − 125 ≈ −109: above the view.
    expect(pick([at('Off screen', 320, 10)], null)).toBeNull();
    expect(pick([at('On screen', 320, 240)], null)).toBe('On screen');
  });

  it('blank codes are ignored', () => {
    expect(pick([at('  ', 320, 240)])).toBeNull();
  });

  it('a code with no position is taken only when it is the only one', () => {
    expect(pick([{ rawValue: 'Tools 7', format: 'qr_code' }])).toBe('Tools 7');
    expect(pick([{ rawValue: 'Tools 7', format: 'qr_code' }, { rawValue: 'Tools 8', format: 'qr_code' }])).toBeNull();
    expect(pick([{ rawValue: 'Tools 7', format: 'qr_code' }, at('Tools 8', 320, 240)])).toBe('Tools 8');
  });

  it('before the video has a size, only a single code counts', () => {
    expect(pickAimed([at('A', 1, 1)], { width: 0, height: 0 }, view, aim)?.rawValue).toBe('A');
    expect(pickAimed([at('A', 1, 1), at('B', 2, 2)], { width: 0, height: 0 }, view, aim)).toBeNull();
  });
});

describe('hold: a code is used once it stays in the square', () => {
  const run = (frames: Array<[string | null, number]>) => {
    let hold: Hold | null = null;
    const out: Array<[number, boolean]> = [];
    for (const [code, now] of frames) {
      const s = stepHold(hold, code, now);
      hold = s.hold;
      out.push([Math.round(s.progress * 100) / 100, s.ready]);
    }
    return out;
  };

  it(`is ready after ${HOLD_MS} ms of the same code, with progress on the way`, () => {
    expect(HOLD_MS).toBe(600);
    expect(run([['A', 0], ['A', 200], ['A', 400], ['A', 599], ['A', 600]])).toEqual([[0, false], [0.33, false], [0.67, false], [1, false], [1, true]]);
  });

  it('a different code starts over', () => {
    expect(run([['A', 0], ['A', 400], ['B', 600], ['B', 1000], ['B', 1200]])).toEqual([[0, false], [0.67, false], [0, false], [0.67, false], [1, true]]);
  });

  it(`a missed frame (up to ${HOLD_GAP_MS} ms) keeps the hold; a longer gap loses it`, () => {
    expect(run([['A', 0], ['A', 200], [null, 400], ['A', 600]])).toEqual([[0, false], [0.33, false], [0.33, false], [1, true]]);
    expect(run([['A', 0], ['A', 200], [null, 601], ['A', 800]])).toEqual([[0, false], [0.33, false], [0, false], [0, false]]);
  });

  it('nothing aimed at: no hold', () => {
    expect(stepHold(null, null, 5)).toEqual({ hold: null, progress: 0, ready: false });
  });
});
