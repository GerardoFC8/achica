import { err, ok, type Result } from '../result'
import { createByteWriter } from './bytes'
import { changedRect } from './diff'
import { lzwImageData } from './lzw'
import { quantizeAnimation, type QuantizeOptions } from './quantize'
import type { AnimationEncoding, EncodeError, Frame, IndexedAnimation } from './types'
import { validateIndexed } from './validate'

/**
 * GIF89a writer: one global colour table, LZW, infinite loop.
 *
 * Delays. A GIF delay is in hundredths of a second, and browsers treat a
 * delay below 20 ms as 100 ms, so the floor is 2. Rounding each frame on its
 * own would make 15 fps (66.7 ms) play 4.5 % slow, so the rounding error is
 * carried into the next frame and the total duration stays within one
 * hundredth of the request. A delay raised to the floor is not paid back by
 * the frames that follow.
 *
 * Frame differencing. With `optimize`, each frame is cropped to the rectangle
 * that changed against what the screen shows, and unchanged pixels inside it
 * are written as the transparent index, which compresses to almost nothing.
 * The disposal method is "do not dispose" (1), with one exception that is
 * easy to get wrong: a pixel that was opaque and must become transparent
 * cannot be expressed by drawing transparent over it. Such a frame k-1 is
 * marked "restore to background" (2) and is written full-canvas, so the
 * screen is clean again before frame k. Without `optimize`, an animation with
 * transparency uses disposal 2 on every frame, for the same reason.
 */

export type GifOptions = {
  /** Crop each frame to what changed. Needs a transparent index; one is added if the palette has room. */
  readonly optimize?: boolean
}

type Piece = {
  x: number
  y: number
  width: number
  height: number
  pixels: Uint8Array
  disposal: 1 | 2
}

function plan(
  animation: IndexedAnimation,
  optimize: boolean,
  transparent: number | null,
): { pieces: Piece[]; empty: number } {
  const { width, height, frames } = animation
  const pixelCount = width * height
  const pieces: Piece[] = []
  let empty = 0

  if (!optimize || transparent === null) {
    // Whole frames. Transparent pixels need the screen cleared after each frame.
    let usesTransparency = false
    if (transparent !== null) {
      usesTransparency = frames.some((frame) => frame.indices.includes(transparent))
    }
    for (const frame of frames) {
      pieces.push({
        x: 0,
        y: 0,
        width,
        height,
        pixels: frame.indices,
        disposal: usesTransparency ? 2 : 1,
      })
    }
    return { pieces, empty }
  }

  // Which frames must clear the screen afterwards (see the header comment).
  const clears = frames.map((frame, k) => {
    const following = frames[k + 1]
    if (following === undefined) return false
    for (let p = 0; p < pixelCount; p += 1) {
      if (frame.indices[p] !== transparent && following.indices[p] === transparent) return true
    }
    return false
  })

  let screen = new Uint8Array(pixelCount).fill(transparent)
  frames.forEach((frame, k) => {
    const target = frame.indices
    const clearing = clears[k] === true
    let rect = changedRect(screen, target, width, height, 1)
    if (k === 0 || clearing) rect = { x: 0, y: 0, width, height }
    let piece: Piece
    if (rect === null) {
      empty += 1
      piece = {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        pixels: new Uint8Array([transparent]),
        disposal: 1,
      }
    } else {
      const pixels = new Uint8Array(rect.width * rect.height)
      for (let y = 0; y < rect.height; y += 1) {
        for (let x = 0; x < rect.width; x += 1) {
          const at = (rect.y + y) * width + rect.x + x
          const value = target[at] ?? transparent
          pixels[y * rect.width + x] = value === screen[at] ? transparent : value
        }
      }
      piece = { ...rect, pixels, disposal: clearing ? 2 : 1 }
    }
    pieces.push(piece)
    screen = clearing ? new Uint8Array(pixelCount).fill(transparent) : Uint8Array.from(target)
  })
  return { pieces, empty }
}

/** Writes an already quantised animation. */
export function encodeGifIndexed(
  input: IndexedAnimation,
  options: GifOptions = {},
): Result<AnimationEncoding, EncodeError> {
  const valid = validateIndexed(input)
  if (!valid.ok) return valid

  let animation = input
  let optimize = options.optimize === true
  if (optimize && animation.transparentIndex === null) {
    const colors = animation.palette.length / 3
    if (colors < 256) {
      const palette = new Uint8Array(animation.palette.length + 3)
      palette.set(animation.palette)
      animation = { ...animation, palette, transparentIndex: colors }
    } else {
      optimize = false
    }
  }
  const transparent = animation.transparentIndex
  const { width, height, palette, frames } = animation
  const colors = palette.length / 3
  const { pieces, empty } = plan(animation, optimize, transparent)

  let tableBits = 1
  while (1 << tableBits < colors) tableBits += 1
  const tableSize = 1 << tableBits
  const minCodeSize = Math.max(2, tableBits)

  const out = createByteWriter(1 << 16)
  out.ascii('GIF89a')
  out.u16le(width)
  out.u16le(height)
  out.byte(0x80 | (7 << 4) | (tableBits - 1)) // global table, 8-bit colour, size
  out.byte(transparent ?? 0) // background colour index
  out.byte(0) // pixel aspect ratio: unspecified
  out.bytes(palette)
  for (let i = colors * 3; i < tableSize * 3; i += 1) out.byte(0)
  // Looping extension. Without it a GIF plays once. The count 0 means forever.
  out.byte(0x21)
  out.byte(0xff)
  out.byte(11)
  out.ascii('NETSCAPE2.0')
  out.byte(3)
  out.byte(1)
  out.u16le(0)
  out.byte(0)

  let requested = 0
  let written = 0
  let residual = 0
  let adjusted = 0
  let raised = 0
  const writtenDelays: number[] = []
  pieces.forEach((piece, k) => {
    const delayMs = frames[k]?.delayMs ?? 0
    requested += delayMs
    const exact = delayMs + residual
    let centiseconds = Math.round(exact / 10)
    if (centiseconds < 2) {
      // Below the floor, the shortfall is not carried: shortening the next
      // frames to pay for a floor would change frames the user did not touch.
      centiseconds = 2
      raised += 1
      residual = 0
    } else {
      if (centiseconds > 0xffff) centiseconds = 0xffff
      residual = exact - centiseconds * 10
    }
    written += centiseconds * 10
    writtenDelays.push(centiseconds * 10)
    if (centiseconds * 10 !== delayMs) adjusted += 1

    // Graphic control extension: disposal, transparency flag, delay.
    out.byte(0x21)
    out.byte(0xf9)
    out.byte(4)
    out.byte((piece.disposal << 2) | (transparent !== null ? 1 : 0))
    out.u16le(centiseconds)
    out.byte(transparent ?? 0)
    out.byte(0)
    // Image descriptor, no local table, not interlaced.
    out.byte(0x2c)
    out.u16le(piece.x)
    out.u16le(piece.y)
    out.u16le(piece.width)
    out.u16le(piece.height)
    out.byte(0)
    out.bytes(lzwImageData(piece.pixels, minCodeSize))
  })
  out.byte(0x3b)

  const usesTransparency =
    transparent !== null && frames.some((frame) => frame.indices.includes(transparent))
  return ok({
    format: 'gif',
    bytes: out.finish(),
    frameCount: frames.length,
    width,
    height,
    report: {
      paletteColors: colors - (transparent !== null ? 1 : 0),
      exactPalette: null,
      transparent: usesTransparency,
      dithered: false,
      optimized: optimize,
      emptyFrames: empty,
      delaysAdjusted: adjusted,
      delaysRaisedToMinimum: raised,
      writtenDelaysMs: writtenDelays,
      requestedDurationMs: requested,
      writtenDurationMs: written,
    },
  })
}

/** Quantises and writes. */
export function encodeGif(
  frames: readonly Frame[],
  options: GifOptions & QuantizeOptions = {},
): Result<AnimationEncoding, EncodeError> {
  const optimize = options.optimize === true
  const quantized = quantizeAnimation(frames, {
    ...options,
    reserveTransparent: optimize || options.reserveTransparent === true,
  })
  if (!quantized.ok) return quantized
  const encoded = encodeGifIndexed(quantized.value.animation, { optimize })
  if (!encoded.ok) return err(encoded.error)
  const { report } = quantized.value
  return ok({
    ...encoded.value,
    report: {
      ...encoded.value.report,
      paletteColors: report.colors,
      exactPalette: report.exact,
      dithered: report.dithered,
    },
  })
}
