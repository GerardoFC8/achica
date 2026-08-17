import { describe, expect, it } from 'vitest'
import { processImage } from './pipeline'

/**
 * The whole flow on real files: detect, decode, orient, resize, encode.
 *
 * The individual steps are covered where they live. What is checked here is
 * that they compose — and in particular that the budget loop reaches sizes no
 * single step could.
 */

const FIXTURE_URLS = import.meta.glob('../../test/fixtures/**/*.{jpg,png,webp}', {
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

describe('processImage', () => {
  it('compresses a photo and reports both weights', async () => {
    const result = await processImage(await load('Landscape_6.jpg'), {
      format: 'keep',
      quality: 70,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.format).toBe('jpeg')
    expect(result.value.bytesAfter).toBeLessThan(result.value.bytesBefore)
    expect(result.value.quality).toBe(70)
    expect(result.value.encodes).toBe(1)
  })

  it('applies the EXIF rotation before anything else touches the pixels', async () => {
    // Orientation 6 stores a landscape photo rotated. If the rotation were
    // applied after resizing, the dimension limits would have been enforced
    // against the wrong axis.
    const result = await processImage(await load('Landscape_6.jpg'), {
      format: 'jpeg',
      maxWidth: 600,
      maxHeight: 600,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.width).toBe(600)
    expect(result.value.height).toBe(400)
  })

  it('converts between formats when the plan asks for it', async () => {
    const result = await processImage(await load('Landscape_6.jpg'), {
      format: 'webp',
      quality: 70,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.format).toBe('webp')
    // RIFF....WEBP
    expect(Array.from(result.value.output.subarray(0, 4))).toEqual([0x52, 0x49, 0x46, 0x46])
  })

  it('follows the bytes, not the extension', async () => {
    const result = await processImage(await load('png-with-jpg-extension.jpg'), {
      format: 'keep',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.format).toBe('png')
  })

  describe('weight budgets', () => {
    it('meets a budget quality alone can reach, without resizing', async () => {
      const result = await processImage(await load('Landscape_6.jpg'), {
        format: 'jpeg',
        maxBytes: 200_000,
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.withinBudget).toBe(true)
      expect(result.value.bytesAfter).toBeLessThanOrEqual(200_000)
      expect(result.value.shrunkForBudget).toBeNull()
    })

    it('shrinks on its own when quality alone cannot get there', async () => {
      /*
       * The case the whole product turns on. A 2.2 MP photo bottoms out around
       * 123 KB at the default quality floor, so 50 KB is unreachable by
       * quality. The pipeline reduces the dimensions and says so, rather than
       * either failing or quietly destroying the image.
       */
      const result = await processImage(await load('Landscape_6.jpg'), {
        format: 'jpeg',
        maxBytes: 50_000,
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.withinBudget).toBe(true)
      expect(result.value.bytesAfter).toBeLessThanOrEqual(50_000)
      expect(result.value.shrunkForBudget).not.toBeNull()
      expect(result.value.width).toBeLessThan(1800)
    })

    it('gets there in few encodes, because the shrink step is estimated', async () => {
      const result = await processImage(await load('Landscape_6.jpg'), {
        format: 'jpeg',
        maxBytes: 50_000,
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      // Blind halving would need several more rounds to cover this distance.
      expect(result.value.encodes).toBeLessThanOrEqual(12)
    })

    it('shrinks a PNG to meet a budget, since dimensions are its only lever', async () => {
      /*
       * The open question from the review of the spec: a lossless format with
       * a weight budget. Oxipng has no quality knob, so quality search is
       * meaningless and the format cannot be changed under `keep`. Dimensions
       * are what is left, and using them beats telling the user the request is
       * impossible. The outcome reports the size it settled on so the
       * interface can say plainly that the image was made smaller to fit.
       */
      const source = await load('basn6a08.png')
      const result = await processImage(source, { format: 'png', maxBytes: 200 })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.quality).toBeNull()
      expect(result.value.shrunkForBudget).not.toBeNull()
      expect(result.value.width).toBeLessThan(32)
    })

    it('reports honestly when a budget is simply out of reach', async () => {
      const result = await processImage(await load('Landscape_6.jpg'), {
        format: 'jpeg',
        maxBytes: 200,
        minQuality: 60,
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.withinBudget).toBe(false)
      // Still returns the smallest thing it managed, so the interface has
      // something to show and the user something to decide about.
      expect(result.value.output.length).toBeGreaterThan(0)
    })
  })

  describe('failures stay typed', () => {
    it('reports an empty file', async () => {
      const result = await processImage(await load('empty.jpg'), { format: 'keep' })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('empty-file')
    })

    it('reports a corrupt file without taking the batch down', async () => {
      const result = await processImage(await load('xs1n0g01.png'), { format: 'keep' })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(['unknown-format', 'decode-failed']).toContain(result.error.code)
    })

    it('reports a truncated file', async () => {
      const result = await processImage(await load('truncated.jpg'), { format: 'keep' })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('decode-failed')
    })
  })
})
