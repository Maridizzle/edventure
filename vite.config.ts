import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    // One chunk. Risk #10 in the plan: a dynamically-imported chunk that the
    // service worker did not precache is a white screen, which is the worst
    // possible failure for a child — there is nothing to tap.
    rollupOptions: { output: { manualChunks: undefined } },
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'favicon.svg'],
      manifest: {
        name: 'Edventure',
        short_name: 'Edventure',
        description: 'A painting adventure.',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#20242c',
        theme_color: '#20242c',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,webp,svg,woff2}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        // Never force a mid-session reload; updates apply on the next cold start.
        skipWaiting: false,
        navigateFallback: 'index.html',
      },
      devOptions: { enabled: false },
    }),
  ],
});
