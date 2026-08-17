import tailwindcss from '@tailwindcss/vite'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

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
  preview: {
    // Mirror the headers public/_headers sets on Cloudflare Pages, so a COEP
    // problem shows up against the local production build instead of after a
    // deploy.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: (filePath) =>
      // Never inline wasm. A base64 data URL cannot be streamed by
      // WebAssembly.instantiateStreaming and it defeats HTTP caching.
      filePath.endsWith('.wasm') ? false : undefined,
  },

  /*
   * Two projects on purpose (D3).
   *
   * Most of core/ is arithmetic and byte inspection, and it runs far faster
   * in Node. Codecs cannot: @jsquash decodes to ImageData, which does not
   * exist in Node, so those tests need a real browser.
   *
   * The split doubles as a design signal. If a test has to move to the
   * browser project, the code under test is touching the platform edge, and
   * that is worth noticing.
   */
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['{src,test}/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['{src,test}/**/*.browser-test.ts'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
