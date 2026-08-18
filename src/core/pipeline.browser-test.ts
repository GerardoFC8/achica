import { describe, expect, it } from 'vitest'
import { processImage } from './pipeline'
import { decodeImage } from './codecs/decode'
import { encodeImage } from './codecs/encode'

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

      /*
       * The budget is calibrated against what the codec can actually reach at
       * full size instead of being a fixed number. A fixed 200 bytes used to
       * force a shrink and silently stopped doing so the day oxipng arrived and
       * packed the same 32x32 image under that (D50) — the test kept passing
       * while testing nothing. One byte under the best full-size encode is a
       * budget only a smaller picture can meet, whatever the codec learns next.
       */
      const decoded = await decodeImage('png', source)
      expect(decoded.ok).toBe(true)
      if (!decoded.ok) return
      const atFullSize = await encodeImage('png', decoded.value)
      expect(atFullSize.ok).toBe(true)
      if (!atFullSize.ok) return

      const result = await processImage(source, {
        format: 'png',
        maxBytes: atFullSize.value.byteLength - 1,
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.quality).toBeNull()
      expect(result.value.shrunkForBudget).not.toBeNull()
      expect(result.value.width).toBeLessThan(32)
    })

    it('never inflates a file to fill a generous budget', async () => {
      /*
       * The bug this guards, found by the profile tests. Asked for "under
       * 500 KB" with a 352 KB photo, the search found the highest quality that
       * fit and returned 495 KB — larger than the input. A budget is a
       * ceiling, not a target, and a compressor that grows files is broken
       * whatever else it gets right.
       */
      const source = await load('Landscape_6.jpg')

      const result = await processImage(source, { format: 'jpeg', maxBytes: 5_000_000 })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.bytesAfter).toBeLessThanOrEqual(result.value.bytesBefore)
    })

    it('compresses a file that already fits instead of nudging it under its own size', async () => {
      /*
       * The defect the interface made visible. Asked for "under 300 KB" with a
       * 252 KB photo, the search maximised quality against the photo's own
       * size and returned 249 KB: a 1% saving paid for with a quality pass.
       *
       * A budget that the source already meets is not the target. The target
       * is the profile's quality, which is what the user chose a destination
       * for in the first place.
       */
      const source = await load('Landscape_6.jpg')

      const result = await processImage(source, { format: 'jpeg', maxBytes: 5_000_000 })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.withinBudget).toBe(true)
      // Before the fix this came back at 95% of the source. The number that
      // matters is the next assertion, though: one encode means the ceiling
      // is not being searched against at all.
      expect(result.value.bytesAfter).toBeLessThan(result.value.bytesBefore * 0.9)
      expect(result.value.encodes).toBe(1)
    })

    it('uses the quality the plan asked for when the budget is already met', async () => {
      const source = await load('Landscape_6.jpg')

      const result = await processImage(source, {
        format: 'jpeg',
        maxBytes: 5_000_000,
        quality: 40,
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.quality).toBe(40)
    })

    it('leaves the dimensions alone when the budget was never the problem', async () => {
      /*
       * The other half of the same defect. A 32x32 PNG is 167 bytes, so the
       * effective ceiling became 167 bytes, which no JPEG header fits inside.
       * The shrink loop ground the image down to 9x9 and still handed back
       * something larger — destroying the picture to chase a limit that was
       * never in the way.
       */
      const source = await load('basn6a08.png')

      const result = await processImage(source, { format: 'jpeg', maxBytes: 5_000_000 })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.width).toBe(32)
      expect(result.value.shrunkForBudget).toBeNull()
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
