import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const isHarmonyBuild = process.env.CAREJOURNAL_HARMONY_BUILD === '1'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: '127.0.0.1',
    port: 14207,
    strictPort: true,
  },
  build: isHarmonyBuild ? {
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  } : undefined,
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
