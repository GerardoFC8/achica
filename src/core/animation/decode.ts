import { detectFormat } from '../detect'
import { err, ok, type Result } from '../result'
import { fitImage, type FitMode } from './fit'
import type { AnimationError, Frame } from './types'

/**
 * Reads an animated GIF, APNG or animated WebP with the platform's own
 * ImageDecoder (WebCodecs), one frame at a time.
 *
 * Decisions that are not obvious:
 *
 * - Memory. Each frame is decoded, framed to its destination size at once and
 *   released before the next one is asked for. The source-size frames are
 *   never all alive together: a 1080p, 300-frame GIF would be 2.4 GB.
 * - Pixels come through a canvas (drawImage + getImageData), not through
 *   VideoFrame.copyTo. Measured: copyTo hands back straight alpha in Chromium
 *   and premultiplied alpha in Firefox, so the same file would decode to
 *   different bytes. A canvas gives straight RGBA in both.
 * - Delays are what ImageDecoder reports. When it reports nothing, or zero,
 *   the frame gets 100 ms, which is what browsers do when they play such a GIF.
 * - A file with one frame is an error ('not-animated'), not a one-frame
 *   animation: static images are not this tool's business.
 * - ImageDecoder exists in Chromium and Firefox. Where it does not (Safari, an
 *   old browser) the result is the typed error 'animation-unsupported', never
 *   an exception.
 */

export type DecodeOptions = {
  /** How each frame is framed. Default: 'none' (source size). */
  readonly fit?: FitMode
  /** Refuse animations with more frames than this. */
  readonly maxFrames?: number
  /** Refuse animations whose frames, at source size, add up to more pixels than this. */
  readonly maxSourcePixels?: number
}

export type DecodedAnimation = {
  readonly frames: Frame[]
  readonly width: number
  readonly height: number
  /** Size of the first frame as stored in the file. */
  readonly sourceWidth: number
  readonly sourceHeight: number
  readonly format: 'gif' | 'apng' | 'webp'
  readonly durationMs: number
}

export const DECODE_LIMITS = {
  maxFrames: 400,
  /** About 100 frames of 1920x1080, or 16000 frames of 128x128. */
  maxSourcePixels: 2 ** 28,
  /** One frame: a hostile header cannot ask for a multi-gigapixel canvas. */
  maxFramePixels: 2 ** 26,
} as const

/** What browsers use when a frame has no usable delay. */
export const DEFAULT_DELAY_MS = 100

const TYPES = { gif: 'image/gif', apng: 'image/apng', webp: 'image/webp' } as const

type SourceFormat = keyof typeof TYPES

const fail = (code: AnimationError['code'], detail: string): Result<never, AnimationError> =>
  err({ code, detail })

const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message !== '' ? error.message : fallback

function sourceFormat(bytes: Uint8Array): { format: SourceFormat | null; name: string } {
  const detected = detectFormat(bytes)
  if (detected === 'gif') return { format: 'gif', name: 'gif' }
  if (detected === 'png') return { format: 'apng', name: 'png' }
  if (detected === 'webp') return { format: 'webp', name: 'webp' }
  return { format: null, name: detected ?? 'unknown' }
}

/** Canvas size from the container header, so a hostile size is refused before any decoding. */
function headerSize(
  bytes: Uint8Array,
  format: SourceFormat,
): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (format === 'gif' && bytes.length >= 10) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
  }
  if (format === 'apng' && bytes.length >= 24) {
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }
  // Animated WebP always starts with a VP8X chunk: 24-bit canvas size minus one.
  const isVp8x =
    format === 'webp' &&
    bytes.length >= 30 &&
    String.fromCharCode(...bytes.subarray(12, 16)) === 'VP8X'
  if (isVp8x) {
    const at = (offset: number): number =>
      (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16)
    return { width: at(24) + 1, height: at(27) + 1 }
  }
  return null
}

async function resolveType(format: SourceFormat): Promise<string | null> {
  const type: string = TYPES[format]
  try {
    if (await ImageDecoder.isTypeSupported(type)) return type
    // Some engines only know the plain PNG name; it decodes APNG as well.
    if (format === 'apng' && (await ImageDecoder.isTypeSupported('image/png'))) return 'image/png'
  } catch {
    return null
  }
  return null
}

export async function decodeAnimation(
  input: Uint8Array | ArrayBuffer,
  options: DecodeOptions = {},
): Promise<Result<DecodedAnimation, AnimationError>> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.length === 0) return fail('empty-file', 'the file is empty')

  const { format, name } = sourceFormat(bytes)
  if (format === null) return fail('unsupported-format', `${name} is not a GIF, PNG or WebP`)

  if (typeof ImageDecoder === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    return fail('animation-unsupported', 'this browser cannot decode animations (no ImageDecoder)')
  }

  const maxFrames = options.maxFrames ?? DECODE_LIMITS.maxFrames
  const maxSourcePixels = options.maxSourcePixels ?? DECODE_LIMITS.maxSourcePixels
  const mode: FitMode = options.fit ?? { kind: 'none' }

  const header = headerSize(bytes, format)
  if (header !== null && header.width * header.height > DECODE_LIMITS.maxFramePixels) {
    return fail('too-large', `${header.width}x${header.height} is too large to decode`)
  }

  const type = await resolveType(format)
  if (type === null) return fail('animation-unsupported', `this browser cannot decode ${format}`)

  let decoder: ImageDecoder
  try {
    decoder = new ImageDecoder({ data: bytes, type })
  } catch (error) {
    return fail('corrupt', messageOf(error, 'ImageDecoder refused the data'))
  }

  try {
    try {
      await decoder.tracks.ready
      // A buffer is complete from the start, but frameCount is only final once parsing ended.
      await decoder.completed
    } catch (error) {
      return fail('corrupt', messageOf(error, 'the file cannot be parsed'))
    }
    const count = decoder.tracks.selectedTrack?.frameCount ?? 0
    if (count < 1) return fail('corrupt', 'the file has no frames')
    if (count === 1) return fail('not-animated', 'the file has a single frame')
    if (count > maxFrames) return fail('too-large', `${count} frames, the limit is ${maxFrames}`)

    const frames: Frame[] = []
    let canvas: OffscreenCanvas | null = null
    let context: OffscreenCanvasRenderingContext2D | null = null
    let sourceWidth = 0
    let sourceHeight = 0

    for (let frameIndex = 0; frameIndex < count; frameIndex += 1) {
      let image: VideoFrame
      try {
        image = (await decoder.decode({ frameIndex, completeFramesOnly: true })).image
      } catch (error) {
        return fail('corrupt', `frame ${frameIndex}: ${messageOf(error, 'cannot be decoded')}`)
      }
      try {
        const width = image.displayWidth
        const height = image.displayHeight
        if (canvas === null || context === null) {
          const tooBig =
            width * height * count > maxSourcePixels ||
            width * height > DECODE_LIMITS.maxFramePixels
          if (tooBig) {
            return fail('too-large', `${width}x${height} over ${count} frames is too many pixels`)
          }
          sourceWidth = width
          sourceHeight = height
          canvas = new OffscreenCanvas(width, height)
          // willReadFrequently keeps the canvas in memory: one readback per frame.
          context = canvas.getContext('2d', { willReadFrequently: true })
          if (context === null) return fail('animation-unsupported', 'no 2D canvas available')
        } else if (width !== sourceWidth || height !== sourceHeight) {
          return fail(
            'corrupt',
            `frame ${frameIndex} is ${width}x${height}, not ${sourceWidth}x${sourceHeight}`,
          )
        }
        context.clearRect(0, 0, width, height)
        context.drawImage(image, 0, 0)
        const pixels = context.getImageData(0, 0, width, height)
        const microseconds = image.duration
        const delay =
          microseconds !== null && microseconds > 0 ? Math.round(microseconds / 1000) : 0
        let fitted
        try {
          fitted = await fitImage(pixels, mode)
        } catch (error) {
          return fail('resize-failed', messageOf(error, 'resampling failed'))
        }
        frames.push({
          data: fitted.data,
          width: fitted.width,
          height: fitted.height,
          delayMs: delay > 0 ? delay : DEFAULT_DELAY_MS,
        })
      } finally {
        // Release the decoder's frame before asking for the next one.
        image.close()
      }
    }

    const first = frames[0]
    if (first === undefined) return fail('corrupt', 'the file has no frames')
    return ok({
      frames,
      width: first.width,
      height: first.height,
      sourceWidth,
      sourceHeight,
      format,
      durationMs: frames.reduce((total, frame) => total + frame.delayMs, 0),
    })
  } catch (error) {
    return fail('corrupt', messageOf(error, 'the file cannot be decoded'))
  } finally {
    decoder.close()
  }
}
