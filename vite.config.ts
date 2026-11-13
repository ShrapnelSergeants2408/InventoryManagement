import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

// The one place the version number is kept (backlog C3): package.json. The app, the backup and kit
// files, and the browser checks all read it from there.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  // Relative base so the build works under any GitHub Pages sub-path.
  base: './',
  // When this copy was built, shown in More › About with the app version (SPEC v0.9), so a
  // tablet check can tell whether an update arrived.
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()), __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    preact(),
    // Installable and fully usable offline (SPEC §2): the service worker precaches the app,
    // fonts, icons and the scanner fallback's .wasm. The starter catalog ZIP (F22, 5.4 MB) is left out: a
    // helper's first load stays small, and the shop tablet's setup downloads it (v0.20, backlog C2). A new
    // version waits for "Reload" (ui/shell/UpdateBanner.tsx) so a count is never cut off.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeManifestIcons: false,
      manifest: {
        name: 'FRC 2408 Inventory Management',
        short_name: '2408 Inventory',
        description: 'Shop inventory, order list and QR labels for FRC Team 2408, the Shrapnel Sergeants.',
        id: './',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#F2EFEA',
        theme_color: '#2E1710',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{html,js,css,woff2,png,svg,wasm}'],
        // The zxing .wasm is about 1.1 MB.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The team's time zone, so local-time tests (count times, DST changes) give the same results on any machine.
    env: { TZ: 'America/Chicago' },
  },
});
