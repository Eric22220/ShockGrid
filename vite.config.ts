/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

// GitHub Pages servește aplicația sub /<nume-repo>/
// Două site-uri din același cod: aplicația pentru bicicliști (implicit) și platforma tehnică (`--mode devapp`),
// publicată din repo-ul Eric22220/ShockGridDev. Fiecare are intrarea, baza, manifestul și service worker-ul ei.
const BASE = '/ShockGrid/';
const DEV_BASE = '/ShockGridDev/';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig(({ command, mode }) => {
  const dev = mode === 'devapp';
  const base = dev ? DEV_BASE : BASE;
  return {
  base: command === 'build' ? base : '/',
  build: { outDir: dev ? 'dist-dev' : 'dist' },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString().slice(0, 16)),
  },
  plugins: [
    react(),
    {
      // aceeași pagină HTML, altă intrare și alt titlu pentru platforma tehnică
      name: 'shockgrid-entry',
      transformIndexHtml: {
        order: 'pre' as const, // înainte ca Vite să rezolve scriptul de intrare
        handler(html: string) {
        if (!dev) return html;
        return html
          .replace('/src/main.tsx', '/src/main-dev.tsx')
          .replace(/<title>[^<]*<\/title>/, '<title>ShockGrid Dev — platforma tehnică</title>')
          .replace('content="ShockGrid"', 'content="ShockGrid Dev"')
          .replace(/<meta name="description" content="[^"]*"/, '<meta name="description" content="ShockGrid Dev: importul înregistrărilor, analiza vibrațiilor, gruparea șocurilor și generarea stratului public."');
        },
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // înregistrare proprie (src/services/update.ts): reîncărcarea se amână în timpul unei ture
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: base,
        name: dev ? 'ShockGrid Dev — platforma tehnică' : 'ShockGrid — confortul velo în Timișoara',
        short_name: dev ? 'ShockGrid Dev' : 'ShockGrid',
        description: dev ? 'Import, analiză și audit pentru datele ShockGrid.' : 'Harta confortului pe bicicletă din vibrații măsurate, comparare de trasee și ruta cea mai netedă.',
        lang: 'ro',
        theme_color: '#1857f5',
        background_color: '#f4f6fa',
        display: 'standalone',
        scope: base,
        start_url: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // versiunea nouă se activează singură, și pentru instalările existente (reîncărcarea paginii e amânată în aplicație)
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['**/data/**'],
        navigateFallbackDenylist: [/\/data\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/data/') && url.pathname.endsWith('.json'),
            handler: 'NetworkFirst',
            options: { cacheName: dev ? 'sgdev-data' : 'sg-data', networkTimeoutSeconds: 4, expiration: { maxEntries: 20 } },
          },
          {
            // tile-urile văzute deja rămân în cache (fără descărcare în masă)
            urlPattern: ({ url }) => url.hostname.endsWith('tile.openstreetmap.org'),
            handler: 'CacheFirst',
            options: {
              cacheName: dev ? 'sgdev-osm-tiles' : 'osm-tiles',
              expiration: { maxEntries: 600, maxAgeSeconds: 7 * 24 * 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    host: true,
    allowedHosts: ['.trycloudflare.com'],
  },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 60000,
  },
  };
});
