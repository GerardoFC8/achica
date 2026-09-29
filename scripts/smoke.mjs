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
 * Two batches per browser, because the product has two paths through it. The
 * default destination converts to WebP; the others keep the format, and a PNG
 * kept as PNG is packed by oxipng (D50). Running only the default would ship
 * the second path without it ever touching the build (D51).
 *
 * The folder save is not here and cannot be: showDirectoryPicker needs a user
 * gesture and opens a native dialog no automation can drive. It is covered by
 * fakes in src/output/save.browser-test.ts and verified by hand.
 *
 * Given a URL it tests that instead, which is how a deploy gets checked
 * against the real host: `node scripts/smoke.mjs https://achica.gfcode.dev`.
 * There it also lists any same-origin request the page did not make itself —
 * the edge injects its own, and naming them is the point of the audit.
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

/*
 * Full names in `expected`, not stems: the extension that comes out is what
 * each destination promises, so it is what gets checked.
 */
const BATCHES = [
  {
    label: 'default destination, converted to WebP',
    destination: null,
    files: [
      fixture('vendor/exif-orientation/Landscape_6.jpg'),
      fixture('generated/no-exif.jpg'),
      fixture('generated/sample.webp'),
    ],
    expected: ['Landscape_6.webp', 'no-exif.webp', 'sample.webp'],
    oxipng: false,
  },
  {
    label: 'a destination that keeps the format',
    destination: /Adjunto de correo/,
    files: [fixture('generated/no-exif.jpg'), fixture('vendor/pngsuite/basn6a08.png')],
    expected: ['no-exif.jpg', 'basn6a08.png'],
    oxipng: true,
  },
]

const LOCAL_HEADER = '504b0304'
const CENTRAL_ENTRY = 'PK\x01\x02'
const END_OF_DIRECTORY = 'PK\x05\x06'

const target = process.argv[2]

if (target === undefined) {
  try {
    await stat(join(ROOT, 'dist', 'index.html'))
  } catch {
    console.error('No dist/ to test. Run npm run build first.')
    process.exit(1)
  }
}

const server =
  target === undefined ? await preview({ logLevel: 'error', preview: { port: 0 } }) : null
const base = target ?? server?.resolvedUrls?.local?.[0]
if (base === undefined) throw new Error('vite preview did not report a local url')

console.log(`Testing ${base}`)

const origin = new URL(base).origin
let failed = false

const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail === '' ? '' : ` — ${detail}`}`)
  if (!ok) failed = true
}

/** One batch on a fresh page, so each network audit starts from the first byte. */
async function runBatch(browser, batch, downloads) {
  const page = await browser.newPage({ acceptDownloads: true })

  try {
    /*
     * Every request the page makes, from the first byte. A blob: or data:
     * URL never touches the network, so only real schemes are recorded.
     */
    const foreign = []
    /** Same-origin requests nothing in our bundle asks for: the edge's own. */
    const injected = []
    /*
     * The oxipng wasm the page fetched. Both builds, single and multithreaded,
     * ship under the same name, so this proves oxipng ran — not which build.
     */
    const oxipng = []
    page.on('request', (request) => {
      const url = request.url()
      if (!/^https?:/.test(url)) return
      if (url.includes('oxipng')) oxipng.push(url)
      if (!url.startsWith(origin)) foreign.push(url)
      else if (url.includes('/cdn-cgi/')) injected.push(url)
    })

    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))

    await page.goto(base)
    check(
      'the work surface is the first screen',
      await page.getByText('Arrastra tus imágenes aquí').isVisible(),
    )

    const isolated = await page.evaluate(() => globalThis.crossOriginIsolated)
    check('cross-origin isolated', isolated === true)

    if (batch.destination !== null) {
      await page.getByRole('button', { name: /^Destino/ }).click()
      await page.getByRole('button', { name: batch.destination }).click()
      check(
        'the destination switches',
        await page
          .getByRole('button', { name: new RegExp(`^Destino.*${batch.destination.source}`) })
          .isVisible(),
      )
    }

    await page.setInputFiles('input[type=file]', batch.files)
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
      'the batch reports what it saved',
      summary.includes(`${batch.files.length} imágenes comprimidas`) && /% menos/.test(summary),
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

    check('the archive is a ZIP', bytes.subarray(0, 4).toString('hex') === LOCAL_HEADER)
    check('the archive is complete', raw.includes(END_OF_DIRECTORY))
    check(
      'one entry per file',
      raw.split(CENTRAL_ENTRY).length - 1 === batch.files.length,
      `${raw.split(CENTRAL_ENTRY).length - 1} entries`,
    )
    for (const entry of batch.expected) {
      check(`the archive holds ${entry}`, raw.includes(entry))
    }

    check(
      batch.oxipng ? 'the PNG went through oxipng' : 'oxipng stayed unloaded',
      oxipng.length > 0 === batch.oxipng,
      oxipng.join(', '),
    )
    check('nothing threw on the page', errors.length === 0, errors.join('; '))
    check(
      'no byte left the device',
      foreign.length === 0,
      foreign.length === 0 ? '' : foreign.join(', '),
    )

    if (injected.length > 0) {
      // Not a failure: same origin, no image data, and gone the moment the
      // project is self-hosted. Named rather than hidden.
      console.log(`  note the host injected ${injected.length} request(s): ${injected.join(', ')}`)
    }
  } finally {
    await page.close()
  }
}

try {
  for (const [name, engine] of [
    ['chromium', chromium],
    ['firefox', firefox],
  ]) {
    const downloads = await mkdtemp(join(tmpdir(), 'achica-smoke-'))
    const browser = await engine.launch()

    try {
      for (const batch of BATCHES) {
        console.log(`\n${name}: ${batch.label}`)
        await runBatch(browser, batch, downloads)
      }
    } finally {
      await browser.close()
      await rm(downloads, { recursive: true, force: true })
    }
  }
} finally {
  await server?.close()
}

if (failed) process.exitCode = 1
