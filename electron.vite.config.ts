import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = resolve(__dirname, 'src/shared')

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    build: { outDir: 'out/main' }
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    build: { outDir: 'out/preload' }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: { '@shared': shared } },
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
      minify: true,
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') }
    }
  }
})
