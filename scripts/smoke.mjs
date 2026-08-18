/**
 * The smoke test: the whole product, against the production build, in both
 * browsers it targets.
 *
 * It runs on `vite preview` rather than the dev server on purpose — that is
 * the build that ships, served with the same COOP and COEP headers the host
 * sends, so a header problem or a bundling problem fails here instead of after
 * a deploy.
 *
 * The check that matters most is the network audit. "No byte leaves your
 * device" is the product's whole argument, and phase 0 could only measure it
 * from inside the page, where Resource Timing is a floor and not a record.
 * Playwright sees every request the browser makes, which is the instrument
 * that claim always needed.
 *
 * The folder save is not here and cannot be: showDirectoryPicker needs a user
 * gesture and opens a native dialog no automation can drive. It is covered by
 * fakes in src/output/save.browser-test.ts and verified by hand.
 *
 * Run: npm run build && npm run smoke
 */

import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, firefox } from 'playwright'
import { preview } from 'vite'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = (path) => join(ROOT, 'test', 'fixtures', path)

const FILES = [
  fixture('vendor/exif-orientation/Landscape_6.jpg'),
  fixture('generated/no-exif.jpg'),
  fixture('generated/sample.webp'),
]

const EXPECTED_IN_ZIP = ['Landscape_6', 'no-exif', 'sample']

const LOCAL_HEADER = '504b0304'
const CENTRAL_ENTRY = 'PK\x01\x02'
const END_OF_DIRECTORY = 'PK\x05\x06'

try {
  await stat(join(ROOT, 'dist', 'index.html'))
} catch {
  console.error('No dist/ to test. Run npm run build first.')
  process.exit(1)
}

const server = await preview({ logLevel: 'error', preview: { port: 0 } })
const base = server.resolvedUrls?.local?.[0]
if (base === undefined) throw new Error('vite preview did not report a local url')

const origin = new URL(base).origin
let failed = false

const check = (browser, label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail === '' ? '' : ` — ${detail}`}`)
  if (!ok) failed = true
}

try {
  for (const [name, engine] of [
    ['chromium', chromium],
    ['firefox', firefox],
  ]) {
    console.log(`\n${name}`)

    const downloads = await mkdtemp(join(tmpdir(), 'achica-smoke-'))
    const browser = await engine.launch()

    try {
      const page = await browser.newPage({ acceptDownloads: true })

      /*
       * Every request the page makes, from the first byte. A blob: or data:
       * URL never touches the network, so only real schemes are recorded.
       */
      const foreign = []
      page.on('request', (request) => {
        const url = request.url()
        if (!/^https?:/.test(url)) return
        if (!url.startsWith(origin)) foreign.push(url)
      })

      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))

      await page.goto(base)
      check(
        name,
        'the work surface is the first screen',
        await page.getByText('Arrastra tus imágenes aquí').isVisible(),
      )

      const isolated = await page.evaluate(() => globalThis.crossOriginIsolated)
      check(name, 'cross-origin isolated', isolated === true)

      await page.setInputFiles('input[type=file]', FILES)
      await page.getByRole('button', { name: /Comprimir/ }).click()
      await page.waitForFunction(
        () => !(document.body.textContent ?? '').includes('Comprimiendo'),
        undefined,
        { timeout: 120_000 },
      )

      // The whole footer, not one element inside it: the count and the saving
      // live in separate lines, and reading only the first one asserts nothing
      // about the number the user came for.
      const summary = (await page.locator('footer').innerText()).replace(/\s+/g, ' ')
      check(
        name,
        'the batch reports what it saved',
        /3 imágenes comprimidas/.test(summary) && /% menos/.test(summary),
        summary,
      )

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30_000 }),
        page.getByRole('button', { name: /Descargar .* en un ZIP/ }).click(),
      ])

      const archive = join(downloads, download.suggestedFilename())
      await download.saveAs(archive)

      const bytes = await readFile(archive)
      // latin1 keeps every byte addressable as a character, which is what
      // scanning for the signatures below needs.
      const raw = bytes.toString('latin1')

      check(name, 'the archive is a ZIP', bytes.subarray(0, 4).toString('hex') === LOCAL_HEADER)
      check(name, 'the archive is complete', raw.includes(END_OF_DIRECTORY))
      check(
        name,
        'one entry per file',
        raw.split(CENTRAL_ENTRY).length - 1 === FILES.length,
        `${raw.split(CENTRAL_ENTRY).length - 1} entries`,
      )
      for (const stem of EXPECTED_IN_ZIP) {
        check(name, `the archive holds ${stem}`, raw.includes(stem))
      }

      check(name, 'nothing threw on the page', errors.length === 0, errors.join('; '))
      check(
        name,
        'no byte left the device',
        foreign.length === 0,
        foreign.length === 0 ? '' : foreign.join(', '),
      )
    } finally {
      await browser.close()
      await rm(downloads, { recursive: true, force: true })
    }
  }
} finally {
  await server.close()
}

if (failed) process.exitCode = 1
