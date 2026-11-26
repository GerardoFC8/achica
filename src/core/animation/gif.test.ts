import { describe, expect, it } from 'vitest'
import {
  cloneFrame,
  compositeGif,
  expectedScreens,
  lzwDecode,
  movingSquare,
  noiseFrames,
  parseGif,
  rng,
  setPixel,
  solidFrame,
} from '../../../test/helpers/animation-checks'
import { encodeGif, encodeGifIndexed } from './gif'
import { lzwCompress } from './lzw'
import { quantizeAnimation } from './quantize'
import type { Frame, IndexedAnimation } from './types'

function indexed(frames: Frame[], maxColors = 256, reserve = false): IndexedAnimation {
  const result = quantizeAnimation(frames, { maxColors, reserveTransparent: reserve })
  if (!result.ok) throw new Error(result.error.detail)
  return result.value.animation
}

function write(animation: IndexedAnimation, optimize: boolean) {
  const result = encodeGifIndexed(animation, { optimize })
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail}`)
  return result.value
}

describe('LZW against a reference decoder', () => {
  const cases: Array<[string, number, () => Uint8Array]> = [
    ['empty', 2, () => new Uint8Array(0)],
    ['one pixel', 2, () => new Uint8Array([1])],
    ['a long run', 2, () => new Uint8Array(100_000).fill(3)],
    [
      'two-colour noise',
      2,
      () => Uint8Array.from({ length: 50_000 }, (_, i) => (rng(i)() < 0.5 ? 0 : 1)),
    ],
    [
      '8-bit noise, which fills the table many times',
      8,
      () => {
        const random = rng(5)
        return Uint8Array.from({ length: 200_000 }, () => Math.floor(random() * 256))
      },
    ],
    ['4-bit gradient', 4, () => Uint8Array.from({ length: 70_000 }, (_, i) => (i >> 4) % 16)],
    ['5-bit patterns', 5, () => Uint8Array.from({ length: 30_000 }, (_, i) => (i * i) % 32)],
  ]
  it.each(cases)('round-trips %s', (_name, minCodeSize, make) => {
    const input = make()
    const decoded = lzwDecode(lzwCompress(input, minCodeSize), minCodeSize, input.length)
    expect([...decoded]).toEqual([...input])
  })
})

/** The frames every property is checked on. */
function scenarios(): Array<[string, Frame[], number]> {
  const still = movingSquare(9, 7, 1)
  const identical = [
    movingSquare(9, 7, 1)[0] as Frame,
    movingSquare(9, 7, 1)[0] as Frame,
    movingSquare(9, 7, 1)[0] as Frame,
  ]
  const onePixel = [
    cloneFrame(still[0] as Frame),
    cloneFrame(still[0] as Frame),
    cloneFrame(still[0] as Frame),
  ]
  setPixel(onePixel[1] as Frame, 4, 3, [1, 2, 3, 255])
  setPixel(onePixel[2] as Frame, 4, 3, [1, 2, 3, 255])
  setPixel(onePixel[2] as Frame, 0, 0, [9, 9, 9, 255])
  // Opaque becomes transparent and back: the case that needs disposal 2.
  const blink = [
    solidFrame(5, 5, [200, 0, 0, 255]),
    solidFrame(5, 5, [200, 0, 0, 255]),
    solidFrame(5, 5, [200, 0, 0, 255]),
  ]
  setPixel(blink[1] as Frame, 2, 2, [0, 0, 0, 0])
  setPixel(blink[2] as Frame, 0, 0, [0, 0, 0, 0])
  setPixel(blink[2] as Frame, 2, 2, [0, 200, 0, 255])
  return [
    ['moving square, 12 frames', movingSquare(16, 12, 12), 256],
    ['transparent border', movingSquare(16, 12, 6, { transparentBorder: true }), 256],
    ['blinking transparency', blink, 256],
    ['identical frames', identical, 256],
    ['a single changed pixel', onePixel, 256],
    ['1x1', [solidFrame(1, 1, [5, 6, 7, 255]), solidFrame(1, 1, [7, 6, 5, 255])], 256],
    ['odd size', movingSquare(13, 5, 4), 256],
    ['one frame', still, 256],
    ['two colours', noiseFrames(10, 10, 4, 2), 2],
    ['256 colours', noiseFrames(20, 20, 3, 256), 256],
    ['noise, merged to 8 colours', noiseFrames(20, 20, 3, 200), 8],
  ]
}

describe('GIF structure and pixels', () => {
  it.each(scenarios())(
    '%s decodes identically with and without differencing',
    (_name, frames, maxColors) => {
      const animation = indexed(frames, maxColors)
      const expected = expectedScreens(animation)
      for (const optimize of [false, true]) {
        const { bytes, frameCount } = write(animation, optimize)
        const parsed = parseGif(bytes)
        expect(parsed.frames).toHaveLength(frameCount)
        expect(parsed.loops).toBe(0)
        expect(parsed.width).toBe(animation.width)
        expect(parsed.height).toBe(animation.height)
        const shown = compositeGif(parsed)
        shown.forEach((screen, k) => {
          expect([...screen], `frame ${k}, optimize=${String(optimize)}`).toEqual([
            ...(expected[k] ?? []),
          ])
        })
      }
    },
  )

  it('writes a power-of-two colour table and a legal minimum code size', () => {
    for (const colors of [2, 3, 5, 17, 100, 256]) {
      const frames = noiseFrames(16, 16, 2, colors)
      const parsed = parseGif(write(indexed(frames, colors), false).bytes)
      expect(parsed.tableSize & (parsed.tableSize - 1)).toBe(0)
      expect(parsed.tableSize).toBeGreaterThanOrEqual(colors)
      expect(parsed.tableSize).toBeLessThan(Math.max(4, colors * 2))
    }
  })

  it('crops to the change and makes an empty change a 1x1 frame, keeping the count', () => {
    const frames = [movingSquare(20, 20, 1)[0] as Frame, movingSquare(20, 20, 1)[0] as Frame]
    const { bytes, report } = write(indexed(frames, 256, true), true)
    const parsed = parseGif(bytes)
    expect(parsed.frames).toHaveLength(2)
    expect(parsed.frames[1]).toMatchObject({ width: 1, height: 1, disposal: 1 })
    expect(report.emptyFrames).toBe(1)
    expect(report.optimized).toBe(true)

    const changed = [cloneFrame(frames[0] as Frame), cloneFrame(frames[0] as Frame)]
    setPixel(changed[1] as Frame, 7, 9, [255, 255, 255, 255])
    setPixel(changed[1] as Frame, 8, 10, [255, 255, 255, 255])
    const second = parseGif(write(indexed(changed, 256, true), true).bytes).frames[1]
    expect(second).toMatchObject({ x: 7, y: 9, width: 2, height: 2 })
  })

  it('makes a moving animation smaller with differencing', () => {
    const animation = indexed(movingSquare(64, 64, 20), 256, true)
    const plain = write(animation, false).bytes.length
    const cropped = write(animation, true).bytes.length
    expect(cropped).toBeLessThan(plain / 2)
  })

  it('adds a transparent entry for differencing, or skips it when the palette is full', () => {
    const full = indexed(noiseFrames(60, 60, 2, 256), 256)
    expect(full.palette.length / 3).toBe(256)
    expect(write(full, true).report.optimized).toBe(false)
    const room = indexed(noiseFrames(20, 20, 2, 10), 256)
    const result = write(room, true)
    expect(result.report.optimized).toBe(true)
    expect(parseGif(result.bytes).frames[0]?.transparentIndex).toBe(10)
  })

  it('keeps delays at 20 ms or more, reports what it changed, and keeps total time', () => {
    const delays = [0, 10, 19, 20, 66.7, 66.7, 66.6, 5000]
    const frames = delays.map((delayMs, k) => ({
      ...(noiseFrames(4, 4, 1, 3, k + 1)[0] as Frame),
      delayMs,
    }))
    const { bytes, report } = write(indexed(frames, 4), false)
    const parsed = parseGif(bytes)
    parsed.frames.forEach((frame) => expect(frame.delayCs).toBeGreaterThanOrEqual(2))
    expect(report.writtenDelaysMs).toEqual(parsed.frames.map((frame) => frame.delayCs * 10))
    expect(report.delaysRaisedToMinimum).toBe(2)
    expect(report.delaysAdjusted).toBeGreaterThanOrEqual(4)
    // The carried rounding keeps the 15 fps run within one tick of its request.
    const run = parsed.frames.slice(4, 7).reduce((sum, frame) => sum + frame.delayCs * 10, 0)
    expect(Math.abs(run - 200)).toBeLessThanOrEqual(10)
    expect(parsed.frames[7]?.delayCs).toBe(500)
  })

  it('does not adjust delays that are already whole hundredths of a second', () => {
    const frames = noiseFrames(4, 4, 3, 3).map((frame) => ({ ...frame, delayMs: 100 }))
    const { report } = write(indexed(frames, 4), false)
    expect(report.delaysAdjusted).toBe(0)
    expect(report.delaysRaisedToMinimum).toBe(0)
  })

  it('encodes frames end to end, with dithering and differencing', () => {
    const result = encodeGif(movingSquare(24, 24, 6), {
      maxColors: 16,
      dither: true,
      optimize: true,
    })
    if (!result.ok) throw new Error(result.error.detail)
    expect(result.value.format).toBe('gif')
    expect(result.value.report.dithered).toBe(true)
    expect(parseGif(result.value.bytes).frames).toHaveLength(6)
  })

  it('is deterministic', () => {
    const frames = movingSquare(24, 24, 6, { transparentBorder: true })
    const a = encodeGif(frames, { maxColors: 32, optimize: true })
    const b = encodeGif(frames, { maxColors: 32, optimize: true })
    if (!a.ok || !b.ok) throw new Error('encode failed')
    expect([...a.value.bytes]).toEqual([...b.value.bytes])
  })

  it('returns typed errors for hostile indexed input', () => {
    const good = indexed(noiseFrames(4, 4, 2, 3), 4)
    const code = (animation: unknown): string | undefined => {
      const result = encodeGifIndexed(animation as IndexedAnimation)
      return result.ok ? undefined : result.error.code
    }
    expect(code({ ...good, frames: [] })).toBe('no-frames')
    expect(code({ ...good, frames: null })).toBe('bad-frame-data')
    expect(code({ ...good, width: 0 })).toBe('bad-dimensions')
    expect(code({ ...good, width: 70000 })).toBe('bad-dimensions')
    expect(code({ ...good, palette: new Uint8Array(4) })).toBe('bad-frame-data')
    expect(code({ ...good, palette: new Uint8Array(0) })).toBe('bad-frame-data')
    expect(code({ ...good, palette: new Uint8Array(257 * 3) })).toBe('bad-frame-data')
    expect(code({ ...good, transparentIndex: 99 })).toBe('bad-frame-data')
    expect(code({ ...good, frames: [{ indices: new Uint8Array(3), delayMs: 1 }] })).toBe(
      'size-mismatch',
    )
    expect(code({ ...good, frames: [{ indices: new Uint8Array(16).fill(200), delayMs: 1 }] })).toBe(
      'bad-frame-data',
    )
    expect(code({ ...good, frames: [{ indices: new Uint8Array(16), delayMs: Infinity }] })).toBe(
      'bad-delay',
    )
    const many = { indices: new Uint8Array(16), delayMs: 1 }
    expect(code({ ...good, frames: Array.from({ length: 1001 }, () => many) })).toBe(
      'too-many-frames',
    )
  })
})
