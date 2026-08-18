import { err, ok, type Result } from '../result'

/**
 * Encoding, one wrapper per format.
 *
 * Quality is normalised to 0–100, higher is better, across every lossy codec.
 * MozJPEG, libwebp and libavif all happen to agree on that scale in the
 * versions we pin, so the mapping is currently the identity — but it is stated
 * here rather than assumed, because the budget search bisects on this number
 * and a codec that reversed the scale would silently invert the search.
 */

export type OutputFormat = 'jpeg' | 'png' | 'webp' | 'avif'

/** PNG is lossless: it has no quality knob and ignores the value entirely. */
export type LossyFormat = Exclude<OutputFormat, 'png'>

export type EncodeError = {
  readonly code: 'encode-failed'
  readonly format: OutputFormat
  readonly detail: string
}

/**
 * Bytes backed by a plain ArrayBuffer rather than by `ArrayBufferLike`.
 *
 * The distinction is not pedantry: only a non-shared buffer can be handed to
 * a Blob or transferred to another thread, and both are things the layers
 * above do with every encode. Stating it here means they do not have to
 * assert it later.
 */
export type EncodedBytes = Uint8Array<ArrayBuffer>

export const MIN_QUALITY = 0
export const MAX_QUALITY = 100

function clampQuality(quality: number): number {
  return Math.max(MIN_QUALITY, Math.min(MAX_QUALITY, Math.round(quality)))
}

async function encodeJpeg(image: ImageData, quality: number): Promise<ArrayBuffer> {
  const { default: encode } = await import('@jsquash/jpeg/encode')
  // MozJPEG defaults to progressive and optimised coding, which is what we
  // want for the web: smaller files and a usable preview before the last byte.
  return encode(image, { quality })
}

async function encodeWebp(image: ImageData, quality: number): Promise<ArrayBuffer> {
  const { default: encode } = await import('@jsquash/webp/encode')
  return encode(image, { quality })
}

async function encodeAvif(image: ImageData, quality: number): Promise<ArrayBuffer> {
  const { default: encode } = await import('@jsquash/avif/encode')
  return encode(image, { quality })
}

async function encodePng(image: ImageData): Promise<ArrayBuffer> {
  const { default: encode } = await import('@jsquash/png/encode')
  return encode(image)
}

/**
 * Encodes to bytes.
 *
 * `quality` is ignored for PNG, and that is not an oversight to paper over
 * later: a caller asking PNG to hit a weight budget is asking for something
 * the format cannot do, and the pipeline has to answer that question rather
 * than pretend a knob exists.
 */
export async function encodeImage(
  format: OutputFormat,
  image: ImageData,
  quality: number = 75,
): Promise<Result<EncodedBytes, EncodeError>> {
  try {
    const q = clampQuality(quality)
    const buffer =
      format === 'jpeg'
        ? await encodeJpeg(image, q)
        : format === 'webp'
          ? await encodeWebp(image, q)
          : format === 'avif'
            ? await encodeAvif(image, q)
            : await encodePng(image)

    return ok(new Uint8Array(buffer))
  } catch (cause) {
    return err({
      code: 'encode-failed',
      format,
      detail: cause instanceof Error ? cause.message : String(cause),
    })
  }
}

/** Whether adjusting quality can change the output size at all. */
export function isLossy(format: OutputFormat): format is LossyFormat {
  return format !== 'png'
}

const MIME_TYPES: Readonly<Record<OutputFormat, string>> = Object.freeze({
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
})

/**
 * The type a Blob of this format should carry.
 *
 * A blob without a type downloads as `application/octet-stream`, which makes
 * the operating system treat a finished photo as an unknown binary.
 */
export function mimeTypeOf(format: OutputFormat): string {
  return MIME_TYPES[format]
}
