import { describe, expect, it } from 'vitest'
import { ok } from '../result'
import {
  fitAnimationToBudget,
  LADDER,
  mergeShortDelays,
  sampleAtRate,
  type EncodeSettings,
  type LadderDeps,
} from './ladder'
import type { AnimationEncoding, Frame } from './types'

/** Frames with invented pixels: the fake encoder only looks at counts and sizes. */
function frames(count: number, delays: number | readonly number[], side = 8): Frame[] {
  return Array.from({ length: count }, (_, k) => ({
    data: new Uint8ClampedArray(side * side * 4),
    width: side,
    height: side,
    delayMs: typeof delays === 'number' ? delays : (delays[k % delays.length] ?? 100),
  }))
}

const total = (list: readonly { delayMs: number }[]): number =>
  list.reduce((sum, frame) => sum + frame.delayMs, 0)

type Seen = { settings: EncodeSettings; frames: number; width: number; bytes: number }

/**
 * A size model with the shape of the real one: proportional to frames, to
 * pixels and to colours, so every lever shrinks the file and the cheapest
 * lever that is enough is easy to name.
 */
function fake(options: {
  cropping?: 'helps' | 'hurts'
  perFrame?: (pixels: number, colors: number) => number
}): { deps: LadderDeps; seen: Seen[] } {
  const seen: Seen[] = []
  const deps: LadderDeps = {
    encode: (list, settings) => {
      const first = list[0]
      const pixels = (first?.width ?? 0) * (first?.height ?? 0)
      // Lossless RGBA is heavier than any palette.
      const colors = settings.colors ?? 1024
      const each = options.perFrame?.(pixels, colors) ?? pixels * colors
      let bytes = Math.round(each * list.length)
      if (options.cropping === 'helps') bytes = settings.optimise ? bytes : Math.round(bytes * 1.3)
      if (options.cropping === 'hurts') bytes = settings.optimise ? Math.round(bytes * 1.3) : bytes
      seen.push({ settings, frames: list.length, width: first?.width ?? 0, bytes })
      return Promise.resolve(
        ok({
          format: settings.format,
          bytes: new Uint8Array(bytes),
          frameCount: list.length,
          width: first?.width ?? 0,
          height: first?.height ?? 0,
          report: {} as AnimationEncoding['report'],
        }),
      )
    },
    resize: (frame, target) =>
      Promise.resolve({
        ...frame,
        width: target.width,
        height: target.height,
        data: new Uint8ClampedArray(target.width * target.height * 4),
      }),
  }
  return { deps, seen }
}

const gif = { format: 'gif', layout: 'sticker' } as const

describe('sampleAtRate and mergeShortDelays', () => {
  it('keeps the total duration whatever the rate', () => {
    const source = frames(45, [66, 67, 67])
    for (const fps of [12, 10, 8, 6, 5, 4]) {
      const kept = sampleAtRate(source, fps)
      expect(total(kept)).toBe(total(source))
      expect(kept[0]?.index).toBe(0)
      // The rate is the target or a little above it, never below.
      expect(kept.length / (total(source) / 1000)).toBeGreaterThanOrEqual(fps - 0.01)
    }
  })

  it('works with delays that differ and a rate that is not a ratio of the source', () => {
    const source = frames(20, [40, 120, 40, 200])
    const kept = sampleAtRate(source, 7)
    expect(total(kept)).toBe(total(source))
    expect(new Set(kept.map((entry) => entry.index)).size).toBe(kept.length)
  })

  it('merges frames shorter than 20 ms into the one before and loses no time', () => {
    const merged = mergeShortDelays(frames(6, [10, 10, 50, 5, 5, 40]))
    // The leading 10 ms frame has nothing before it: it stays and takes the next 10 ms.
    expect(total(merged)).toBe(120)
    expect(merged.map((frame) => frame.delayMs)).toEqual([20, 60, 40])
    // A short first frame followed by a long one stays short; the GIF writer raises it.
    expect(mergeShortDelays(frames(3, [10, 30, 30])).map((frame) => frame.delayMs)).toEqual([
      10, 30, 30,
    ])
  })
})

describe('fitAnimationToBudget (invented sizes)', () => {
  it('does nothing and encodes once when the first try fits', async () => {
    const { deps, seen } = fake({})
    const result = await fitAnimationToBudget(frames(30, 66), { ...gif, maxBytes: 1e9 }, deps)
    if (!result.ok) throw new Error(result.error.detail)
    expect(result.value.withinBudget).toBe(true)
    expect(result.value.steps).toEqual([])
    expect(result.value.encodes).toBe(1)
    expect(seen[0]?.settings).toEqual({ format: 'gif', colors: 256, optimise: true })
  })

  it('stops at the least aggressive rung that fits: here, 64 colours', async () => {
    const { deps } = fake({})
    const result = await fitAnimationToBudget(
      frames(30, 66),
      { ...gif, maxBytes: 30 * 64 * 64 },
      deps,
    )
    if (!result.ok) throw new Error(result.error.detail)
    expect(result.value.colors).toBe(64)
    expect(result.value.steps).toEqual([{ kind: 'palette', colors: 64 }])
    expect(result.value.frameCount).toBe(30)
    expect(result.value.withinBudget).toBe(true)
    expect(result.value.encodes).toBeLessThanOrEqual(LADDER.maxEncodes)
  })

  it('drops frames only after the palette is spent, and keeps the duration', async () => {
    const { deps } = fake({})
    const source = frames(30, [66, 67, 67])
    const result = await fitAnimationToBudget(source, { ...gif, maxBytes: 64 * 32 * 18 }, deps)
    if (!result.ok) throw new Error(result.error.detail)
    expect(result.value.steps.map((step) => step.kind)).toEqual(['palette', 'fps'])
    expect(result.value.steps[0]).toEqual({ kind: 'palette', colors: 32 })
    expect(result.value.durationMs).toBe(total(source))
    expect(result.value.fps).toBeGreaterThanOrEqual(LADDER.minFps)
    expect(result.value.fps).toBeLessThan(15)
    expect(result.value.withinBudget).toBe(true)
    expect(result.value.steps[1]).toMatchObject({ kind: 'fps', from: 15 })
  })

  it('reports the smallest thing it made, never below 4 fps, when nothing fits', async () => {
    const { deps, seen } = fake({})
    const source = frames(60, 66)
    const result = await fitAnimationToBudget(source, { ...gif, maxBytes: 10 }, deps)
    if (!result.ok) throw new Error(result.error.detail)
    expect(result.value.withinBudget).toBe(false)
    expect(result.value.encoding.bytes.length).toBe(Math.min(...seen.map((entry) => entry.bytes)))
    expect(result.value.fps).toBeGreaterThanOrEqual(LADDER.minFps)
    expect(result.value.durationMs).toBe(total(source))
    expect(result.value.encodes).toBeLessThanOrEqual(LADDER.maxEncodes)
  })

  it('never encodes below 4 fps, whatever the budget', async () => {
    const { deps, seen } = fake({})
    await fitAnimationToBudget(frames(120, 33), { ...gif, maxBytes: 1 }, deps)
    for (const entry of seen) {
      expect(entry.frames / ((120 * 33) / 1000)).toBeGreaterThanOrEqual(LADDER.minFps - 0.01)
    }
  })

  it('does not drop frames from an animation that is already at the floor', async () => {
    const { deps, seen } = fake({})
    const result = await fitAnimationToBudget(frames(8, 250), { ...gif, maxBytes: 1 }, deps)
    if (!result.ok) throw new Error(result.error.detail)
    expect(seen.every((entry) => entry.frames === 8)).toBe(true)
    expect(result.value.steps.some((step) => step.kind === 'fps')).toBe(false)
  })

  it('respects the cap on encodes', async () => {
    const { deps, seen } = fake({})
    const budget = 64 * 16 * 25
    const result = await fitAnimationToBudget(
      frames(60, 66),
      { ...gif, maxBytes: budget, maxEncodes: 4 },
      deps,
    )
    if (!result.ok) throw new Error(result.error.detail)
    expect(seen.length).toBeLessThanOrEqual(4)
    expect(result.value.encodes).toBe(seen.length)
    // What it returns was measured: the verdict is the real size against the budget.
    expect(result.value.withinBudget).toBe(result.value.encoding.bytes.length <= budget)
  })

  it('shrinks an emoji only after the frames, and reports the factor', async () => {
    const { deps } = fake({})
    const source = frames(30, 66, 128)
    // Too small for 16 colours at the lowest rate, so only a smaller emoji fits.
    const budget = 128 * 128 * 16 * 8 * 0.7
    const result = await fitAnimationToBudget(
      source,
      { format: 'gif', layout: 'emoji', maxBytes: budget },
      deps,
    )
    if (!result.ok) throw new Error(result.error.detail)
    expect(result.value.steps.map((step) => step.kind)).toEqual(['palette', 'fps', 'scale'])
    const scale = result.value.steps[2]
    if (scale?.kind !== 'scale') throw new Error('no scale step')
    expect(result.value.width).toBe(Math.round(128 * scale.to))
    expect(result.value.height).toBe(result.value.width)
    expect(result.value.withinBudget).toBe(true)
  })

  it('uses the 256 px canvas only when the plan allows it', async () => {
    const source = frames(30, 66, 320)
    const tight = { ...gif, maxBytes: 320 * 320 * 16 * 8 * 0.7 }
    const without = await fitAnimationToBudget(source, tight, fake({}).deps)
    if (!without.ok) throw new Error(without.error.detail)
    expect(without.value.steps.some((step) => step.kind === 'canvas')).toBe(false)
    expect(without.value.width).toBe(320)

    const allowed = await fitAnimationToBudget(
      source,
      { ...tight, allowCanvasReduction: true },
      fake({}).deps,
    )
    if (!allowed.ok) throw new Error(allowed.error.detail)
    expect(allowed.value.steps.at(-1)).toEqual({ kind: 'canvas', to: 256 })
    expect([allowed.value.width, allowed.value.height]).toEqual([256, 256])
    expect(allowed.value.withinBudget).toBe(true)
  })

  it('keeps cropping when it helps and turns it off, and says so, when it does not', async () => {
    const budget = 30 * 8 * 8 * 64
    const helps = await fitAnimationToBudget(
      frames(30, 66),
      { ...gif, maxBytes: budget },
      fake({ cropping: 'helps' }).deps,
    )
    if (!helps.ok) throw new Error(helps.error.detail)
    expect(helps.value.steps.some((step) => step.kind === 'optimise')).toBe(false)

    const hurts = await fitAnimationToBudget(
      frames(30, 66),
      { ...gif, maxBytes: budget },
      fake({ cropping: 'hurts' }).deps,
    )
    if (!hurts.ok) throw new Error(hurts.error.detail)
    expect(hurts.value.steps).toContainEqual({ kind: 'optimise', on: false })
    expect(hurts.value.withinBudget).toBe(true)
  })

  it('tries lossless RGBA first for a small APNG, and never for a large one', async () => {
    const small = fake({})
    const fitsRgba = await fitAnimationToBudget(
      frames(10, 100, 16),
      { format: 'apng', layout: 'sticker', maxBytes: 1e9 },
      small.deps,
    )
    if (!fitsRgba.ok) throw new Error(fitsRgba.error.detail)
    expect(small.seen[0]?.settings.colors).toBeNull()
    expect(fitsRgba.value.colors).toBeNull()
    expect(fitsRgba.value.steps).toEqual([])

    const large = fake({})
    // 320 x 320 x 4 x 45 = 18 MB of raw pixels: not worth deflating.
    await fitAnimationToBudget(
      frames(45, 66, 320),
      { format: 'apng', layout: 'sticker', maxBytes: 1 },
      large.deps,
    )
    expect(large.seen.every((entry) => entry.settings.colors !== null)).toBe(true)
  })

  it('says the palette was a sacrifice when an APNG gives up RGBA for 256 colours', async () => {
    const { deps } = fake({})
    const result = await fitAnimationToBudget(
      frames(10, 100, 16),
      { format: 'apng', layout: 'sticker', maxBytes: 16 * 16 * 256 * 10 },
      deps,
    )
    if (!result.ok) throw new Error(result.error.detail)
    expect(result.value.colors).toBe(256)
    expect(result.value.steps).toEqual([{ kind: 'palette', colors: 256 }])
  })

  it('returns an encoder failure as a value', async () => {
    const result = await fitAnimationToBudget(
      frames(5, 100),
      { ...gif, maxBytes: 10 },
      { encode: () => Promise.resolve({ ok: false, error: { code: 'too-large', detail: 'x' } }) },
    )
    expect(result).toEqual({ ok: false, error: { code: 'too-large', detail: 'x' } })
  })

  it('turns a failing resampler into a typed error', async () => {
    const result = await fitAnimationToBudget(
      frames(10, 100, 128),
      { format: 'gif', layout: 'emoji', maxBytes: 1 },
      { ...fake({}).deps, resize: () => Promise.reject(new Error('wasm gone')) },
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'resize-failed' } })
  })
})

describe('fitAnimationToBudget (real encoders)', () => {
  /** Noise: every pixel random, every frame different. Nothing compresses it. */
  function noise(count: number, side: number): Frame[] {
    let state = 12345
    return Array.from({ length: count }, () => {
      const data = new Uint8ClampedArray(side * side * 4)
      for (let at = 0; at < data.length; at += 4) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        data[at] = state >>> 24
        data[at + 1] = (state >>> 16) & 255
        data[at + 2] = (state >>> 8) & 255
        data[at + 3] = 255
      }
      return { data, width: side, height: side, delayMs: 66 }
    })
  }

  it.each(['gif', 'apng'] as const)(
    'cannot fit noise into a tiny budget and says so (%s)',
    async (format) => {
      const result = await fitAnimationToBudget(noise(12, 48), {
        format,
        layout: 'sticker',
        maxBytes: 500,
      })
      if (!result.ok) throw new Error(result.error.detail)
      expect(result.value.withinBudget).toBe(false)
      expect(result.value.encoding.bytes.length).toBeGreaterThan(500)
      expect(result.value.encodes).toBeLessThanOrEqual(LADDER.maxEncodes)
      expect(result.value.fps).toBeGreaterThanOrEqual(LADDER.minFps)
      expect(result.value.steps.length).toBeGreaterThan(0)
    },
  )

  it('fits a modest budget with the real GIF writer', async () => {
    const source = noise(8, 32)
    const first = await fitAnimationToBudget(source, { ...gif, maxBytes: 1e9 })
    if (!first.ok) throw new Error(first.error.detail)
    const full = first.value.encoding.bytes.length
    const limit = Math.floor(full * 0.7)
    const result = await fitAnimationToBudget(source, { ...gif, maxBytes: limit })
    if (!result.ok) throw new Error(result.error.detail)
    expect(result.value.withinBudget).toBe(true)
    expect(result.value.encoding.bytes.length).toBeLessThanOrEqual(limit)
    expect(String.fromCharCode(...result.value.encoding.bytes.subarray(0, 6))).toBe('GIF89a')
  })
})
