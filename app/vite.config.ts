import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const appPackage = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// base './': مسارات أصول نسبية — إلزامي للتحميل عبر file:// في النسخة المُثبَّتة
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appPackage.version) },
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    allowedHosts: true,
  },
})
