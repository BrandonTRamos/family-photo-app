import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

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
        // Only cache the app shell. Private API responses and media keep their existing caching behavior.
        globPatterns: ['**/*.{js,css,html}'],
        globIgnores: ['**/node_modules/**/*', 'sw.js', 'workbox-*.js'],
      },
    }),
  ],
});
