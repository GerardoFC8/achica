import { describe, expect, it } from 'vitest'
import { decodeImage } from './decode'
import { encodeImage, isLossy } from './encode'
import { searchQualityForBudget } from '../budget'

/**
 * The fourth thing phase 1 has to prove: the result fits the weight budget.
 *
 * The fake encoder in budget.test.ts covers the search algorithm. This covers
 * the part a fake cannot — that a real codec responds to quality the way
 * bisection assumes, and that the bytes coming out are genuinely under the
 * ceiling.
 */

const FIXTURE_URLS = import.meta.glob('../../../test/fixtures/**/*.{jpg,png,webp}', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

async function load(name: string): Promise<ArrayBuffer> {
  const key = Object.keys(FIXTURE_URLS).find((path) => path.endsWith(`/${name}`))
  if (key === undefined) throw new Error(`fixture not found: ${name}`)

  const url = FIXTURE_URLS[key]
  if (url === undefined) throw new Error(`fixture url missing: ${name}`)

  return (await fetch(url)).arrayBuffer()
}

/**
 * Walks the JPEG segment chain to the frame header and returns its marker.
 * 0xC0 is baseline, 0xC2 is progressive.
 */
function startOfFrameMarker(jpeg: Uint8Array): number | null {
  let at = 2 // past SOI

  while (at + 3 < jpeg.length) {
    if (jpeg[at] !== 0xff) return null

    const marker = jpeg[at + 1] ?? 0
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) return marker

    const length = ((jpeg[at + 2] ?? 0) << 8) | (jpeg[at + 3] ?? 0)
    at += 2 + length
  }

  return null
}

async function photo(): Promise<ImageData> {
  // A real camera photo, not a synthetic gradient. Flat synthetic images
  // compress unrealistically well and would make a budget test pass for the
  // wrong reason.
  const result = await decodeImage('jpeg', await load('Landscape_6.jpg'))
  if (!result.ok) throw new Error(result.error.detail)
  return result.value
}

describe('encoding', () => {
  it('produces a smaller file at lower quality, which is what bisection assumes', async () => {
    const image = await photo()

    const high = await encodeImage('jpeg', image, 90)
    const low = await encodeImage('jpeg', image, 30)

    expect(high.ok && low.ok).toBe(true)
    if (!high.ok || !low.ok) return
    expect(low.value.length).toBeLessThan(high.value.length)
  })

  it('writes a JPEG that our own decoder reads back', async () => {
    const image = await photo()

    const encoded = await encodeImage('jpeg', image, 80)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return

    const decoded = await decodeImage('jpeg', encoded.value.buffer as ArrayBuffer)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect([decoded.value.width, decoded.value.height]).toEqual([image.width, image.height])
  })

  it('keeps transparency through a PNG round trip', async () => {
    const source = await decodeImage('png', await load('basn6a08.png'))
    expect(source.ok).toBe(true)
    if (!source.ok) return

    const encoded = await encodeImage('png', source.value)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return

    const decoded = await decodeImage('png', encoded.value.buffer as ArrayBuffer)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return

    let transparent = 0
    for (let i = 3; i < decoded.value.data.length; i += 4) {
      if ((decoded.value.data[i] ?? 255) < 255) transparent += 1
    }
    expect(transparent).toBeGreaterThan(0)
  })

  it('reports a failure rather than throwing', async () => {
    const broken = { data: new Uint8ClampedArray(4), width: 0, height: 0 } as ImageData

    const result = await encodeImage('jpeg', broken, 80)

    if (!result.ok) expect(result.error.code).toBe('encode-failed')
  })

  it('writes progressive JPEGs, and reads its own back', async () => {
    /*
     * Closes the progressive-JPEG gap in the fixture corpus without adding a
     * binary. MozJPEG defaults to progressive, so our own encoder produces
     * one; encoding and then decoding it proves both directions at once,
     * which is more than a static fixture would have shown.
     *
     * The frame header says which it is: SOF0 (0xFFC0) is baseline, SOF2
     * (0xFFC2) is progressive.
     */
    const image = await photo()

    const encoded = await encodeImage('jpeg', image, 70)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return

    expect(startOfFrameMarker(encoded.value)).toBe(0xc2)

    const decoded = await decodeImage('jpeg', encoded.value.buffer as ArrayBuffer)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect([decoded.value.width, decoded.value.height]).toEqual([image.width, image.height])
  })

  it('knows which formats have a quality knob at all', () => {
    expect(isLossy('jpeg')).toBe(true)
    expect(isLossy('webp')).toBe(true)
    expect(isLossy('avif')).toBe(true)
    expect(isLossy('png')).toBe(false)
  })
})

/*
 * Measured for Landscape_6.jpg, 1800x1200 (2.2 MP), so the budgets below are
 * real rather than hopeful:
 *
 *   q=100  999.8 KB     q=60  176.5 KB     q=20  65.6 KB
 *   q= 75  298.0 KB     q=40  123.2 KB     q= 5  16.4 KB
 *
 * At the default quality floor of 40 this photo cannot go below ~123 KB, which
 * is exactly the situation the spec answers with "reduce the dimensions and
 * try again".
 */
describe('weight budget against a real codec', () => {
  it.each([150_000, 250_000])('brings a real photo under %i bytes', async (maxBytes) => {
    const image = await photo()

    const outcome = await searchQualityForBudget(
      async (quality) => {
        const encoded = await encodeImage('jpeg', image, quality)
        if (!encoded.ok) throw new Error(encoded.error.detail)
        return { output: encoded.value, bytes: encoded.value.length }
      },
      { maxBytes },
    )

    expect(outcome.withinBudget).toBe(true)
    expect(outcome.bytes).toBeLessThanOrEqual(maxBytes)
    expect(outcome.output.length).toBe(outcome.bytes)
    expect(outcome.attempts).toBeLessThanOrEqual(8)
  })

  it('reports the floor when quality alone cannot reach the budget', async () => {
    // 50 KB is a realistic requirement from a government form, and a 2.2 MP
    // photo cannot meet it at quality 40 — the floor is around 123 KB. This is
    // the case the spec answers by reducing dimensions, and the search's job
    // is to say so clearly rather than fail: the caller needs the floor to
    // work out how much smaller the image has to get.
    const image = await photo()

    const outcome = await searchQualityForBudget(
      async (quality) => {
        const encoded = await encodeImage('jpeg', image, quality)
        if (!encoded.ok) throw new Error(encoded.error.detail)
        return { output: encoded.value, bytes: encoded.value.length }
      },
      { maxBytes: 50_000, minQuality: 40 },
    )

    expect(outcome.withinBudget).toBe(false)
    expect(outcome.quality).toBe(40)
    expect(outcome.bytes).toBeGreaterThan(50_000)
    expect(outcome.attempts).toBeLessThanOrEqual(8)
  })

  it('reaches a tight budget once the quality floor is lowered', async () => {
    // The same photo and the same 50 KB, but allowed down to quality 5, where
    // the measurements put it at 16 KB. It fits — which is what makes the
    // previous test a statement about the quality floor and not about the
    // search giving up early.
    const image = await photo()

    const outcome = await searchQualityForBudget(
      async (quality) => {
        const encoded = await encodeImage('jpeg', image, quality)
        if (!encoded.ok) throw new Error(encoded.error.detail)
        return { output: encoded.value, bytes: encoded.value.length }
      },
      { maxBytes: 50_000, minQuality: 5 },
    )

    expect(outcome.withinBudget).toBe(true)
    expect(outcome.bytes).toBeLessThanOrEqual(50_000)
    expect(outcome.quality).toBeLessThan(40)
  })

  it('does not waste encodes when the photo already fits', async () => {
    const image = await photo()

    const outcome = await searchQualityForBudget(
      async (quality) => {
        const encoded = await encodeImage('jpeg', image, quality)
        if (!encoded.ok) throw new Error(encoded.error.detail)
        return { output: encoded.value, bytes: encoded.value.length }
      },
      { maxBytes: 5_000_000 },
    )

    expect(outcome.withinBudget).toBe(true)
    expect(outcome.attempts).toBe(1)
    expect(outcome.quality).toBe(100)
  })
})
