import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const isHarmonyBuild = process.env.CAREJOURNAL_HARMONY_BUILD === '1'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: isHarmonyBuild ? {
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  } : undefined,
  server: {
    proxy: {
      '/api/llm': 'http://127.0.0.1:8787',
      '/api/azure-openai': 'http://127.0.0.1:8787',
      '/api/lan': 'http://127.0.0.1:8787',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
