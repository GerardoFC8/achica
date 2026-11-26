import { describe, expect, it } from 'vitest'
import {
  animationScenarios,
  expectedRgba,
  movingSquare,
  samePicture,
  setPixel,
  solidFrame,
} from '../../../test/helpers/animation-checks'
import { encodeApngIndexed, encodeApng } from './apng'
import { encodeGifIndexed, encodeGif } from './gif'
import { quantizeAnimation } from './quantize'
import type { Frame, IndexedAnimation } from './types'

/**
 * The browser is the oracle: what these tests compare against is what a
 * viewer paints, decoded by the platform's own GIF and PNG decoders through
 * ImageDecoder, not by anything in this repository. Both formats are
 * lossless once quantised and alpha is binary, so the pixels must match the
 * indexed frames exactly.
 */

type Decoded = { width: number; height: number; rgba: Uint8ClampedArray; durationUs: number }

async function decode(bytes: Uint8Array<ArrayBuffer>, type: string): Promise<Decoded[]> {
  const decoder = new ImageDecoder({ data: bytes, type })
  await decoder.completed
  await decoder.tracks.ready
  const count = decoder.tracks.selectedTrack?.frameCount ?? 0
  const frames: Decoded[] = []
  for (let frameIndex = 0; frameIndex < count; frameIndex += 1) {
    const { image } = await decoder.decode({ frameIndex, completeFramesOnly: true })
    const width = image.displayWidth
    const height = image.displayHeight
    const rgba = new Uint8ClampedArray(width * height * 4)
    // Ask for straight RGBA explicitly so the comparison does not depend on the decoder's native layout.
    await image.copyTo(rgba, { format: 'RGBA' } as VideoFrameCopyToOptions)
    frames.push({ width, height, rgba, durationUs: image.duration ?? 0 })
    image.close()
  }
  decoder.close()
  return frames
}

function indexed(frames: Frame[], maxColors: number): IndexedAnimation {
  const result = quantizeAnimation(frames, { maxColors })
  if (!result.ok) throw new Error(result.error.detail)
  return result.value.animation
}

describe('GIF as the browser decodes it', () => {
  it.each(animationScenarios())(
    '%s: frame count, delays and pixels',
    async (_name, frames, maxColors) => {
      const animation = indexed(frames, maxColors)
      const expected = expectedRgba(animation)
      for (const optimize of [false, true]) {
        const result = encodeGifIndexed(animation, { optimize })
        if (!result.ok) throw new Error(result.error.detail)
        const decoded = await decode(result.value.bytes, 'image/gif')
        expect(decoded).toHaveLength(animation.frames.length)
        decoded.forEach((frame, k) => {
          expect(frame.width).toBe(animation.width)
          expect(frame.height).toBe(animation.height)
          expect(frame.durationUs, `delay of frame ${k}`).toBe(
            (result.value.report.writtenDelaysMs[k] ?? 0) * 1000,
          )
          expect(
            samePicture(frame.rgba, expected[k] ?? []),
            `pixels of frame ${k}, optimize=${String(optimize)}`,
          ).toBe(true)
        })
      }
    },
  )

  it('plays delays in whole hundredths with a 20 ms floor, as reported', async () => {
    const frames = [0, 10, 19, 20, 70, 1000].map((delayMs, k) => ({
      ...solidFrame(2, 2, [k * 30, 0, 0, 255]),
      delayMs,
    }))
    const result = encodeGif(frames, { maxColors: 8 })
    if (!result.ok) throw new Error(result.error.detail)
    const decoded = await decode(result.value.bytes, 'image/gif')
    expect(decoded.map((frame) => frame.durationUs / 1000)).toEqual([20, 20, 20, 20, 70, 1000])
    expect(result.value.report.writtenDelaysMs).toEqual([20, 20, 20, 20, 70, 1000])
  })

  it('end to end with dithering and differencing, on a moving, transparent animation', async () => {
    const frames = movingSquare(40, 30, 8, { transparentBorder: true })
    const result = encodeGif(frames, { maxColors: 16, dither: true, optimize: true })
    if (!result.ok) throw new Error(result.error.detail)
    const quantized = quantizeAnimation(frames, {
      maxColors: 16,
      dither: true,
      reserveTransparent: true,
    })
    if (!quantized.ok) throw new Error(quantized.error.detail)
    const expected = expectedRgba(quantized.value.animation)
    const decoded = await decode(result.value.bytes, 'image/gif')
    expect(decoded).toHaveLength(8)
    decoded.forEach((frame, k) => expect(samePicture(frame.rgba, expected[k] ?? [])).toBe(true))
  })
})

describe('APNG as the browser decodes it', () => {
  it('reports what the browser does with a 10 ms delay (Firefox plays it as 100 ms)', async () => {
    const frames = [10, 10].map((delayMs, k) => ({
      ...solidFrame(2, 2, [k * 30, 0, 0, 255]),
      delayMs,
    }))
    const result = await encodeApng(frames, { maxColors: 8 })
    if (!result.ok) throw new Error(result.error.detail)
    const decoded = await decode(result.value.bytes, 'image/png')
    // Not an assertion about our bytes, which say 10/1000: a record of the decoder.
    expect([10, 100]).toContain(
      decoded[0]?.durationUs === undefined ? NaN : decoded[0].durationUs / 1000,
    )
  })

  it.each(animationScenarios())(
    '%s: frame count, delays and pixels (indexed)',
    async (_name, frames, maxColors) => {
      const animation = indexed(frames, maxColors)
      const expected = expectedRgba(animation)
      for (const [optimize, filters] of [
        [false, 'none'],
        [true, 'none'],
        [true, 'adaptive'],
      ] as const) {
        const result = await encodeApngIndexed(animation, { optimize, filters })
        if (!result.ok) throw new Error(result.error.detail)
        const decoded = await decode(result.value.bytes, 'image/png')
        expect(decoded).toHaveLength(animation.frames.length)
        decoded.forEach((frame, k) => {
          // Chromium reports a one-frame APNG as a still image, with no duration.
          if (decoded.length > 1) {
            expect(frame.durationUs, `delay of frame ${k}`).toBe(
              (animation.frames[k]?.delayMs ?? 0) * 1000,
            )
          }
          expect(
            samePicture(frame.rgba, expected[k] ?? []),
            `pixels of frame ${k}, optimize=${String(optimize)}`,
          ).toBe(true)
        })
      }
    },
  )

  it('keeps exact millisecond delays from 20 ms up', async () => {
    const frames = [20, 33, 67, 1000].map((delayMs, k) => ({
      ...solidFrame(2, 2, [k * 30, 0, 0, 255]),
      delayMs,
    }))
    const result = await encodeApng(frames, { maxColors: 8 })
    if (!result.ok) throw new Error(result.error.detail)
    const decoded = await decode(result.value.bytes, 'image/png')
    expect(decoded.map((frame) => frame.durationUs / 1000)).toEqual([20, 33, 67, 1000])
  })

  it.each([false, true])('rgba mode keeps colour and alpha (optimize=%s)', async (optimize) => {
    const frames = movingSquare(20, 14, 5)
    frames.forEach((frame, k) => {
      for (let x = 0; x < 20; x += 1) setPixel(frame, x, 13, [10 * k, 100, 200, (x * 13) % 256])
      setPixel(frame, 0, 0, [0, 0, 0, 0])
    })
    const result = await encodeApng(frames, { mode: 'rgba', optimize })
    if (!result.ok) throw new Error(result.error.detail)
    const decoded = await decode(result.value.bytes, 'image/png')
    expect(decoded).toHaveLength(5)
    decoded.forEach((frame, k) => {
      const source = frames[k]?.data ?? new Uint8ClampedArray(0)
      for (let at = 0; at < source.length; at += 4) {
        const alpha = source[at + 3] ?? 0
        expect(frame.rgba[at + 3], `alpha at ${at / 4} of frame ${k}`).toBe(alpha)
        if (alpha === 0) continue
        // copyTo does not agree between browsers on partial alpha: Chromium
        // returns straight colour (within the rounding of its premultiplied
        // surface) and Firefox returns the premultiplied values as they are.
        // Either is the right picture; anything else is not.
        for (let c = 0; c < 3; c += 1) {
          const got = frame.rgba[at + c] ?? 0
          const want = source[at + c] ?? 0
          const straight = Math.abs(got - want) <= (alpha === 255 ? 0 : Math.ceil(255 / alpha) + 1)
          const premultiplied = alpha < 255 && Math.abs(got - (want * alpha) / 255) <= 1
          expect(straight || premultiplied, `c${c} alpha ${alpha} got ${got} want ${want}`).toBe(
            true,
          )
        }
      }
    })
  })
})
