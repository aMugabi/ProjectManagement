import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves this app from a /ProjectManagement/ subpath; Vercel
  // (and any other host serving from the domain root) needs base '/'.
  base: process.env.VERCEL ? '/' : '/ProjectManagement/',
  // Only Vercel deploys have the /api functions; everywhere else Ledger runs local-only.
  define: {
    'import.meta.env.VITE_CLOUD': JSON.stringify(process.env.VERCEL ? 'true' : ''),
  },
  test: {
    include: ['src/**/*.test.ts', 'api/**/*.test.ts'],
  },
  plugins: [
    react(),
    // Makes Ledger installable and lets it open offline. start_url/scope default to
    // `base`, so the same config works on both Vercel and GitHub Pages.
    VitePWA({
      registerType: 'autoUpdate',
      // Registered from src/main.tsx via virtual:pwa-register.
      injectRegister: false,
      // The icons are already picked up by workbox.globPatterns below.
      includeManifestIcons: false,
      manifest: {
        name: 'Ledger',
        short_name: 'Ledger',
        description: 'Track tasks across several concurrent personal projects.',
        display: 'standalone',
        theme_color: '#f7f6f3',
        background_color: '#f7f6f3',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        // Only GitHub Pages' deep-link redirect shim; never useful offline.
        globIgnores: ['404.html'],
        // Serve the app shell for client-side routes (/tasks, /timeline, …) — but
        // never for the sync API, which must always reach the network.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
})
