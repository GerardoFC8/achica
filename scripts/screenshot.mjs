/**
 * Takes the README's screenshot, so it can be regenerated instead of being a
 * picture nobody can reproduce.
 *
 * It drives the real interface on a throwaway dev server, with real files from
 * the fixture corpus and real codecs — the figures in the image are measured,
 * not mocked up. The destination is the one with a weight budget, because the
 * budget mark is what the weight bar is for and a capture without it would
 * show the least interesting half of the design.
 *
 * Run: node scripts/screenshot.mjs
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = (path) => join(ROOT, 'test', 'fixtures', path)

const FILES = [
  fixture('vendor/exif-orientation/Landscape_6.jpg'),
  fixture('vendor/exif-orientation/Portrait_6.jpg'),
  fixture('generated/no-exif.jpg'),
  fixture('generated/orientation-6.jpg'),
  fixture('generated/sample.webp'),
  // Kept in on purpose: a batch that never fails tells half the story.
  fixture('vendor/pngsuite/xd0n2c08.png'),
]

const SHOTS = [
  { name: 'captura.png', width: 1280, height: 720 },
  { name: 'captura-movil.png', width: 390, height: 780 },
]

const server = await createServer({ logLevel: 'error', server: { port: 0 } })
await server.listen()

const base = server.resolvedUrls?.local?.[0]
if (base === undefined) throw new Error('vite did not report a local url')

const browser = await chromium.launch()

try {
  for (const shot of SHOTS) {
    const page = await browser.newPage({
      viewport: { width: shot.width, height: shot.height },
      deviceScaleFactor: 2,
    })
    page.on('pageerror', (error) => console.error('[page]', error.message))

    await page.goto(base)
    await page.getByRole('button', { name: /Destino/ }).click()
    await page.getByRole('button', { name: /Enviar por mensajería/ }).click()
    await page.setInputFiles('input[type=file]', FILES)
    await page.getByRole('button', { name: /Comprimir/ }).click()
    // Not "N imágenes comprimidas": that total is true as soon as the third
    // file lands, and the capture came out with two rows still encoding.
    await page.waitForFunction(
      () => !(document.body.textContent ?? '').includes('Comprimiendo'),
      undefined,
      { timeout: 60_000 },
    )

    const target = join(ROOT, 'docs', shot.name)
    await page.screenshot({ path: target })
    console.log(`${shot.name} ${shot.width}×${shot.height}`)
    await page.close()
  }
} finally {
  await browser.close()
  await server.close()
}
