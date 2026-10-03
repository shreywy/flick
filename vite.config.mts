import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'src',
  base: './',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true, target: 'chrome140', assetsInlineLimit: 0 },
  worker: { format: 'es' },
  test: { root: '.', include: ['test/**/*.test.ts'] },
} as never)
