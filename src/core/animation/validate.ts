import { err, ok, type Result } from '../result'
import type { EncodeError, Frame, IndexedAnimation } from './types'

/**
 * Hard ceilings, so hostile or absurd input becomes a typed error before it
 * becomes an allocation. They are generous for the real use (a 320 px sticker
 * is about 0.1 megapixel per frame) and small enough that nothing here can
 * exhaust memory.
 */
export const LIMITS = {
  maxDimension: 4096,
  maxFrames: 1000,
  /** Pixels summed over every frame. */
  maxTotalPixels: 2 ** 27,
} as const

const fail = (code: EncodeError['code'], detail: string): Result<never, EncodeError> =>
  err({ code, detail })

const isDimension = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= LIMITS.maxDimension

export function validateSize(
  width: unknown,
  height: unknown,
  frameCount: number,
): Result<{ width: number; height: number }, EncodeError> {
  if (frameCount < 1) return fail('no-frames', 'the animation has no frames')
  if (frameCount > LIMITS.maxFrames) {
    return fail('too-many-frames', `${frameCount} frames, the limit is ${LIMITS.maxFrames}`)
  }
  if (!isDimension(width) || !isDimension(height)) {
    return fail(
      'bad-dimensions',
      `${String(width)}x${String(height)} is not between 1 and ${LIMITS.maxDimension} pixels`,
    )
  }
  if (width * height * frameCount > LIMITS.maxTotalPixels) {
    return fail('too-large', `${width}x${height} over ${frameCount} frames is too many pixels`)
  }
  return ok({ width, height })
}

const validDelay = (value: unknown): boolean =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

export function validateFrames(
  frames: readonly Frame[],
): Result<{ width: number; height: number }, EncodeError> {
  if (!Array.isArray(frames)) return fail('bad-frame-data', 'frames is not an array')
  const first = frames[0]
  if (first === undefined || first === null || typeof first !== 'object') {
    return fail('no-frames', 'the animation has no frames')
  }
  const size = validateSize(first.width, first.height, frames.length)
  if (!size.ok) return size
  const { width, height } = size.value
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index]
    if (frame === undefined || frame === null || typeof frame !== 'object') {
      return fail('bad-frame-data', `frame ${index} is not an object`)
    }
    if (frame.width !== width || frame.height !== height) {
      return fail('size-mismatch', `frame ${index} is not ${width}x${height}`)
    }
    if (!(frame.data instanceof Uint8ClampedArray) || frame.data.length !== width * height * 4) {
      return fail('bad-frame-data', `frame ${index} does not hold ${width * height * 4} RGBA bytes`)
    }
    if (!validDelay(frame.delayMs)) {
      return fail('bad-delay', `frame ${index} has a delay that is not a non-negative number`)
    }
  }
  return size
}

export function validateIndexed(animation: IndexedAnimation): Result<void, EncodeError> {
  const frames = animation.frames
  if (!Array.isArray(frames)) return fail('bad-frame-data', 'frames is not an array')
  const size = validateSize(animation.width, animation.height, frames.length)
  if (!size.ok) return size
  const { width, height } = size.value
  const palette = animation.palette
  if (!(palette instanceof Uint8Array) || palette.length % 3 !== 0) {
    return fail('bad-frame-data', 'the palette is not a whole number of RGB triples')
  }
  const colors = palette.length / 3
  if (colors < 1 || colors > 256) {
    return fail('bad-frame-data', `the palette has ${colors} entries, it must have 1 to 256`)
  }
  const transparent = animation.transparentIndex
  if (
    transparent !== null &&
    !(Number.isInteger(transparent) && transparent >= 0 && transparent < colors)
  ) {
    return fail('bad-frame-data', 'the transparent index is outside the palette')
  }
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index]
    if (frame === undefined || frame === null) {
      return fail('bad-frame-data', `frame ${index} is missing`)
    }
    if (!(frame.indices instanceof Uint8Array) || frame.indices.length !== width * height) {
      return fail('size-mismatch', `frame ${index} does not hold ${width * height} indices`)
    }
    if (!validDelay(frame.delayMs)) {
      return fail('bad-delay', `frame ${index} has a delay that is not a non-negative number`)
    }
    for (let at = 0; at < frame.indices.length; at += 1) {
      if ((frame.indices[at] ?? 0) >= colors) {
        return fail('bad-frame-data', `frame ${index} uses an index outside the palette`)
      }
    }
  }
  return ok(undefined)
}

export function validateMaxColors(value: unknown): Result<number, EncodeError> {
  if (value === undefined) return ok(256)
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 2 || value > 256) {
    return fail('bad-option', 'maxColors must be an integer from 2 to 256')
  }
  return ok(value)
}
