// Aim and hold for the camera (F21, F29; Dan 2026-10-28): with several codes in view, only a
// code inside the on-screen square counts, the one nearest its center wins, and it must stay
// there for HOLD_MS before it is used. Pure, so it is tested without a camera.

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Seen {
  rawValue: string;
  format: string;
  /** Where the code is in the video frame, in video pixels (BarcodeDetector's boundingBox). */
  boundingBox?: Box;
}

export interface Size {
  width: number;
  height: number;
}

/** How long the same code must stay in the square before it is used. */
export const HOLD_MS = 600;
/** A code missed for up to this long (a blurred frame) keeps its hold. */
export const HOLD_GAP_MS = 400;

/**
 * Where a point of the video frame shows in the view. The video fills the view with
 * object-fit: cover, so it is scaled up and its overflow cropped equally on both sides.
 */
export function toView(x: number, y: number, video: Size, view: Size): { x: number; y: number } {
  const scale = Math.max(view.width / video.width, view.height / video.height);
  return {
    x: x * scale + (view.width - video.width * scale) / 2,
    y: y * scale + (view.height - video.height * scale) / 2,
  };
}

/**
 * The code being aimed at: its center inside `aim` (in view coordinates), nearest the aim's
 * center. With no aim box, anywhere in the view counts. A code without a position (a detector
 * that doesn't give one) is taken only when it is the only code seen.
 */
export function pickAimed(found: readonly Seen[], video: Size, view: Size, aim: Box | null): Seen | null {
  const codes = found.filter((f) => f.rawValue.trim() !== '');
  if (codes.length === 0) return null;
  if (video.width <= 0 || video.height <= 0 || view.width <= 0 || view.height <= 0) return codes.length === 1 ? codes[0]! : null;
  const area = aim ?? { x: 0, y: 0, width: view.width, height: view.height };
  const cx = area.x + area.width / 2;
  const cy = area.y + area.height / 2;
  let best: Seen | null = null;
  let bestDist = Infinity;
  for (const f of codes) {
    const b = f.boundingBox;
    if (!b) {
      if (codes.length === 1) return f;
      continue;
    }
    const p = toView(b.x + b.width / 2, b.y + b.height / 2, video, view);
    if (p.x < area.x || p.x > area.x + area.width || p.y < area.y || p.y > area.y + area.height) continue;
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d < bestDist) {
      best = f;
      bestDist = d;
    }
  }
  return best;
}

export interface Hold {
  code: string;
  /** When this code was first seen in the square. */
  since: number;
  /** When it was last seen there. */
  seen: number;
}

/**
 * One camera frame's step of the hold: `code` is what is aimed at now (null for nothing).
 * `progress` (0–1) is shown on the square; `ready` means use the code now.
 */
export function stepHold(prev: Hold | null, code: string | null, now: number): { hold: Hold | null; progress: number; ready: boolean } {
  if (code === null) {
    if (prev && now - prev.seen <= HOLD_GAP_MS) return { hold: prev, progress: Math.min(1, (prev.seen - prev.since) / HOLD_MS), ready: false };
    return { hold: null, progress: 0, ready: false };
  }
  if (!prev || prev.code !== code) return { hold: { code, since: now, seen: now }, progress: 0, ready: false };
  const held = now - prev.since;
  return { hold: { ...prev, seen: now }, progress: Math.min(1, held / HOLD_MS), ready: held >= HOLD_MS };
}
