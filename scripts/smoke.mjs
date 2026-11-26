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
 * Several batches per browser, because the product has several paths through
 * it. The compressor's default destination converts to WebP; the others keep
 * the format, and a PNG kept as PNG is packed by oxipng (D50). Running only the
 * default would ship the second path without it ever touching the build (D51).
 * The resize and convert tools each get their own page and their own batches,
 * and those read the result back out of the ZIP: the dimensions of every
 * image, and the signature of every converted file.
 *
 * Before any browser, the page is read from Node with no JavaScript at all:
 * that is what a crawler or a link preview gets, and it has to carry the
 * title, the first screen and the preview image on its own (D52).
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
import { inflateRawSync } from 'node:zlib'
import { chromium, firefox } from 'playwright'
import { preview } from 'vite'
import { listPages, urlForPath } from '../src/tools/pages.ts'
import { REGISTRY } from '../src/tools/registry.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = (path) => join(ROOT, 'test', 'fixtures', path)

/**
 * What is inside a ZIP, read from its central directory with Node's own zlib:
 * no dependency, and no trust in the local headers, which a streaming writer
 * may leave without sizes.
 */
function readZip(bytes) {
  const end = bytes.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'))
  if (end < 0) throw new Error('no end-of-directory record')

  const count = bytes.readUInt16LE(end + 10)
  let at = bytes.readUInt32LE(end + 16)
  const entries = []

  for (let i = 0; i < count; i++) {
    const method = bytes.readUInt16LE(at + 10)
    const size = bytes.readUInt32LE(at + 20)
    const nameLength = bytes.readUInt16LE(at + 28)
    const extraLength = bytes.readUInt16LE(at + 30)
    const commentLength = bytes.readUInt16LE(at + 32)
    const local = bytes.readUInt32LE(at + 42)
    const name = bytes.toString('utf8', at + 46, at + 46 + nameLength)

    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28)
    const raw = bytes.subarray(start, start + size)
    entries.push({ name, data: method === 0 ? raw : inflateRawSync(raw) })

    at += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/** Width and height from a PNG's IHDR, or from a JPEG's first SOF marker. */
function dimensionsOf(data) {
  if (data.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
  }
  if (data[0] === 0xff && data[1] === 0xd8) {
    let at = 2
    while (at + 9 < data.length) {
      if (data[at] !== 0xff) throw new Error('lost the JPEG marker stream')
      const marker = data[at + 1]
      // SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC), which are not frames.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: data.readUInt16BE(at + 7), height: data.readUInt16BE(at + 5) }
      }
      at += 2 + data.readUInt16BE(at + 2)
    }
  }
  return null
}

const isJpeg = (data) => data[0] === 0xff && data[1] === 0xd8
const isWebp = (data) =>
  data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP'

/** The entry that came out of a given input, matched by its stem. */
const stemOf = (name) => name.replace(/\.[^.]+$/, '')

/** Every converted file says what it is in its first bytes, not only in its name. */
const verifySignature = (format, test) => (entries, batch) => {
  for (const entry of entries) {
    check(`${entry.name} is really ${format}`, test(entry.data))
  }
  check('one entry per input', entries.length === batch.files.length)
}

/** The resize batch: every image comes out at half its original sides. */
async function verifyHalved(entries, batch) {
  for (const file of batch.files) {
    const stem = stemOf(file.split(/[\\/]/).pop())
    const entry = entries.find((candidate) => stemOf(candidate.name) === stem)
    const before = dimensionsOf(await readFile(file))
    const after = entry === undefined ? null : dimensionsOf(entry.data)

    check(
      `${stem} is half its size`,
      before !== null &&
        after !== null &&
        after.width === Math.round(before.width / 2) &&
        after.height === Math.round(before.height / 2),
      `${before?.width}x${before?.height} -> ${after?.width}x${after?.height}`,
    )
  }
}

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
  {
    // The second language and the weight ceiling, both against the build:
    // the English page has its own entry, and the ceiling its own path
    // through the pipeline (D53, D54).
    label: 'the English page, with a weight ceiling',
    language: 'en',
    destination: /Email attachment/,
    budget: '100 KB',
    files: [fixture('vendor/exif-orientation/Landscape_6.jpg'), fixture('generated/no-exif.jpg')],
    expected: ['Landscape_6.jpg', 'no-exif.jpg'],
    oxipng: false,
  },
  {
    // Fixtures with even sides and no EXIF rotation, so half is exact and the
    // header's width and height are the ones the user sees.
    label: 'resize, in Spanish, at the default 50 %',
    tool: 'redimensionar',
    language: 'es',
    files: [
      fixture('generated/no-exif.jpg'),
      fixture('vendor/pngsuite/basn6a08.png'),
      fixture('vendor/pngsuite/basi2c08.png'),
    ],
    expected: ['no-exif.jpg', 'basn6a08.png', 'basi2c08.png'],
    oxipng: true,
    verify: verifyHalved,
  },
  {
    label: 'convert, in English, to the default WebP',
    tool: 'convertir',
    language: 'en',
    files: [
      fixture('vendor/exif-orientation/Landscape_6.jpg'),
      fixture('generated/no-exif.jpg'),
      fixture('vendor/pngsuite/basn6a08.png'),
    ],
    expected: ['Landscape_6.webp', 'no-exif.webp', 'basn6a08.webp'],
    oxipng: false,
    verify: verifySignature('WebP', isWebp),
  },
  {
    // A PNG with an alpha channel is the case that matters: JPEG has none, so
    // the pipeline composes it over white (it must not fail or go black).
    label: 'convert, in Spanish, to JPEG, with a transparent PNG',
    tool: 'convertir',
    language: 'es',
    format: /^JPEG/,
    files: [fixture('vendor/pngsuite/basn6a08.png'), fixture('vendor/pngsuite/basi2c08.png')],
    expected: ['basn6a08.jpg', 'basi2c08.jpg'],
    oxipng: false,
    verify: verifySignature('JPEG', isJpeg),
  },
]

/**
 * What each page says, so the same run reads both languages and every tool.
 * The route of each page comes from the registry (D57), not from here: `pathOf`
 * below.
 *
 * `saved` is the compressor's alone: it is the only tool whose totals promise a
 * saving, and a converted PNG may legitimately weigh more.
 */
const WORDS = {
  es: {
    destination: /^Destino/,
    zip: /Descargar .* en un ZIP/,
    comprimir: {
      title: /comprimir/i,
      heading: /imágenes que quieres comprimir/,
      start: /Comprimir/,
      busy: 'Comprimiendo',
      finished: (count) => `${count} imágenes comprimidas`,
      saved: /% menos/,
    },
    redimensionar: {
      title: /redimensionar/i,
      heading: /imágenes que quieres redimensionar/,
      start: /Redimensionar/,
      busy: 'Redimensionando',
      finished: (count) => `${count} imágenes redimensionadas`,
    },
    convertir: {
      title: /convertir/i,
      heading: /imágenes que quieres convertir/,
      start: /Convertir/,
      busy: 'Convirtiendo',
      finished: (count) => `${count} imágenes convertidas`,
    },
  },
  en: {
    destination: /^Destination/,
    zip: /Download .* as a ZIP/,
    comprimir: {
      title: /compress/i,
      heading: /images you want to compress/,
      start: /Compress/,
      busy: 'Compressing',
      finished: (count) => `${count} images compressed`,
      saved: /% smaller/,
    },
    redimensionar: {
      title: /resize/i,
      heading: /images you want to resize/,
      start: /Resize/,
      busy: 'Resizing',
      finished: (count) => `${count} images resized`,
    },
    convertir: {
      title: /convert/i,
      heading: /images you want to convert/,
      start: /Convert/,
      busy: 'Converting',
      finished: (count) => `${count} images converted`,
    },
  },
}

/** A tool's route in a language, from the registry. */
const pathOf = (language, toolId = 'comprimir') => {
  const locale = REGISTRY.tools.find((tool) => tool.id === toolId)?.locales[language]
  if (locale === undefined) throw new Error(`the registry has no ${toolId} in ${language}`)
  return locale.path
}

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

    const language = batch.language ?? 'es'
    const toolId = batch.tool ?? 'comprimir'
    const common = WORDS[language]
    const words = { ...common, ...common[toolId] }

    await page.goto(new URL(pathOf(language, toolId), base).href)
    check(
      'the work surface is the first screen',
      await page.getByRole('heading', { level: 1, name: words.heading }).isVisible(),
    )

    const isolated = await page.evaluate(() => globalThis.crossOriginIsolated)
    check('cross-origin isolated', isolated === true)

    if (batch.destination) {
      await page.getByRole('button', { name: words.destination }).click()
      await page.getByRole('button', { name: batch.destination }).click()
      check(
        'the destination switches',
        await page
          .getByRole('button', {
            name: new RegExp(`${words.destination.source}.*${batch.destination.source}`),
          })
          .isVisible(),
      )
    }

    if (batch.format !== undefined) {
      // The converter's picker: its options are the formats themselves.
      await page.getByRole('button', { name: words.destination }).click()
      await page.getByRole('button', { name: batch.format }).click()
      check(
        'the format switches',
        await page
          .getByRole('button', {
            name: new RegExp(`${words.destination.source}.*${batch.format.source.slice(1)}`),
          })
          .isVisible(),
      )
    }

    if (batch.budget !== undefined) {
      await page.getByRole('button', { name: words.destination }).click()
      await page.getByRole('button', { name: batch.budget, exact: true }).click()
      await page.keyboard.press('Escape')
      check(
        'the ceiling is set',
        await page
          .getByRole('button', { name: new RegExp(`${words.destination.source}.*${batch.budget}`) })
          .isVisible(),
      )
    }

    await page.setInputFiles('input[type=file]', batch.files)
    await page.getByRole('button', { name: words.start }).click()
    await page.waitForFunction(
      (busy) => !(document.body.textContent ?? '').includes(busy),
      words.busy,
      { timeout: 120_000 },
    )

    // The whole footer, not one element inside it: the count and the saving
    // live in separate lines, and reading only the first one asserts nothing
    // about the number the user came for.
    const summary = (await page.locator('footer').innerText()).replace(/\s+/g, ' ')
    check(
      words.saved === undefined
        ? 'the batch reports what it did'
        : 'the batch reports what it saved',
      summary.includes(words.finished(batch.files.length)) &&
        (words.saved === undefined || words.saved.test(summary)),
      summary,
    )

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.getByRole('button', { name: words.zip }).click(),
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

    if (batch.verify !== undefined) await batch.verify(readZip(bytes), batch)

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

/**
 * What a reader that never runs JavaScript gets: a crawler, or the bot behind
 * a link preview. Fetched from Node and not from a browser on purpose, because
 * a browser would run the script and hide an empty page behind the live one.
 */
async function runDiscoverability() {
  for (const [language, all] of Object.entries(WORDS)) {
    const words = all.comprimir
    const path = pathOf(language)
    console.log(`\nwithout JavaScript, ${path}: what crawlers and link previews read`)

    const response = await fetch(new URL(path, base))
    const html = await response.text()
    // Attribute by attribute, because a formatter is free to break a tag across
    // lines and to put its attributes in any order.
    const meta = (attribute, name) =>
      [...html.matchAll(/<meta\s([^>]*)>/g)]
        .map(([, attributes]) => attributes)
        .find((attributes) => attributes.includes(`${attribute}="${name}"`))
        ?.match(/content="([^"]*)"/)?.[1]

    check('the page answers', response.ok, `${response.status}`)
    check('the page says its language', html.includes(`<html lang="${language}">`))
    check(
      'the title names the task',
      words.title.test(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? ''),
    )
    check('there is a description', (meta('name', 'description') ?? '').length > 50)
    check(
      'the first screen is in the HTML, not only in the script',
      new RegExp(`<h1[^>]*>[^<]*${words.heading.source}[^<]*</h1>`).test(html),
    )
    check(
      'it points to its other-language twin',
      /hreflang="es"/.test(html) && /hreflang="en"/.test(html),
    )

    const jsonLd = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1]
    let parsed = null
    try {
      parsed = JSON.parse(jsonLd ?? '')
    } catch {
      // Reported by the check below.
    }
    check('the structured data parses', parsed?.['@type'] === 'WebApplication')

    // The preview image is an absolute URL to the live host, so it is checked
    // by its path against the origin under test.
    const image = meta('property', 'og:image')
    check('there is a preview image', image !== undefined)
    if (image !== undefined) {
      const asset = await fetch(new URL(new URL(image).pathname, base))
      check(`${new URL(image).pathname} is served`, asset.ok, `${asset.status}`)
    }
  }

  console.log('\nwhat every page shares')
  for (const path of ['/favicon.svg', '/apple-touch-icon.png', '/robots.txt', '/sitemap.xml']) {
    const asset = await fetch(new URL(path, base))
    check(`${path} is served`, asset.ok, `${asset.status}`)
  }
}

/**
 * Every page the registry lists, read from Node with no JavaScript (D57): its
 * language, its twins and its canonical, and the sitemap that has to list them
 * all. The deep checks above cover the compressor; this one is what stops a
 * new tool from shipping a page that crawlers cannot place.
 */
async function runRegistryPages() {
  console.log('\nevery page of the registry')

  for (const { tool, language, locale } of listPages(REGISTRY)) {
    const response = await fetch(new URL(locale.path, base))
    const html = await response.text()
    const label = `${tool.id} ${language} ${locale.path}`

    check(`${label} answers`, response.ok, `${response.status}`)
    check(`${label} says its language`, html.includes(`<html lang="${language}">`))
    check(`${label} declares its tool`, html.includes(`<body data-tool="${tool.id}">`))
    for (const other of REGISTRY.languages) {
      const href = urlForPath(REGISTRY, tool.locales[other].path)
      check(
        `${label} points to its ${other} twin`,
        html.includes(`hreflang="${other}"`) && html.includes(`href="${href}"`),
      )
    }
    check(
      `${label} is its own canonical`,
      html.includes(`rel="canonical"`) &&
        html.includes(`href="${urlForPath(REGISTRY, locale.path)}"`),
    )
  }

  const sitemap = await (await fetch(new URL('/sitemap.xml', base))).text()
  for (const { tool, language, locale } of listPages(REGISTRY)) {
    check(
      `sitemap.xml lists ${tool.id} ${language}`,
      sitemap.includes(`<loc>${urlForPath(REGISTRY, locale.path)}</loc>`),
    )
  }
}

try {
  await runDiscoverability()
  await runRegistryPages()

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
