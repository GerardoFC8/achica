import { describe, expect, it } from 'vitest'
import { nextScaleForBudget, processImage, processVideoFrames } from './pipeline'

/**
 * The pure half of the pipeline: how far to shrink when the budget is out of
 * reach. Everything else in that module is orchestration and needs real
 * codecs, so it is covered in pipeline.browser-test.ts.
 */
describe('nextScaleForBudget', () => {
  it('barely shrinks when the miss is small', () => {
    // 10% over budget should not cost half the image.
    expect(nextScaleForBudget(110_000, 100_000)).toBeGreaterThan(0.8)
  })

  it('shrinks hard when the miss is large', () => {
    // Ten times over budget needs roughly a third of the width.
    expect(nextScaleForBudget(1_000_000, 100_000)).toBeLessThan(0.35)
  })

  it('lands near the answer in one round, which halving does not', () => {
    /*
     * Encoded size tracks pixel count, so a scale of s takes bytes to about
     * s^2 of what they were. Checking the estimate against that model is what
     * separates a reasoned step from a guess.
     */
    for (const [current, target] of [
      [200_000, 100_000],
      [500_000, 100_000],
      [123_000, 50_000],
      [1_000_000, 40_000],
    ] as const) {
      const scale = nextScaleForBudget(current, target)
      const predicted = current * scale * scale

      expect(predicted, `${current} -> ${target}`).toBeLessThanOrEqual(target)
      // And not so cautious that it throws away far more than it needed to.
      expect(predicted, `${current} -> ${target}`).toBeGreaterThan(target * 0.5)
    }
  })

  it('always makes progress', () => {
    // A scale of 1 would loop forever on an image that cannot reach the budget.
    expect(nextScaleForBudget(100_001, 100_000)).toBeLessThan(1)
  })

  it('never collapses the image', () => {
    expect(nextScaleForBudget(500_000_000, 10)).toBeGreaterThanOrEqual(0.1)
  })

  it('falls back to halving on nonsense input', () => {
    expect(nextScaleForBudget(0, 100)).toBe(0.5)
    expect(nextScaleForBudget(100, 0)).toBe(0.5)
  })
})

describe('processImage with an animation plan', () => {
  const ANIMATION = { layout: { kind: 'sticker', size: 320 }, format: 'gif' } as const

  it('does not go through still-image detection: an empty file is the animation error', async () => {
    const result = await processImage(new ArrayBuffer(0), {
      format: 'keep',
      maxBytes: 512_000,
      animation: ANIMATION,
    })

    // A still plan would say `empty-file` as a DetectionError; this one says it
    // as an animation failure, which is how the interface tells them apart.
    expect(result).toEqual({
      ok: false,
      error: { code: 'animation-failed', reason: 'empty-file', detail: expect.any(String) },
    })
  })

  it('refuses a plan with no budget instead of guessing one', async () => {
    const result = await processImage(new ArrayBuffer(8), { format: 'keep', animation: ANIMATION })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatchObject({ code: 'animation-failed', reason: 'bad-option' })
    }
  })
})

describe('processVideoFrames', () => {
  const ANIMATION = { layout: { kind: 'sticker', size: 16 }, format: 'gif' } as const
  const frame = (shade: number) => ({
    data: new Uint8ClampedArray(16 * 16 * 4).fill(shade),
    width: 16,
    height: 16,
    delayMs: 100,
  })
  const frames = Array.from({ length: 6 }, (_, k) => frame(k * 40))

  it('turns extracted frames into a PipelineOutcome with the clip and the video weight', async () => {
    const clip = { startSeconds: 1, lengthSeconds: 0.6, sourceDurationSeconds: 9 }
    const result = await processVideoFrames(
      frames,
      { format: 'keep', maxBytes: 100_000, animation: ANIMATION },
      { bytesBefore: 777_000, clip },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const { value } = result
    expect(value.format).toBe('gif')
    expect(value.bytesBefore).toBe(777_000)
    expect(value.bytesAfter).toBe(value.output.length)
    expect(value.withinBudget).toBe(value.bytesAfter <= 100_000)
    expect([value.width, value.height]).toEqual([16, 16])
    expect(value.animation?.frames).toBe(6)
    expect(value.animation?.clip).toEqual(clip)
    expect(value.animation?.limitBytes).toBe(100_000)
    // The GIF it wrote is a GIF.
    expect(String.fromCharCode(...value.output.slice(0, 3))).toBe('GIF')
  })

  it('a budget it cannot meet is a success marked withinBudget false', async () => {
    const result = await processVideoFrames(
      frames,
      { format: 'keep', maxBytes: 10, animation: ANIMATION },
      { bytesBefore: 1 },
    )

    expect(result.ok && result.value.withinBudget).toBe(false)
  })

  it('refuses a plan without an animation or a budget', async () => {
    for (const plan of [
      { format: 'keep', maxBytes: 100 },
      { format: 'keep', animation: ANIMATION },
    ] as const) {
      const result = await processVideoFrames(frames, plan, { bytesBefore: 1 })
      expect(!result.ok && result.error).toMatchObject({
        code: 'animation-failed',
        reason: 'bad-option',
      })
    }
  })
})
