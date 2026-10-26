import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Relative base so the build works under any GitHub Pages sub-path.
  base: './',
  plugins: [
    preact(),
    // Installable and fully usable offline (SPEC §2): the service worker precaches the app,
    // fonts, icons, the starter catalog ZIP (F22) and the scanner fallback's .wasm. A new
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
        globPatterns: ['**/*.{html,js,css,woff2,png,svg,wasm,zip}'],
        // The starter catalog is about 5.4 MB and the zxing .wasm about 1.1 MB.
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
