import { describe, expect, it } from 'vitest'
import {
  ascii,
  cat,
  dirtyJpeg,
  dirtyPng,
  dirtyWebp,
  equalBytes,
  jpegSegment,
  pngWithOrientation,
  webpWithOrientation,
} from '../../../test/helpers/metadata-builders'
import { stripMetadata } from './index'

/**
 * B. The pixels a browser paints do not change.
 *
 * The decoder here is the browser's own, the one real viewers use, so what is
 * compared is what a person would see. Orientation handling in PNG and WebP is
 * not assumed: each test measures what Chromium does with it and records it.
 */

const FIXTURE_URLS = import.meta.glob('../../../test/fixtures/**/*.{jpg,png,webp}', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

async function load(name: string): Promise<Uint8Array<ArrayBuffer>> {
  const key = Object.keys(FIXTURE_URLS).find((path) => path.endsWith(`/${name}`))
  const url = key === undefined ? undefined : FIXTURE_URLS[key]
  if (url === undefined) throw new Error(`fixture not found: ${name}`)
  return new Uint8Array(await (await fetch(url)).arrayBuffer())
}

type Pixels = { readonly width: number; readonly height: number; readonly data: Uint8ClampedArray }

async function pixelsOf(
  bytes: Uint8Array<ArrayBuffer>,
  type: string,
  imageOrientation: 'from-image' | 'none' = 'from-image',
): Promise<Pixels> {
  const bitmap = await createImageBitmap(new Blob([bytes], { type }), { imageOrientation })
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('2d context unavailable')
  context.drawImage(bitmap, 0, 0)
  const { width, height } = bitmap
  bitmap.close()
  return { width, height, data: context.getImageData(0, 0, width, height).data }
}

function expectSamePixels(actual: Pixels, expected: Pixels): void {
  expect([actual.width, actual.height]).toEqual([expected.width, expected.height])
  expect(actual.data.length).toBe(expected.data.length)
  let different = 0
  for (let index = 0; index < actual.data.length; index += 1) {
    if (actual.data[index] !== expected.data[index]) different += 1
  }
  expect(different).toBe(0)
}

const cornerOf = (pixels: Pixels, x: number, y: number): string => {
  const at = (y * pixels.width + x) * 4
  const [r, g, b] = [pixels.data[at] ?? 0, pixels.data[at + 1] ?? 0, pixels.data[at + 2] ?? 0]
  if (r > 200 && g < 60 && b < 60) return 'red'
  if (g > 200 && r < 60 && b < 60) return 'green'
  if (b > 200 && r < 60 && g < 60) return 'blue'
  if (r > 200 && g > 200 && b > 200) return 'white'
  return `${r},${g},${b}`
}

/** Top-left, top-right, bottom-left, bottom-right colours, to read a transform off. */
const corners = (pixels: Pixels): string =>
  [
    cornerOf(pixels, 1, 1),
    cornerOf(pixels, pixels.width - 2, 1),
    cornerOf(pixels, 1, pixels.height - 2),
    cornerOf(pixels, pixels.width - 2, pixels.height - 2),
  ].join('/')

function stripped(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const result = stripMetadata(bytes)
  if (!result.ok) throw new Error(`strip failed: ${JSON.stringify(result.error)}`)
  return result.value.bytes
}

/** 64x32 with the four flat quadrants the fixtures use, written by the browser as PNG. */
async function quadrantPng(): Promise<Uint8Array<ArrayBuffer>> {
  const canvas = new OffscreenCanvas(64, 32)
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('2d context unavailable')
  const quadrants: [string, number, number][] = [
    ['#ff0000', 0, 0],
    ['#00ff00', 32, 0],
    ['#0000ff', 0, 16],
    ['#ffffff', 32, 16],
  ]
  for (const [color, x, y] of quadrants) {
    context.fillStyle = color
    context.fillRect(x, y, 32, 16)
  }
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

describe('JPEG: identical pixels for all eight orientations', () => {
  for (let orientation = 1; orientation <= 8; orientation += 1) {
    it(`orientation ${orientation}: a dirty copy and the fixture itself decode like the original`, async () => {
      const original = await load(`orientation-${orientation}.jpg`)
      const clean = await load('no-exif.jpg')
      const expected = await pixelsOf(original, 'image/jpeg')

      // The fixture stripped (orientation kept, so the file is unchanged).
      expectSamePixels(await pixelsOf(stripped(original), 'image/jpeg'), expected)
      // A heavily polluted copy of the same picture and orientation.
      const dirty = dirtyJpeg(clean, { orientation })
      expectSamePixels(await pixelsOf(stripped(dirty), 'image/jpeg'), expected)
    })
  }

  it('a real camera photo decodes identically after stripping, orientation included', async () => {
    for (const name of ['Landscape_6.jpg', 'Portrait_6.jpg']) {
      const original = await load(name)
      const out = stripped(original)
      expect(out.length).toBeLessThan(original.length)
      expectSamePixels(await pixelsOf(out, 'image/jpeg'), await pixelsOf(original, 'image/jpeg'))
    }
  })

  it('a progressive JPEG (several scans) with a comment and a tail comes back as the clean file', async () => {
    const { default: encode } = await import('@jsquash/jpeg/encode')
    const image = new ImageData(64, 32)
    for (let y = 0; y < 32; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        const at = (y * 64 + x) * 4
        image.data[at] = x * 4
        image.data[at + 1] = y * 8
        image.data[at + 2] = (x * y) & 255
        image.data[at + 3] = 255
      }
    }
    const progressive = new Uint8Array(await encode(image, { quality: 80, progressive: true }))
    let scans = 0
    for (let at = progressive.indexOf(0xff); at !== -1; at = progressive.indexOf(0xff, at + 1)) {
      if (progressive[at + 1] === 0xda) scans += 1
    }
    expect(scans).toBeGreaterThan(1)

    // Insert a COM right after the SOI and append a tail after the EOI.
    const dirty = cat(
      progressive.subarray(0, 2),
      jpegSegment(0xfe, ascii('SENTINEL_COMMENT')),
      progressive.subarray(2),
      ascii('SENTINEL_TAIL'),
    )
    const out = stripped(dirty)
    expect(equalBytes(out, progressive)).toBe(true)
    expectSamePixels(await pixelsOf(out, 'image/jpeg'), await pixelsOf(progressive, 'image/jpeg'))
  })
})

describe('PNG and WebP orientation, as measured in Chromium', () => {
  it('PNG with eXIf orientation 6: stripping keeps the pixels and the browser behaviour', async () => {
    const plain = await quadrantPng()
    const tagged = pngWithOrientation(plain, 6)
    const dirty = dirtyPng(tagged, { orientation: 6 })
    const out = stripped(dirty)

    const fromTagged = await pixelsOf(tagged, 'image/png')
    const fromTaggedRaw = await pixelsOf(tagged, 'image/png', 'none')
    const fromPlain = await pixelsOf(plain, 'image/png')

    expectSamePixels(await pixelsOf(out, 'image/png'), fromTagged)
    expect(equalBytes(out, tagged)).toBe(true)

    // Measured, not assumed (Chromium): a PNG eXIf orientation IS applied by the
    // decoder, and createImageBitmap's imageOrientation 'none' does not undo it.
    // 6 means a 90 degree clockwise turn: 64x32 becomes 32x64, same as the JPEG table.
    expect([fromTagged.width, fromTagged.height, corners(fromTagged)]).toEqual([
      32,
      64,
      'blue/red/white/green',
    ])
    expect([fromTaggedRaw.width, fromTaggedRaw.height]).toEqual([32, 64])
    expect([fromPlain.width, fromPlain.height, corners(fromPlain)]).toEqual([
      64,
      32,
      'red/green/blue/white',
    ])
  })

  it('WebP with EXIF orientation 6: stripping keeps the pixels and the browser behaviour', async () => {
    const plain = await load('sample.webp')
    const tagged = webpWithOrientation(plain, 6)
    const dirty = dirtyWebp(plain, { orientation: 6 })
    const out = stripped(dirty)

    const fromTagged = await pixelsOf(tagged, 'image/webp')
    const fromTaggedRaw = await pixelsOf(tagged, 'image/webp', 'none')
    const fromPlain = await pixelsOf(plain, 'image/webp')

    expectSamePixels(await pixelsOf(out, 'image/webp'), fromTagged)
    expect(equalBytes(out, tagged)).toBe(true)

    // Measured, not assumed (Chromium): a WebP EXIF orientation is IGNORED. The
    // picture stays 64x32 with or without the tag. Keeping the minimal block is
    // therefore harmless here, and it is what viewers that do honour the tag need.
    expect([fromTagged.width, fromTagged.height, corners(fromTagged)]).toEqual([
      64,
      32,
      'red/green/blue/white',
    ])
    expect([fromTaggedRaw.width, fromTaggedRaw.height]).toEqual([64, 32])
    expect([fromPlain.width, fromPlain.height]).toEqual([64, 32])
  })

  it('an <img> element agrees: PNG orientation 6 is applied, WebP orientation 6 is not', async () => {
    const png = pngWithOrientation(await quadrantPng(), 6)
    const webp = webpWithOrientation(await load('sample.webp'), 6)
    const measure = async (bytes: Uint8Array<ArrayBuffer>, type: string): Promise<string> => {
      const url = URL.createObjectURL(new Blob([bytes], { type }))
      try {
        const image = new Image()
        image.src = url
        await image.decode()
        return `${image.naturalWidth}x${image.naturalHeight}`
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    // Measured: <img> agrees with createImageBitmap. PNG is rotated, WebP is not.
    expect(await measure(png, 'image/png')).toBe('32x64')
    expect(await measure(webp, 'image/webp')).toBe('64x32')
  })
})
