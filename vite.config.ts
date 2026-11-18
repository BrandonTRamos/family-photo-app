import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { isPicture, isThumb, keepByPath, PICTURE_CACHES, PICTURE_LIMITS } from './src/media-cache';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // The waiting worker activates only when Refresh is tapped in UpdateBanner.
      registerType: 'prompt',
      // Keep the existing install manifest and icons.
      manifest: false,
      includeAssets: ['manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
      workbox: {
        // Precache only the app shell. Private API responses are never cached here.
        globPatterns: ['**/*.{js,css,html}'],
        globIgnores: ['**/node_modules/**/*', 'sw.js', 'workbox-*.js'],
        // Pictures already downloaded stay on the phone across their hourly link changes (see src/media-cache.ts).
        runtimeCaching: [
          {
            urlPattern: isThumb,
            handler: 'CacheFirst',
            options: {
              cacheName: PICTURE_CACHES.thumbs,
              plugins: [keepByPath],
              expiration: { maxEntries: PICTURE_LIMITS.thumbs, purgeOnQuotaError: true },
            },
          },
          {
            urlPattern: isPicture,
            handler: 'CacheFirst',
            options: {
              cacheName: PICTURE_CACHES.display,
              plugins: [keepByPath],
              expiration: { maxEntries: PICTURE_LIMITS.display, purgeOnQuotaError: true },
            },
          },
        ],
      },
    }),
  ],
});
