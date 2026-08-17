import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tailwindcss()],
  optimizeDeps: {
    // The @jsquash packages ship wasm-pack glue. Vite's dependency
    // pre-bundling rewrites the wasm URL and instantiation then fails with
    // "both async and sync fetching of the wasm failed". Excluding them is
    // mandatory, not an optimisation.
    exclude: [
      '@jsquash/avif',
      '@jsquash/jpeg',
      '@jsquash/oxipng',
      '@jsquash/png',
      '@jsquash/resize',
      '@jsquash/webp',
    ],
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: (filePath) =>
      // Never inline wasm. A base64 data URL cannot be streamed by
      // WebAssembly.instantiateStreaming and it defeats HTTP caching.
      filePath.endsWith('.wasm') ? false : undefined,
  },
})
