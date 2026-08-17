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
 * Outputs are committed, so this only needs re-running when the corpus changes.
 */

import { copyFile, mkdir, writeFile } from 'node:fs/promises'
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

async function main() {
  await mkdir(OUT, { recursive: true })

  const browser = await chromium.launch()
  const page = await browser.newPage()
  const base = await encodeBaseJpeg(page, QUADRANTS)
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

  console.log(`Wrote ${written.length} fixtures to test/fixtures/generated:`)
  for (const entry of written) console.log(`  ${entry}`)
}

await main()
