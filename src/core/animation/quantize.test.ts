import { describe, expect, it } from 'vitest'
import {
  cloneFrame,
  movingSquare,
  noiseFrames,
  rng,
  setPixel,
  solidFrame,
} from '../../../test/helpers/animation-checks'
import { quantizeAnimation } from './quantize'
import { LIMITS } from './validate'

const quantize = (...args: Parameters<typeof quantizeAnimation>) => {
  const result = quantizeAnimation(...args)
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail}`)
  return result.value
}

describe('quantizeAnimation', () => {
  it('keeps every colour when they fit, so the result is exact', () => {
    const frames = noiseFrames(8, 8, 3, 5)
    const { animation, report } = quantize(frames, { maxColors: 16 })
    expect(report.exact).toBe(true)
    expect(report.colors).toBe(5)
    expect(animation.transparentIndex).toBeNull()
    // Each pixel maps back to precisely its own colour.
    animation.frames.forEach((frame, k) => {
      frame.indices.forEach((index, p) => {
        const rgba = frames[k]?.data.subarray(p * 4, p * 4 + 3)
        expect([...animation.palette.subarray(index * 3, index * 3 + 3)]).toEqual([...(rgba ?? [])])
      })
    })
  })

  it('never exceeds maxColors, transparent entry included, from 2 to 256', () => {
    const frames = noiseFrames(40, 40, 2, 300)
    for (const maxColors of [2, 3, 16, 255, 256]) {
      const { animation } = quantize(frames, { maxColors })
      expect(animation.palette.length / 3).toBeLessThanOrEqual(maxColors)
      for (const frame of animation.frames) {
        expect(Math.max(...frame.indices)).toBeLessThan(animation.palette.length / 3)
      }
    }
    const transparent = movingSquare(12, 12, 2, { transparentBorder: true })
    const { animation } = quantize(transparent, { maxColors: 4 })
    expect(animation.palette.length / 3).toBeLessThanOrEqual(4)
    expect(animation.transparentIndex).toBe(0)
  })

  it('uses a 128 alpha threshold: below is transparent, at or above is opaque', () => {
    const frame = solidFrame(2, 1, [10, 20, 30, 255])
    setPixel(frame, 0, 0, [10, 20, 30, 127])
    setPixel(frame, 1, 0, [10, 20, 30, 128])
    const { animation } = quantize([frame])
    expect(animation.transparentIndex).toBe(0)
    expect(animation.frames[0]?.indices[0]).toBe(0)
    expect(animation.frames[0]?.indices[1]).not.toBe(0)
  })

  it('reserves a transparent index on request even when no pixel needs it', () => {
    const { animation, report } = quantize([solidFrame(2, 2, [1, 2, 3, 255])], {
      reserveTransparent: true,
    })
    expect(animation.transparentIndex).toBe(0)
    expect(report.transparent).toBe(true)
  })

  it('is deterministic, with and without dithering', () => {
    const frames = noiseFrames(30, 30, 3, 200, 9)
    for (const dither of [false, true]) {
      const a = quantize(frames, { maxColors: 8, dither })
      const b = quantize(frames, { maxColors: 8, dither })
      expect([...a.animation.palette]).toEqual([...b.animation.palette])
      a.animation.frames.forEach((frame, k) => {
        expect([...frame.indices]).toEqual([...(b.animation.frames[k]?.indices ?? [])])
      })
    }
  })

  it('dithering changes the indices but keeps them inside the palette', () => {
    const data = new Uint8ClampedArray(32 * 32 * 4)
    for (let p = 0; p < 32 * 32; p += 1) data.set([(p % 32) * 8, 100, 50, 255], p * 4)
    const frame = { data, width: 32, height: 32, delayMs: 50 }
    const plain = quantize([frame], { maxColors: 4 })
    const dithered = quantize([frame], { maxColors: 4, dither: true })
    expect(dithered.report.dithered).toBe(true)
    expect([...(dithered.animation.frames[0]?.indices ?? [])]).not.toEqual([
      ...(plain.animation.frames[0]?.indices ?? []),
    ])
    expect(Math.max(...(dithered.animation.frames[0]?.indices ?? []))).toBeLessThan(4)
  })

  it('handles sizes of 1x1 and an animation of one frame', () => {
    const { animation } = quantize([solidFrame(1, 1, [9, 9, 9, 255])])
    expect(animation.frames).toHaveLength(1)
    expect(animation.palette.length).toBe(3)
  })

  it('returns typed errors for hostile input and never throws', () => {
    const ok = solidFrame(2, 2, [0, 0, 0, 255])
    const code = (frames: unknown, options: object = {}): string | undefined => {
      const result = quantizeAnimation(frames as never, options)
      return result.ok ? undefined : result.error.code
    }
    expect(code([])).toBe('no-frames')
    expect(code(null)).toBe('bad-frame-data')
    expect(code([null])).toBe('no-frames')
    expect(code([ok], { maxColors: 1 })).toBe('bad-option')
    expect(code([ok], { maxColors: 257 })).toBe('bad-option')
    expect(code([ok], { maxColors: 2.5 })).toBe('bad-option')
    expect(code([ok, solidFrame(3, 3, [0, 0, 0, 255])])).toBe('size-mismatch')
    expect(code([{ ...ok, delayMs: NaN }])).toBe('bad-delay')
    expect(code([{ ...ok, delayMs: -1 }])).toBe('bad-delay')
    expect(code([{ ...ok, data: new Uint8ClampedArray(3) }])).toBe('bad-frame-data')
    expect(code([{ ...ok, data: new Uint8Array(16) }])).toBe('bad-frame-data')
    expect(code([{ ...ok, width: 0 }])).toBe('bad-dimensions')
    expect(code([{ ...ok, width: 1.5 }])).toBe('bad-dimensions')
    expect(code([{ ...ok, width: LIMITS.maxDimension + 1 }])).toBe('bad-dimensions')
    expect(code([{ ...ok, width: NaN }])).toBe('bad-dimensions')
    expect(code(Array.from({ length: LIMITS.maxFrames + 1 }, () => ok))).toBe('too-many-frames')
    const wide = { data: new Uint8ClampedArray(0), width: 4096, height: 4096, delayMs: 10 }
    expect(code(Array.from({ length: 9 }, () => wide))).toBe('too-large')
  })

  it('does not mutate its input', () => {
    const frames = movingSquare(10, 10, 3)
    const copies = frames.map((frame) => cloneFrame(frame))
    quantize(frames, { maxColors: 4, dither: true })
    frames.forEach((frame, k) => expect([...frame.data]).toEqual([...(copies[k]?.data ?? [])]))
  })

  it('samples large inputs without losing the common colours', () => {
    // 60 frames of 200x200 is over the sample cap; two big flat colours must survive.
    const random = rng(3)
    const frames = Array.from({ length: 60 }, () => {
      const frame = solidFrame(200, 200, [200, 30, 30, 255])
      for (let y = 100; y < 200; y += 1)
        for (let x = 0; x < 200; x += 1) setPixel(frame, x, y, [20, 30, 220, 255])
      setPixel(frame, Math.floor(random() * 200), 0, [0, 255, 0, 255])
      return frame
    })
    const { animation } = quantize(frames, { maxColors: 2 })
    const reds = [...animation.palette]
    expect(reds).toHaveLength(6)
    const first = animation.frames[0]?.indices
    expect(first?.[0]).not.toBe(first?.[199 * 200])
  })
})
