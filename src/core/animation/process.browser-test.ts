import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadFixture } from '../../../test/helpers/animation-fixtures'
import { decodeAnimation } from './decode'
import { processAnimation, type AnimationPlan } from './process'

/**
 * End to end, in the browser: the bytes that come out are decoded again with
 * a bare ImageDecoder (not with decodeAnimation), so the checks are about what
 * a viewer would show, not about what this module believes it wrote.
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

const MIME = { gif: 'image/gif', apng: 'image/apng' } as const

async function inspect(
  bytes: Uint8Array<ArrayBuffer>,
  format: 'gif' | 'apng',
): Promise<{ width: number; height: number; frames: number; durationMs: number }> {
  const decoder = new ImageDecoder({ data: bytes, type: MIME[format] })
  await decoder.completed
  await decoder.tracks.ready
  const count = decoder.tracks.selectedTrack?.frameCount ?? 0
  let durationMs = 0
  let width = 0
  let height = 0
  for (let frameIndex = 0; frameIndex < count; frameIndex += 1) {
    const { image } = await decoder.decode({ frameIndex, completeFramesOnly: true })
    width = image.displayWidth
    height = image.displayHeight
    durationMs += (image.duration ?? 0) / 1000
    image.close()
  }
  decoder.close()
  return { width, height, frames: count, durationMs }
}

const FIXTURES = [
  'anim-opaque.gif',
  'anim-wide.gif',
  'anim.apng',
  'anim.webp',
  'anim-delays.gif',
  'anim-transparent.gif',
] as const

async function original(name: string): Promise<{ frames: number; durationMs: number }> {
  const decoded = await decodeAnimation(await loadFixture(name))
  if (!decoded.ok) throw new Error(decoded.error.detail)
  return { frames: decoded.value.frames.length, durationMs: decoded.value.durationMs }
}

const sticker = (format: 'gif' | 'apng', maxBytes: number): AnimationPlan => ({
  layout: { kind: 'sticker', size: 320 },
  format,
  maxBytes,
})

describe('processAnimation, end to end', () => {
  describe.each(['gif', 'apng'] as const)('sticker as %s', (format) => {
    it.each(FIXTURES)(
      '%s comes out 320x320, same length, and the verdict is true',
      async (name) => {
        const before = await original(name)
        const bytes = await loadFixture(name)
        const result = await processAnimation(bytes, sticker(format, 512 * 1024))
        if (!result.ok) throw new Error(result.error.detail)
        const outcome = result.value

        const decoded = await inspect(outcome.bytes, format)
        expect([decoded.width, decoded.height]).toEqual([320, 320])
        expect([outcome.width, outcome.height]).toEqual([320, 320])
        expect(decoded.frames).toBeLessThanOrEqual(before.frames)
        expect(decoded.frames).toBe(outcome.frames)
        expect(Math.abs(decoded.durationMs - before.durationMs)).toBeLessThanOrEqual(
          Math.max(30, before.durationMs * 0.02),
        )
        expect(outcome.withinBudget).toBe(outcome.bytes.length <= 512 * 1024)
        expect(outcome.bytesBefore).toBe(bytes.length)
        expect(outcome.encodes).toBeGreaterThanOrEqual(1)
      },
    )
  })

  it('squeezes a sticker under a tight budget by giving things up, and says what', async () => {
    const result = await processAnimation(
      await loadFixture('anim-opaque.gif'),
      sticker('gif', 12 * 1024),
    )
    if (!result.ok) throw new Error(result.error.detail)
    const outcome = result.value
    expect(outcome.steps.length).toBeGreaterThan(0)
    expect(outcome.withinBudget).toBe(outcome.bytes.length <= 12 * 1024)
    expect(outcome.encodes).toBeLessThanOrEqual(12)
    const decoded = await inspect(outcome.bytes, 'gif')
    expect([decoded.width, decoded.height]).toEqual([320, 320])
  })

  it('keeps the transparent padding of a non-square source', async () => {
    const result = await processAnimation(
      await loadFixture('anim-wide.gif'),
      sticker('apng', 4 * 1024 * 1024),
    )
    if (!result.ok) throw new Error(result.error.detail)
    // 160x90 on 320x320: the content is 320x180 at y=70, the rest is clear.
    const decoder = new ImageDecoder({ data: result.value.bytes, type: 'image/apng' })
    await decoder.completed
    const { image } = await decoder.decode({ frameIndex: 0 })
    const canvas = new OffscreenCanvas(320, 320)
    const context = canvas.getContext('2d')
    context?.drawImage(image, 0, 0)
    const top = context?.getImageData(160, 10, 1, 1).data[3]
    const middle = context?.getImageData(160, 160, 1, 1).data[3]
    image.close()
    decoder.close()
    expect(top).toBe(0)
    expect(middle).toBe(255)
  })

  it.each(FIXTURES)(
    'emoji from %s fits 128 without enlarging, as a GIF under 256 KB',
    async (name) => {
      const before = await original(name)
      const result = await processAnimation(await loadFixture(name), {
        layout: { kind: 'emoji', maxSide: 128 },
        format: 'gif',
        maxBytes: 256 * 1024,
      })
      if (!result.ok) throw new Error(result.error.detail)
      const outcome = result.value
      const decoded = await inspect(outcome.bytes, 'gif')
      const wide = name === 'anim-wide.gif'
      expect([decoded.width, decoded.height]).toEqual(wide ? [128, 72] : [96, 96])
      expect(decoded.frames).toBeLessThanOrEqual(before.frames)
      expect(Math.abs(decoded.durationMs - before.durationMs)).toBeLessThanOrEqual(
        Math.max(30, before.durationMs * 0.02),
      )
      expect(outcome.withinBudget).toBe(outcome.bytes.length <= 256 * 1024)
    },
  )

  it('can shrink an emoji to fit and reports the factor', async () => {
    const result = await processAnimation(await loadFixture('anim-opaque.gif'), {
      layout: { kind: 'emoji', maxSide: 128 },
      format: 'gif',
      maxBytes: 2 * 1024,
    })
    if (!result.ok) throw new Error(result.error.detail)
    expect(result.value.steps.some((step) => step.kind === 'scale')).toBe(true)
    expect(result.value.width).toBeLessThan(96)
  })

  it('returns typed errors for what is not an animation', async () => {
    const code = async (bytes: Uint8Array): Promise<string> => {
      const result = await processAnimation(bytes, sticker('gif', 512 * 1024))
      return result.ok ? 'ok' : result.error.code
    }
    expect(await code(await loadFixture('static.png'))).toBe('not-animated')
    expect(await code(await loadFixture('single-frame.gif'))).toBe('not-animated')
    expect(await code(await loadFixture('orientation-1.jpg'))).toBe('unsupported-format')
    const whole = await loadFixture('anim-opaque.gif')
    const truncated = await processAnimation(
      whole.subarray(0, Math.floor(whole.length * 0.5)),
      sticker('gif', 512 * 1024),
    )
    // A cut file either fails or yields fewer frames; it must not throw.
    if (truncated.ok) expect(truncated.value.frames).toBeLessThan(12)
    expect(await code(new Uint8Array(300).map((_, at) => (at * 7) % 256))).toBe(
      'unsupported-format',
    )
  })

  it('answers animation-unsupported where ImageDecoder does not exist', async () => {
    vi.stubGlobal('ImageDecoder', undefined)
    const result = await processAnimation(
      await loadFixture('anim-opaque.gif'),
      sticker('gif', 512 * 1024),
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'animation-unsupported' } })
  })
})
