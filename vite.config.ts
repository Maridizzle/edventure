import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Where the app will be served from.
 *
 * A GitHub Pages project site lives under /edventure/, not at the domain root,
 * so the CI build sets BASE_PATH=/edventure/. A relative base ('./') mostly
 * works for assets but makes vite-plugin-pwa resolve `navigateFallback` and the
 * manifest's start_url/scope against the wrong root — which surfaces as a white
 * screen on the *second* launch, once the service worker is serving. That is
 * the worst failure this app can have: a 5-year-old cannot fix or force-quit
 * a blank page.
 */
const base = process.env.BASE_PATH ?? '/';

/** Single self-contained HTML file for the tap-to-play link; no SW, no manifest. */
const standalone = process.env.STANDALONE === '1';

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    // One chunk. Risk #10 in the plan: a dynamically-imported chunk that the
    // service worker did not precache is a white screen, which is the worst
    // possible failure for a child — there is nothing to tap.
    rollupOptions: { output: { manualChunks: undefined } },
    ...(standalone
      ? { outDir: 'dist-standalone', assetsInlineLimit: 0, cssCodeSplit: false }
      : {}),
  },
  plugins: standalone
    ? []
    : [
        VitePWA({
          registerType: 'autoUpdate',
          includeAssets: ['icons/*.png', 'favicon.svg'],
          manifest: {
            name: 'Edventure',
            short_name: 'Edventure',
            description: 'A painting adventure.',
            start_url: base,
            scope: base,
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
            navigateFallback: `${base}index.html`,
          },
          devOptions: { enabled: false },
        }),
      ],
});
