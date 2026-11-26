import { describe, expect, it } from 'vitest'
import {
  cloneFrame,
  compositeApng,
  expectedRgba,
  movingSquare,
  noiseFrames,
  parseApng,
  samePicture,
  setPixel,
  solidFrame,
} from '../../../test/helpers/animation-checks'
import { encodeApng, encodeApngIndexed } from './apng'
import { quantizeAnimation } from './quantize'
import type { Frame, IndexedAnimation } from './types'

function indexed(frames: Frame[], maxColors = 256): IndexedAnimation {
  const result = quantizeAnimation(frames, { maxColors })
  if (!result.ok) throw new Error(result.error.detail)
  return result.value.animation
}

async function write(
  animation: IndexedAnimation,
  optimize: boolean,
  filters: 'adaptive' | 'none' = 'none',
) {
  const result = await encodeApngIndexed(animation, { optimize, filters })
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail}`)
  return result.value
}

const blink = (): Frame[] => {
  const frames = [
    solidFrame(5, 5, [200, 0, 0, 255]),
    solidFrame(5, 5, [200, 0, 0, 255]),
    solidFrame(5, 5, [200, 0, 0, 255]),
  ]
  setPixel(frames[1] as Frame, 2, 2, [0, 0, 0, 0])
  setPixel(frames[2] as Frame, 0, 0, [0, 0, 0, 0])
  return frames
}

const scenarios = (): Array<[string, Frame[], number]> => {
  const still = movingSquare(9, 7, 1)
  const onePixel = [cloneFrame(still[0] as Frame), cloneFrame(still[0] as Frame)]
  setPixel(onePixel[1] as Frame, 4, 3, [1, 2, 3, 255])
  return [
    ['moving square', movingSquare(16, 12, 10), 256],
    ['transparent border', movingSquare(16, 12, 6, { transparentBorder: true }), 256],
    ['blinking transparency', blink(), 256],
    [
      'identical frames',
      [still[0] as Frame, cloneFrame(still[0] as Frame), cloneFrame(still[0] as Frame)],
      256,
    ],
    ['a single changed pixel', onePixel, 256],
    ['1x1', [solidFrame(1, 1, [5, 6, 7, 255]), solidFrame(1, 1, [7, 6, 5, 255])], 256],
    ['odd size, 3 colours (2-bit rows)', noiseFrames(13, 5, 3, 3), 4],
    ['one frame', still, 256],
    ['two colours (1-bit rows)', noiseFrames(11, 9, 3, 2), 2],
    ['16 colours (4-bit rows)', noiseFrames(11, 9, 3, 16), 16],
    ['256 colours', noiseFrames(60, 60, 2, 256), 256],
  ]
}

describe('APNG structure and pixels, indexed', () => {
  it.each(scenarios())(
    '%s decodes identically with and without differencing',
    async (_name, frames, maxColors) => {
      const animation = indexed(frames, maxColors)
      const expected = expectedRgba(animation)
      for (const [optimize, filters] of [
        [false, 'none'],
        [true, 'none'],
        [false, 'adaptive'],
        [true, 'adaptive'],
      ] as const) {
        const { bytes, frameCount } = await write(animation, optimize, filters)
        const parsed = await parseApng(bytes)
        expect(parsed.frameCount).toBe(frameCount)
        expect(parsed.plays).toBe(0)
        expect(parsed.colorType).toBe(3)
        const shown = compositeApng(parsed)
        shown.forEach((screen, k) => {
          expect(
            samePicture(screen, expected[k] ?? []),
            `frame ${k}, optimize=${String(optimize)}, filters=${filters}`,
          ).toBe(true)
        })
      }
    },
  )

  it('picks the smallest bit depth the palette allows', async () => {
    for (const [colors, depth] of [
      [2, 1],
      [3, 2],
      [4, 2],
      [5, 4],
      [16, 4],
      [17, 8],
    ] as const) {
      const frames = noiseFrames(40, 40, 2, colors)
      const parsed = await parseApng((await write(indexed(frames, 256), false)).bytes)
      expect(parsed.depth).toBe(depth)
    }
  })

  it('writes tRNS only when something is transparent, one byte when it is index 0', async () => {
    const plain = await parseApng((await write(indexed(noiseFrames(8, 8, 2, 4)), false)).bytes)
    expect(plain.transparency).toBeNull()
    const holes = await parseApng((await write(indexed(blink()), false)).bytes)
    expect([...(holes.transparency ?? [])]).toEqual([0])
  })

  it('starts with the first frame as the default image and numbers fcTL and fdAT in one sequence', async () => {
    const parsed = await parseApng((await write(indexed(movingSquare(20, 20, 4)), false)).bytes)
    expect(parsed.chunkTypes.slice(0, 2)).toEqual(['IHDR', 'acTL'])
    expect(parsed.chunkTypes.indexOf('fcTL')).toBeLessThan(parsed.chunkTypes.indexOf('IDAT'))
    expect(parsed.chunkTypes.at(-1)).toBe('IEND')
    expect(parsed.frames.map((frame) => frame.sequence).slice(0, 1)).toEqual([0])
  })

  it('crops to the change and keeps an unchanged frame as a 1x1', async () => {
    const frames = [
      movingSquare(20, 20, 1)[0] as Frame,
      cloneFrame(movingSquare(20, 20, 1)[0] as Frame),
    ]
    const same = await write(indexed(frames), true)
    const parsedSame = await parseApng(same.bytes)
    expect(parsedSame.frames[1]).toMatchObject({ width: 1, height: 1 })
    expect(same.report.emptyFrames).toBe(1)

    setPixel(frames[1] as Frame, 7, 9, [255, 255, 255, 255])
    const parsed = await parseApng((await write(indexed(frames), true)).bytes)
    expect(parsed.frames[1]).toMatchObject({
      x: 7,
      y: 9,
      width: 1,
      height: 1,
      dispose: 0,
      blend: 0,
    })
  })

  it('makes a moving animation smaller with differencing', async () => {
    const animation = indexed(movingSquare(64, 64, 20))
    const plain = (await write(animation, false)).bytes.length
    const cropped = (await write(animation, true)).bytes.length
    expect(cropped).toBeLessThan(plain / 2)
  })

  it('writes exact millisecond delays as a fraction over 1000', async () => {
    const frames = [10, 33, 67, 1000].map((delayMs, k) => ({
      ...(noiseFrames(4, 4, 1, 3, k + 1)[0] as Frame),
      delayMs,
    }))
    const result = await write(indexed(frames, 4), false)
    const parsed = await parseApng(result.bytes)
    expect(parsed.frames.map((frame) => [frame.delayNum, frame.delayDen])).toEqual([
      [10, 1000],
      [33, 1000],
      [67, 1000],
      [1000, 1000],
    ])
    expect(result.report.delaysAdjusted).toBe(0)
    expect(result.report.writtenDurationMs).toBe(1110)
  })

  it('reports a delay it had to round or cap', async () => {
    const frames = [12.4, 70000].map((delayMs) => ({
      ...(noiseFrames(3, 3, 1, 2)[0] as Frame),
      delayMs,
    }))
    const result = await write(indexed(frames, 2), false)
    expect(result.report.delaysAdjusted).toBe(2)
    expect(result.report.writtenDelaysMs).toEqual([12, 65535])
  })

  it('splits a large frame over several data chunks, all in sequence', async () => {
    // Noise does not compress, so 300x300 of it is far over one 64 KB chunk.
    const frames = noiseFrames(300, 300, 2, 256, 4)
    const parsed = await parseApng((await write(indexed(frames, 256), false)).bytes)
    expect(parsed.chunkTypes.filter((type) => type === 'IDAT').length).toBeGreaterThan(1)
    expect(parsed.chunkTypes.filter((type) => type === 'fdAT').length).toBeGreaterThan(1)
  })

  it('defaults to no row filter for indexed frames and to adaptive for rgba', async () => {
    const frames = movingSquare(64, 64, 2)
    const indexedResult = await encodeApng(frames, { maxColors: 64 })
    if (!indexedResult.ok) throw new Error('encode failed')
    expect([...(await parseApng(indexedResult.value.bytes)).filtersUsed]).toEqual([0])
    const adaptive = await encodeApng(frames, { maxColors: 64, filters: 'adaptive' })
    if (!adaptive.ok) throw new Error('encode failed')
    expect((await parseApng(adaptive.value.bytes)).filtersUsed.size).toBeGreaterThan(1)
  })

  it('is deterministic', async () => {
    const frames = movingSquare(24, 24, 5, { transparentBorder: true })
    const a = await encodeApng(frames, { maxColors: 32, optimize: true })
    const b = await encodeApng(frames, { maxColors: 32, optimize: true })
    if (!a.ok || !b.ok) throw new Error('encode failed')
    expect([...a.value.bytes]).toEqual([...b.value.bytes])
  })

  it('uses more than one row filter on a smooth image, and none when asked not to', async () => {
    const frames = movingSquare(64, 64, 2)
    const adaptive = await encodeApng(frames, { mode: 'rgba' })
    const plain = await encodeApng(frames, { mode: 'rgba', filters: 'none' })
    if (!adaptive.ok || !plain.ok) throw new Error('encode failed')
    expect((await parseApng(adaptive.value.bytes)).filtersUsed.size).toBeGreaterThan(1)
    expect([...(await parseApng(plain.value.bytes)).filtersUsed]).toEqual([0])
    expect(adaptive.value.bytes.length).toBeLessThan(plain.value.bytes.length)
  })
})

describe('APNG, rgba mode', () => {
  const partial = (): Frame[] => {
    const frames = movingSquare(14, 10, 5)
    // Semi-transparent pixels, which the indexed modes cannot keep.
    frames.forEach((frame, k) => {
      for (let x = 0; x < 14; x += 1) setPixel(frame, x, 9, [10 * k, 100, 200, (x * 19) % 256])
    })
    return frames
  }

  it.each([false, true])(
    'keeps every byte, partial alpha included (optimize=%s)',
    async (optimize) => {
      const frames = partial()
      const result = await encodeApng(frames, { mode: 'rgba', optimize })
      if (!result.ok) throw new Error(result.error.detail)
      const parsed = await parseApng(result.value.bytes)
      expect(parsed.colorType).toBe(6)
      expect(parsed.palette).toBeNull()
      const shown = compositeApng(parsed)
      shown.forEach((screen, k) => expect([...screen]).toEqual([...(frames[k]?.data ?? [])]))
      expect(result.value.report.paletteColors).toBeNull()
      expect(result.value.report.transparent).toBe(true)
    },
  )

  it('differencing makes it smaller', async () => {
    const frames = movingSquare(64, 64, 12)
    const plain = await encodeApng(frames, { mode: 'rgba' })
    const cropped = await encodeApng(frames, { mode: 'rgba', optimize: true })
    if (!plain.ok || !cropped.ok) throw new Error('encode failed')
    expect(cropped.value.bytes.length).toBeLessThan(plain.value.bytes.length / 2)
  })

  it('handles 1x1 and a single frame', async () => {
    const result = await encodeApng([solidFrame(1, 1, [1, 2, 3, 4])], {
      mode: 'rgba',
      optimize: true,
    })
    if (!result.ok) throw new Error('encode failed')
    const parsed = await parseApng(result.value.bytes)
    expect([...(compositeApng(parsed)[0] ?? [])]).toEqual([1, 2, 3, 4])
  })
})

describe('APNG errors', () => {
  it('returns typed errors for hostile input and never throws', async () => {
    const ok = solidFrame(2, 2, [0, 0, 0, 255])
    const code = async (frames: unknown, options: object = {}): Promise<string | undefined> => {
      const result = await encodeApng(frames as never, options)
      return result.ok ? undefined : result.error.code
    }
    expect(await code([])).toBe('no-frames')
    expect(await code(undefined)).toBe('bad-frame-data')
    expect(await code([ok], { mode: 'cmyk' })).toBe('bad-option')
    expect(await code([ok], { mode: 'rgba' })).toBeUndefined()
    expect(await code([], { mode: 'rgba' })).toBe('no-frames')
    expect(await code([ok, solidFrame(3, 3, [0, 0, 0, 255])], { mode: 'rgba' })).toBe(
      'size-mismatch',
    )
    expect(await code([{ ...ok, delayMs: NaN }], { mode: 'rgba' })).toBe('bad-delay')
    expect(await code([{ ...ok, width: 5000 }], { mode: 'rgba' })).toBe('bad-dimensions')
    expect(
      await code(
        Array.from({ length: 1001 }, () => ok),
        { mode: 'rgba' },
      ),
    ).toBe('too-many-frames')
    expect(await code([ok], { maxColors: 1 })).toBe('bad-option')

    const good = indexed(noiseFrames(4, 4, 2, 3), 4)
    const hostile = async (animation: unknown): Promise<string | undefined> => {
      const result = await encodeApngIndexed(animation as IndexedAnimation)
      return result.ok ? undefined : result.error.code
    }
    expect(await hostile({ ...good, palette: new Uint8Array(5) })).toBe('bad-frame-data')
    expect(await hostile({ ...good, transparentIndex: 40 })).toBe('bad-frame-data')
    expect(
      await hostile({ ...good, frames: [{ indices: new Uint8Array(16).fill(9), delayMs: 1 }] }),
    ).toBe('bad-frame-data')
  })
})
