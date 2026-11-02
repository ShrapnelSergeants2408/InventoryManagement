import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Relative base so the build works under any hosting sub-path.
  base: './',
  // When this copy was built, shown in More › About with the app version, so a phone check can
  // tell whether an update arrived.
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  plugins: [
    preact(),
    // Installable and fully usable offline (SPEC v2.0 §2): the service worker precaches the app,
    // fonts, icons and the scanner fallback's .wasm. A new version waits for "Reload"
    // (ui/shell/UpdateBanner.tsx) so an edit in progress is never cut off.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeManifestIcons: false,
      manifest: {
        name: 'Hiebert Home Inventory',
        short_name: 'Home Inventory',
        description: 'Household inventory: what is in each bin and on each shelf, with QR labels.',
        id: './',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
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
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The household's time zone, so local-time tests (DST changes) give the same results on any machine.
    env: { TZ: 'America/Chicago' },
  },
});
