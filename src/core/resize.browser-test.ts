import { describe, expect, it } from 'vitest'
import { decodeImage } from './codecs/decode'
import { encodeImage } from './codecs/encode'
import { searchQualityForBudget } from './budget'
import { fitWithin, resampleImage, scaleBy } from './resize'

/**
 * The resampling half, which needs real wasm and real pixels.
 *
 * The last test is the one that matters most: it closes the gap the budget
 * tests left open. A 2.2 MP photo cannot reach 50 KB on quality alone, and
 * this shows the answer the spec prescribes — fewer pixels — actually works.
 */

const FIXTURE_URLS = import.meta.glob('../../test/fixtures/**/*.{jpg,png}', {
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

async function decoded(name: string, format: 'jpeg' | 'png'): Promise<ImageData> {
  const result = await decodeImage(format, await load(name))
  if (!result.ok) throw new Error(result.error.detail)
  return result.value
}

describe('resampleImage', () => {
  it('produces exactly the requested size', async () => {
    const image = await decoded('Landscape_6.jpg', 'jpeg')
    const target = fitWithin(image, { maxWidth: 600, maxHeight: 600 })

    const resized = await resampleImage(image, target)

    expect([resized.width, resized.height]).toEqual([target.width, target.height])
  })

  it('keeps transparency through a resize', async () => {
    const image = await decoded('basn6a08.png', 'png')

    const resized = await resampleImage(image, scaleBy(image, 0.5))

    let transparent = 0
    for (let i = 3; i < resized.data.length; i += 4) {
      if ((resized.data[i] ?? 255) < 255) transparent += 1
    }

    expect(transparent).toBeGreaterThan(0)
  })

  it('avoids the dark halo that unpremultiplied resampling produces', async () => {
    /*
     * An A/B rather than an assertion of faith.
     *
     * Resampling straight RGBA averages the colour of transparent pixels —
     * stored as black here — into their visible neighbours, so every soft edge
     * picks up a dark fringe. Premultiplying weights colour by alpha first and
     * avoids it. Running both settings on the same image is the only way to
     * show the default is actually doing something rather than to assume it.
     */
    // Built here rather than loaded: the halo only appears when transparent
    // pixels carry a colour far from their visible neighbours, and none of the
    // PngSuite fixtures do. Left half opaque white, right half fully
    // transparent with black underneath — the exact shape of the bug.
    const size = 32
    const data = new Uint8ClampedArray(size * size * 4)
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const i = (y * size + x) * 4
        const opaque = x < size / 2
        data[i] = opaque ? 255 : 0
        data[i + 1] = opaque ? 255 : 0
        data[i + 2] = opaque ? 255 : 0
        data[i + 3] = opaque ? 255 : 0
      }
    }
    const image = new ImageData(data, size, size)

    const { default: resize } = await import('@jsquash/resize')
    const target = scaleBy(image, 0.5)

    /*
     * The darkest visible pixel, not the average.
     *
     * Only the column along the edge mixes, so averaging the whole image
     * drowns the effect in the untouched opaque half — a difference of a tenth
     * of a percent that proves nothing. The halo lives at the boundary, so
     * that is what gets measured.
     */
    const darkestVisiblePixel = (result: ImageData): number => {
      let darkest = 255

      for (let i = 0; i < result.data.length; i += 4) {
        if ((result.data[i + 3] ?? 0) < 128) continue
        const brightness =
          ((result.data[i] ?? 0) + (result.data[i + 1] ?? 0) + (result.data[i + 2] ?? 0)) / 3
        if (brightness < darkest) darkest = brightness
      }

      return darkest
    }

    const premultiplied = await resize(image, { ...target, premultiply: true })
    const straight = await resize(image, { ...target, premultiply: false })

    const withPremultiply = darkestVisiblePixel(premultiplied)
    const without = darkestVisiblePixel(straight)

    /*
     * Measured on this image at this reduction: 254 with premultiply against
     * 248 without. Six levels of darkening along the edge — modest at 2x, and
     * worse the harder the image is shrunk.
     *
     * The threshold is that measured gap rather than a round percentage,
     * because a percentage picked to make the test pass would say nothing
     * about whether the setting is doing its job.
     */
    expect(withPremultiply - without).toBeGreaterThanOrEqual(3)
  })

  it('leaves the image untouched when the size already fits', async () => {
    const image = await decoded('no-exif.jpg', 'jpeg')

    expect(fitWithin(image, { maxWidth: 4000 })).toEqual({
      width: image.width,
      height: image.height,
    })
  })
})

describe('resize as the answer when quality is not enough', () => {
  it('reaches a budget that quality alone could not', async () => {
    /*
     * The gap the budget tests left open, closed.
     *
     * At 1800x1200 this photo bottoms out around 123 KB at quality 40, so a
     * 50 KB requirement is unreachable. Halving the dimensions cuts the pixel
     * count to a quarter, and the same search then lands inside the budget
     * without dropping quality to the point of visible damage.
     */
    const image = await decoded('Landscape_6.jpg', 'jpeg')
    const maxBytes = 50_000

    const encodeAt = (source: ImageData) => async (quality: number) => {
      const encoded = await encodeImage('jpeg', source, quality)
      if (!encoded.ok) throw new Error(encoded.error.detail)
      return { output: encoded.value, bytes: encoded.value.length }
    }

    const atFullSize = await searchQualityForBudget(encodeAt(image), { maxBytes, minQuality: 40 })
    expect(atFullSize.withinBudget).toBe(false)

    const smaller = await resampleImage(image, scaleBy(image, 0.5))
    const atHalfSize = await searchQualityForBudget(encodeAt(smaller), { maxBytes, minQuality: 40 })

    expect(atHalfSize.withinBudget).toBe(true)
    expect(atHalfSize.bytes).toBeLessThanOrEqual(maxBytes)
    // And it got there without scraping the bottom of the quality range.
    expect(atHalfSize.quality).toBeGreaterThan(40)
  })
})
