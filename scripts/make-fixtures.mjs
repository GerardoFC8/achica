/**
 * Generates the deterministic half of the fixture corpus.
 *
 * Why generate instead of collecting: an orientation test needs to assert
 * exactly where each pixel ended up, and a real photograph cannot give you
 * that. These images are 64x32 with four flat quadrants, so after applying an
 * orientation the corner colours and the aspect ratio say precisely which
 * transform ran. The vendored camera photos in test/fixtures/vendor cover the
 * opposite risk: that we only ever test against our own assumptions.
 *
 * Chromium is the encoder because the system has no image tooling and
 * Playwright is already a dev dependency. It emits a plain baseline JFIF with
 * no EXIF, which is exactly the blank slate this script needs.
 *
 * Run: node scripts/make-fixtures.mjs
 *      node scripts/make-fixtures.mjs --animations   (only the animated files; needs ffmpeg)
 * Outputs are committed, so this only needs re-running when the corpus changes.
 */

import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'generated')

const QUADRANTS = [
  { color: '#ff0000', x: 0, y: 0 }, // top-left     red
  { color: '#00ff00', x: 32, y: 0 }, // top-right    green
  { color: '#0000ff', x: 0, y: 16 }, // bottom-left  blue
  { color: '#ffffff', x: 32, y: 16 }, // bottom-right white
]

/**
 * Builds an EXIF APP1 segment carrying nothing but the Orientation tag.
 *
 * Layout: "Exif\0\0", then a little-endian TIFF header, then an IFD holding a
 * single SHORT entry (tag 0x0112). Keeping it to one tag makes the fixture
 * unambiguous — if orientation handling misbehaves, there is nothing else in
 * the file to blame.
 */
function exifOrientationSegment(orientation) {
  const tiff = Buffer.alloc(8 + 2 + 12 + 4)
  let at = 0

  tiff.write('II', at, 'latin1') // little-endian byte order
  at += 2
  tiff.writeUInt16LE(42, at) // TIFF magic
  at += 2
  tiff.writeUInt32LE(8, at) // offset of IFD0, relative to the TIFF header
  at += 4

  tiff.writeUInt16LE(1, at) // one directory entry
  at += 2
  tiff.writeUInt16LE(0x0112, at) // tag: Orientation
  at += 2
  tiff.writeUInt16LE(3, at) // type: SHORT
  at += 2
  tiff.writeUInt32LE(1, at) // count
  at += 4
  tiff.writeUInt16LE(orientation, at) // value, inlined because it fits in 4 bytes
  at += 4

  tiff.writeUInt32LE(0, at) // no IFD1

  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])
  const header = Buffer.alloc(4)
  header.writeUInt16BE(0xffe1, 0) // APP1 marker
  header.writeUInt16BE(payload.length + 2, 2) // length includes itself

  return Buffer.concat([header, payload])
}

/**
 * Inserts the segment after SOI, and after APP0 when the encoder wrote one.
 * JFIF wants APP0 first, so slotting EXIF in behind it keeps the file valid
 * for strict readers instead of merely working for tolerant ones.
 */
function insertExif(jpeg, segment) {
  let at = 2 // past SOI

  if (jpeg[at] === 0xff && jpeg[at + 1] === 0xe0) {
    at += 2 + jpeg.readUInt16BE(at + 2)
  }

  return Buffer.concat([jpeg.subarray(0, at), segment, jpeg.subarray(at)])
}

/**
 * Builds an ISO-BMFF `ftyp` box: the first thing in an AVIF, HEIC or MP4.
 *
 * Layout: size, the literal "ftyp", a major brand, a minor version, then any
 * number of compatible brands. Detection only ever reads this box, so a
 * header alone is enough to test it — and it lets us build the awkward cases
 * on purpose rather than hoping a downloaded sample happens to contain them.
 */
function ftypBox(majorBrand, compatibleBrands) {
  const size = 16 + compatibleBrands.length * 4
  const box = Buffer.alloc(size)

  box.writeUInt32BE(size, 0)
  box.write('ftyp', 4, 'latin1')
  box.write(majorBrand, 8, 'latin1')
  box.writeUInt32BE(0, 12) // minor version
  compatibleBrands.forEach((brand, index) => box.write(brand, 16 + index * 4, 'latin1'))

  return box
}

async function encodeWebp(page, quadrants) {
  const bytes = await page.evaluate(async (quads) => {
    const canvas = new OffscreenCanvas(64, 32)
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('2d context unavailable')

    for (const quadrant of quads) {
      context.fillStyle = quadrant.color
      context.fillRect(quadrant.x, quadrant.y, 32, 16)
    }

    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 })
    // Chromium silently returns PNG for formats it cannot encode, so the
    // resulting type is checked rather than assumed. AVIF fails this way.
    if (blob.type !== 'image/webp') throw new Error(`expected webp, got ${blob.type}`)
    return [...new Uint8Array(await blob.arrayBuffer())]
  }, quadrants)

  return Buffer.from(bytes)
}

async function encodeBaseJpeg(page, quadrants) {
  const bytes = await page.evaluate(async (quads) => {
    const canvas = new OffscreenCanvas(64, 32)
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('2d context unavailable')

    for (const quadrant of quads) {
      context.fillStyle = quadrant.color
      context.fillRect(quadrant.x, quadrant.y, 32, 16)
    }

    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 })
    return [...new Uint8Array(await blob.arrayBuffer())]
  }, quadrants)

  return Buffer.from(bytes)
}

/**
 * Animated fixtures, made with ffmpeg (a system tool, not an npm dependency;
 * no test calls it, the outputs are committed).
 *
 * ffmpeg is also the independent oracle. For every opaque file the script
 * decodes the result again with ffmpeg and records, per frame, the SHA-256 of
 * the RGB24 bytes and the delay in milliseconds in `<name>.expected.json`. The
 * browser tests then require that ImageDecoder, through decodeAnimation,
 * yields the same bytes. Opaque on purpose: with alpha, two correct decoders
 * may differ by a rounding step, and the transparent fixture is checked with a
 * tolerance instead.
 *
 * Small on purpose (about 100 px, 8 to 12 frames): the point is exact
 * bytes, not realism.
 */
function ffmpeg(args) {
  const run = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' })
  if (run.status !== 0) throw new Error(`ffmpeg ${args.join(' ')} failed: ${run.stderr}`)
  return run.stdout
}

/** Per-frame SHA-256 of RGB24 and delay in ms, as ffmpeg itself decodes the file. */
function expectedFrames(file) {
  const out = ffmpeg(['-i', file, '-f', 'framehash', '-hash', 'sha256', '-pix_fmt', 'rgb24', '-'])
  const lines = out.split(/\r?\n/)
  const [num, den] = (lines.find((line) => line.startsWith('#tb 0:')) ?? '')
    .replace('#tb 0:', '')
    .trim()
    .split('/')
    .map(Number)
  const size = (lines.find((line) => line.startsWith('#dimensions 0:')) ?? '')
    .replace('#dimensions 0:', '')
    .trim()
    .split('x')
    .map(Number)
  const frames = lines
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const [, , , duration, , hash] = line.split(',').map((part) => part.trim())
      return { sha256: hash, delayMs: Math.round((Number(duration) * 1000 * num) / den) }
    })
  return { width: size[0], height: size[1], frames }
}

async function makeAnimations() {
  const written = []
  const note = (name, extra = '') => written.push(`${name}${extra}`)
  const out = (name) => join(OUT, name)
  const source = (size, rate, seconds) => [
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=${size}:rate=${rate}:duration=${seconds}`,
  ]

  ffmpeg([...source('96x96', 10, 1.2), '-f', 'gif', out('anim-opaque.gif')])
  ffmpeg([...source('160x90', 10, 1), '-f', 'gif', out('anim-wide.gif')])
  ffmpeg([...source('96x96', 10, 0.8), '-plays', '0', '-f', 'apng', out('anim.apng')])
  // Lossless, so the decoded RGB is exact and comparable byte for byte.
  ffmpeg([
    ...source('96x96', 10, 0.8),
    '-lossless',
    '1',
    '-loop',
    '0',
    '-f',
    'webp',
    out('anim.webp'),
  ])

  // A circle of colour on a transparent background.
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    "testsrc2=size=96x96:rate=10:duration=1.2,format=gbrap,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(hypot(X-48,Y-48),40),255,0)'",
    '-vf',
    'split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse',
    '-f',
    'gif',
    out('anim-transparent.gif'),
  ])

  // Different delay on every frame: 40, 100, 60, 200 ms, repeated.
  const temp = await mkdtemp(join(tmpdir(), 'achica-anim-'))
  try {
    ffmpeg([...source('96x96', 10, 1), join(temp, 'f%02d.png')])
    const delays = [0.04, 0.1, 0.06, 0.2]
    const lines = []
    for (let frame = 1; frame <= 10; frame += 1) {
      lines.push(`file 'f${String(frame).padStart(2, '0')}.png'`)
      lines.push(`duration ${delays[(frame - 1) % delays.length]}`)
    }
    lines.push("file 'f10.png'")
    await writeFile(join(temp, 'list.txt'), lines.join('\n'))
    ffmpeg([
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      join(temp, 'list.txt'),
      '-fps_mode',
      'vfr',
      '-f',
      'gif',
      out('anim-delays.gif'),
    ])
  } finally {
    await rm(temp, { recursive: true, force: true })
  }

  // The two "not animated" cases: one frame in a GIF, and a plain PNG.
  ffmpeg([...source('96x96', 10, 1), '-frames:v', '1', '-f', 'gif', out('single-frame.gif')])
  ffmpeg([...source('96x96', 10, 1), '-frames:v', '1', '-f', 'image2', out('static.png')])

  for (const name of [
    'anim-opaque.gif',
    'anim-wide.gif',
    'anim.apng',
    'anim.webp',
    'anim-delays.gif',
  ]) {
    const expected = expectedFrames(out(name))
    await writeFile(out(`${name}.expected.json`), `${JSON.stringify(expected, null, 2)}\n`)
    note(name, ` + expected.json (${expected.frames.length} frames)`)
  }
  note('anim-transparent.gif')
  note('single-frame.gif')
  note('static.png')

  console.log(`Wrote ${written.length} animated fixtures to test/fixtures/generated:`)
  for (const entry of written) console.log(`  ${entry}`)
}

async function main() {
  await mkdir(OUT, { recursive: true })

  if (process.argv.includes('--animations')) {
    await makeAnimations()
    return
  }

  await mkdir(join(OUT, 'headers'), { recursive: true })

  const browser = await chromium.launch()
  const page = await browser.newPage()
  const base = await encodeBaseJpeg(page, QUADRANTS)
  const webp = await encodeWebp(page, QUADRANTS)
  await browser.close()

  const written = []
  const write = async (name, data) => {
    await writeFile(join(OUT, name), data)
    written.push(`${name} (${data.length} B)`)
  }

  // Control: identical pixels, no EXIF at all. Nothing should be rotated.
  await write('no-exif.jpg', base)

  for (let orientation = 1; orientation <= 8; orientation += 1) {
    await write(
      `orientation-${orientation}.jpg`,
      insertExif(base, exifOrientationSegment(orientation)),
    )
  }

  // Valid header, scan data cut short. Fails during decode rather than at the
  // first byte, which is the harder error path to get right.
  await write('truncated.jpg', base.subarray(0, Math.floor(base.length / 2)))

  await write('empty.jpg', Buffer.alloc(0))

  // A PNG wearing a .jpg extension. The spec requires detecting the real type
  // by magic number, and this is the case that catches anyone trusting the
  // filename: a common, entirely innocent user mistake.
  await copyFile(
    join(OUT, '..', 'vendor', 'pngsuite', 'basn6a08.png'),
    join(OUT, 'png-with-jpg-extension.jpg'),
  )
  written.push('png-with-jpg-extension.jpg (copied from vendor/pngsuite/basn6a08.png)')

  await write('sample.webp', webp)

  /*
   * Container headers, for format detection only. These are not decodable
   * images and the .bin extension says so — which also means no test can
   * accidentally lean on the extension while checking that detection ignores
   * extensions.
   *
   * The brand lists are the point. `mif1` appears in AVIF files as well as
   * HEIF ones, so a detector that checks it before the AVIF brands will call
   * an AVIF a HEIC. And a real HEIF can carry `mif1` as its major brand with
   * `heic` only in the compatible list, so reading the major brand alone
   * misses it. Both traps are represented here.
   */
  const headers = [
    ['avif.bin', ftypBox('avif', ['avif', 'mif1', 'miaf'])],
    ['heic.bin', ftypBox('heic', ['heic', 'mif1'])],
    ['heif-mif1-major.bin', ftypBox('mif1', ['mif1', 'heic'])],
    ['mp4.bin', ftypBox('isom', ['isom', 'iso2', 'avc1', 'mp41'])],
    ['gif.bin', Buffer.from('GIF89a', 'latin1')],
  ]

  for (const [name, data] of headers) {
    await writeFile(join(OUT, 'headers', name), data)
    written.push(`headers/${name} (${data.length} B)`)
  }

  await makeAnimations()

  console.log(`Wrote ${written.length} fixtures to test/fixtures/generated:`)
  for (const entry of written) console.log(`  ${entry}`)
}

await main()
