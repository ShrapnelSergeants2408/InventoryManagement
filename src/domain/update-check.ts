// When the app looks for a new version (v0.26, review R2). The browser checks only when a page
// loads, and an installed app reopened from Android's recent apps doesn't load again, so the
// Reload banner rarely appeared and updating the tablet needed Force stop (HANDOFF §7). The app now
// also checks when it comes back on screen and every hour while it's open, and on request
// (More › About › Check for updates).

/** Coming back on screen checks at most this often. */
export const CHECK_GAP_MS = 30 * 60 * 1000;
/** While the app stays on screen. */
export const CHECK_EVERY_MS = 60 * 60 * 1000;

/** A check is due when the last one was at least CHECK_GAP_MS ago (or the clock went backwards). */
export function dueForCheck(now: number, lastCheck: number): boolean {
  return now - lastCheck >= CHECK_GAP_MS || now < lastCheck;
}

/** What Check for updates found. */
export type UpdateResult = 'ready' | 'current' | 'offline' | 'unsupported' | 'failed';

/** The toast for each result. */
export function updateMessage(result: UpdateResult, version: string): string {
  switch (result) {
    case 'ready':
      return 'A new version is ready. Tap Reload in the banner when you’re not in the middle of something.';
    case 'current':
      return `This is the newest version (${version}).`;
    case 'offline':
      return 'No connection. Connect to Wi-Fi and try again.';
    case 'unsupported':
      return 'This browser can’t check for updates. Reload the page instead.';
    case 'failed':
      return 'Couldn’t check for updates. Try again later.';
  }
}
