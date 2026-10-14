/**
 * Writes the first screen into the built index.html.
 *
 * Runs after `vite build`, as part of `npm run build`. It renders the app's
 * empty state through Vite's own SSR loader, so the markup comes from the same
 * components the browser runs and cannot drift from them. Nothing renders at
 * request time: there is no server, and the output is one static file like
 * before.
 *
 * Why it is worth a build step: link previews (WhatsApp, X, LinkedIn) and some
 * crawlers never run JavaScript, and until now they saw an empty <div>.
 *
 * Run: npm run build
 */

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MOUNT = '<div id="app"></div>'

const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom',
})

try {
  const { render } = await server.ssrLoadModule('/src/prerender.tsx')
  const target = join(ROOT, 'dist', 'index.html')
  const html = await readFile(target, 'utf8')

  if (!html.includes(MOUNT)) {
    throw new Error(`dist/index.html has no empty ${MOUNT} to fill. Was it prerendered already?`)
  }

  await writeFile(target, html.replace(MOUNT, `<div id="app">${render()}</div>`))
  console.log('prerendered the first screen into dist/index.html')
} finally {
  await server.close()
}
