// The app version for the browser checks: package.json is the only place it is kept (backlog C3).
import { readFileSync } from 'node:fs';

export const APP_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
