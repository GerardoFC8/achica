/**
 * Phase 4's acceptance evidence: the default save road, end to end, in both
 * browsers.
 *
 * Unit tests cover the archive builder against fakes, but they cannot answer
 * the question that actually matters — does a real browser hand a real file to
 * the operating system, and is what lands on disk an archive anything can
 * open. A ZIP nobody can open is worse than no ZIP.
 *
 * The folder road is not here and cannot be: showDirectoryPicker needs a user
 * gesture and opens a native dialog no automation can drive. It is verified by
 * hand, and by the fakes in src/output/save.browser-test.ts.
 *
 * Run: node scripts/verify-download.mjs
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, firefox } from 'playwright'
import { createServer } from 'vite'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = (path) => join(ROOT, 'test', 'fixtures', path)

const FILES = [
  fixture('vendor/exif-orientation/Landscape_6.jpg'),
  fixture('generated/no-exif.jpg'),
  fixture('generated/sample.webp'),
]

/** Stems the archive must contain, whatever extension the conversion chose. */
const EXPECTED = ['Landscape_6', 'no-exif', 'sample']

const LOCAL_HEADER = '504b0304'
// Counted by splitting rather than by regex: these are control characters,
// and a regex full of them is both unreadable and a lint error.
const CENTRAL_ENTRY = 'PK\x01\x02'
const END_OF_DIRECTORY = 'PK\x05\x06'

const server = await createServer({ logLevel: 'error', server: { port: 0 } })
await server.listen()

const base = server.resolvedUrls?.local?.[0]
if (base === undefined) throw new Error('vite did not report a local url')

let failed = false

try {
  for (const [name, engine] of [
    ['chromium', chromium],
    ['firefox', firefox],
  ]) {
    const downloads = await mkdtemp(join(tmpdir(), 'achica-download-'))
    const browser = await engine.launch()

    try {
      const page = await browser.newPage({ acceptDownloads: true })
      page.on('pageerror', (error) => console.error(`[${name}]`, error.message))

      await page.goto(base)
      await page.setInputFiles('input[type=file]', FILES)
      await page.getByRole('button', { name: /Comprimir/ }).click()
      await page.waitForFunction(
        () => !(document.body.textContent ?? '').includes('Comprimiendo'),
        undefined,
        { timeout: 120_000 },
      )

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30_000 }),
        page.getByRole('button', { name: /Descargar .* en un ZIP/ }).click(),
      ])

      const path = join(downloads, download.suggestedFilename())
      await download.saveAs(path)

      const bytes = await readFile(path)
      // latin1 keeps every byte addressable as a character, which is what the
      // signature scanning below needs.
      const raw = bytes.toString('latin1')

      const checks = [
        ['local file header', bytes.subarray(0, 4).toString('hex') === LOCAL_HEADER],
        ['end of central directory', raw.includes(END_OF_DIRECTORY)],
        ['one entry per file', raw.split(CENTRAL_ENTRY).length - 1 === FILES.length],
        ...EXPECTED.map((stem) => [`contains ${stem}`, raw.includes(stem)]),
      ]

      console.log(`\n${name}: ${download.suggestedFilename()}, ${bytes.length} bytes`)
      for (const [label, ok] of checks) {
        console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`)
        if (!ok) failed = true
      }
    } finally {
      await browser.close()
      await rm(downloads, { recursive: true, force: true })
    }
  }
} finally {
  await server.close()
}

if (failed) process.exitCode = 1
