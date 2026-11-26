import { describe, expect, it } from 'vitest'
import { decodeImage } from './codecs/decode'
import { encodeImage } from './codecs/encode'
import { flattenOnWhite, hasTransparency } from './alpha'
import { processImage } from './pipeline'

/**
 * JPEG has no alpha channel, so a transparent PNG converted to JPEG shows
 * whatever RGB happened to sit under the transparent pixels. Those are usually
 * black, which turns a logo with a see-through background into a black box.
 * These tests run the whole path (PNG bytes in, JPEG bytes out) on pixels built
 * here, so the transparent zone and the opaque zone are known exactly.
 */

const SIZE = 64
const OPAQUE = { r: 200, g: 40, b: 40 }

/** Left half fully transparent over black RGB, right half opaque red. */
function halfTransparent(): ImageData {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const at = (y * SIZE + x) * 4
      if (x >= SIZE / 2) {
        data[at] = OPAQUE.r
        data[at + 1] = OPAQUE.g
        data[at + 2] = OPAQUE.b
        data[at + 3] = 255
      }
    }
  }
  return new ImageData(data, SIZE, SIZE)
}

function pixel(image: ImageData, x: number, y: number): readonly number[] {
  const at = (y * image.width + x) * 4
  return [image.data[at] ?? 0, image.data[at + 1] ?? 0, image.data[at + 2] ?? 0]
}

async function toPngBytes(image: ImageData): Promise<ArrayBuffer> {
  const encoded = await encodeImage('png', image)
  if (!encoded.ok) throw new Error(encoded.error.code)
  return encoded.value.slice().buffer
}

describe('PNG with transparency converted to JPEG', () => {
  it('composes the transparent area on white and keeps the opaque colour', async () => {
    const result = await processImage(await toPngBytes(halfTransparent()), {
      format: 'jpeg',
      quality: 90,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.format).toBe('jpeg')

    const decoded = await decodeImage('jpeg', result.value.output.slice().buffer)
    if (!decoded.ok) throw new Error(decoded.error.code)

    // Sampled well away from the seam, where chroma subsampling bleeds.
    const [tr = 0, tg = 0, tb = 0] = pixel(decoded.value, 8, SIZE / 2)
    for (const channel of [tr, tg, tb]) expect(channel).toBeGreaterThan(245)

    const [or = 0, og = 0, ob = 0] = pixel(decoded.value, SIZE - 8, SIZE / 2)
    expect(Math.abs(or - OPAQUE.r)).toBeLessThan(12)
    expect(Math.abs(og - OPAQUE.g)).toBeLessThan(12)
    expect(Math.abs(ob - OPAQUE.b)).toBeLessThan(12)
  })

  it('keeps the alpha channel when the output is PNG or WebP', async () => {
    for (const format of ['png', 'webp'] as const) {
      const result = await processImage(await toPngBytes(halfTransparent()), {
        format,
        quality: 90,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) continue

      const decoded = await decodeImage(format, result.value.output.slice().buffer)
      if (!decoded.ok) throw new Error(decoded.error.code)

      const at = ((SIZE / 2) * SIZE + 8) * 4
      expect(decoded.value.data[at + 3], format).toBe(0)
    }
  })
})

describe('flattenOnWhite', () => {
  it('returns a new, opaque image of the same size and leaves the source alone', () => {
    const source = halfTransparent()
    const flat = flattenOnWhite(source)

    expect(flat).not.toBe(source)
    expect(flat.width).toBe(SIZE)
    expect(flat.height).toBe(SIZE)
    expect(hasTransparency(flat)).toBe(false)
    expect(hasTransparency(source)).toBe(true)
    expect(pixel(flat, 8, 8)).toEqual([255, 255, 255])
    expect(pixel(flat, SIZE - 8, 8)).toEqual([OPAQUE.r, OPAQUE.g, OPAQUE.b])
  })
})
