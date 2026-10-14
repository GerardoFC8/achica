/**
 * Writes the first screen into each built page: dist/index.html in Spanish and
 * dist/en/index.html in English (D52, D54).
 *
 * Runs after `vite build`, as part of `npm run build`. It renders the app's
 * empty state through Vite's own SSR loader, so the markup comes from the same
 * components the browser runs and cannot drift from them. Nothing renders at
 * request time: there is no server, and the output is static files like
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

const PAGES = [
  { file: join('dist', 'index.html'), language: 'es' },
  { file: join('dist', 'en', 'index.html'), language: 'en' },
]

const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom',
})

try {
  const { render } = await server.ssrLoadModule('/src/prerender.tsx')

  for (const { file, language } of PAGES) {
    const target = join(ROOT, file)
    const html = await readFile(target, 'utf8')

    if (!html.includes(MOUNT)) {
      throw new Error(`${file} has no empty ${MOUNT} to fill. Was it prerendered already?`)
    }
    if (!html.includes(`<html lang="${language}">`)) {
      throw new Error(`${file} does not say it is in "${language}"`)
    }

    await writeFile(target, html.replace(MOUNT, `<div id="app">${render(language)}</div>`))
    console.log(`prerendered the first screen into ${file}`)
  }
} finally {
  await server.close()
}
