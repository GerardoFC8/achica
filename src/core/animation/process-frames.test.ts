import { describe, expect, it } from 'vitest'
import { ok } from '../result'
import type { LadderDeps } from './ladder'
import { processFrames, type AnimationPlan } from './process'
import type { AnimationEncoding, Frame } from './types'

/** Frames with invented pixels: the fake encoder only counts. */
function frames(count: number, side = 8, delayMs = 66): Frame[] {
  return Array.from({ length: count }, () => ({
    data: new Uint8ClampedArray(side * side * 4),
    width: side,
    height: side,
    delayMs,
  }))
}

const PLAN: AnimationPlan = { layout: { kind: 'sticker', size: 8 }, format: 'gif', maxBytes: 1000 }

/** Every frame costs `perFrame` bytes, whatever the palette. */
const deps = (perFrame: number): LadderDeps => ({
  encode: (list, settings) =>
    Promise.resolve(
      ok({
        format: settings.format,
        bytes: new Uint8Array(perFrame * list.length),
        frameCount: list.length,
        width: list[0]?.width ?? 0,
        height: list[0]?.height ?? 0,
        report: {} as AnimationEncoding['report'],
      }),
    ),
})

describe('processFrames', () => {
  it('reports the weight of the file the frames came from, not of the frames', async () => {
    const result = await processFrames(frames(10), PLAN, { bytesBefore: 4_321_000 }, deps(10))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.bytesBefore).toBe(4_321_000)
    expect(result.value.frames).toBe(10)
    expect(result.value.withinBudget).toBe(true)
    expect(result.value.clip).toBeUndefined()
  })

  it('carries the clip through, as given', async () => {
    const clip = { startSeconds: 2, lengthSeconds: 0.66, sourceDurationSeconds: 42 }
    const result = await processFrames(frames(10), PLAN, { bytesBefore: 1, clip }, deps(10))

    expect(result.ok && result.value.clip).toEqual(clip)
  })

  it('gives up fps to fit, like an animation read from a file', async () => {
    // 30 frames at 100 bytes is 3000: over 1000, so frames must go.
    const result = await processFrames(frames(30, 8, 66), PLAN, { bytesBefore: 1 }, deps(100))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.withinBudget).toBe(true)
    expect(result.value.bytes.length).toBeLessThanOrEqual(1000)
    expect(result.value.steps.some((step) => step.kind === 'fps')).toBe(true)
  })

  it('answers a budget that cannot be met with a marked success, never an error', async () => {
    const result = await processFrames(frames(10), PLAN, { bytesBefore: 1 }, deps(5000))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.withinBudget).toBe(false)
    expect(result.value.bytes.length).toBeGreaterThan(PLAN.maxBytes)
  })

  it('is a typed error, not a throw, when there are no frames', async () => {
    const result = await processFrames([], PLAN, { bytesBefore: 1 }, deps(10))

    expect(!result.ok && result.error.code).toBe('no-frames')
  })
})
