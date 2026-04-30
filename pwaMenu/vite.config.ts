import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: ['babel-plugin-react-compiler'],
      },
    }),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'Buen Sabor - Menú',
        short_name: 'BuenSabor',
        description: 'Menú digital y pedidos online',
        theme_color: '#f97316',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          // 1. Images → CacheFirst, 30 days
          {
            urlPattern: ({ url }: { url: URL }) =>
              /\.(png|jpg|jpeg|webp|svg|ico)$/i.test(url.pathname),
            handler: 'CacheFirst' as const,
            options: {
              cacheName: 'pwamenu-images',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // 2. Public menu API → NetworkFirst, 5 min
          {
            urlPattern: ({ url }: { url: URL }) =>
              url.pathname.startsWith('/api/public/'),
            handler: 'NetworkFirst' as const,
            options: {
              cacheName: 'pwamenu-public-api',
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 5,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // 3. Fonts → CacheFirst, 1 year
          {
            urlPattern: ({ url }: { url: URL }) =>
              /\.(woff2|woff|ttf)$/i.test(url.pathname),
            handler: 'CacheFirst' as const,
            options: {
              cacheName: 'pwamenu-fonts',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // NOTE: /api/diner/*, /api/waiter/* are NOT matched — always go to network
        ],
      },
    }),
  ],
  server: {
    port: 5176,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/tests/setup.ts'],
  },
})
