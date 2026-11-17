// The app's name and version (from package.json via vite.config.ts, backlog C3). Kept apart from
// io/backup.ts (which re-exports them) so a screen that shows the version doesn't load JSZip (R8, M33).
export const APP_NAME = 'FRC 2408 Inventory Management';
export const APP_VERSION: string = __APP_VERSION__;
