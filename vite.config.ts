import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        id: './',
        name: 'Pasado',
        short_name: 'Pasado',
        display: 'standalone',
        background_color: '#F6F4FB',
        theme_color: '#4B3FD6',
        start_url: './',
        icons: [
          { src: './icons/pasado-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: './icons/pasado-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: './icons/pasado-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,svg,png}'],
        importScripts: ['./notification-click.js'],
      },
    }),
  ],
})
