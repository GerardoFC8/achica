import { err, ok, type Result } from '../result'
import type { SupportedFormat } from '../detect'

/**
 * Decoding, one wrapper per format.
 *
 * Two things this layer exists for. First, the codecs throw and core/ reports
 * failures as values (D13), so every throw is caught and turned into a typed
 * error — a corrupt photo must mark its own row, never take the batch down.
 * Second, each codec is behind a dynamic import: AVIF's wasm is the heaviest
 * thing in the project and most users never encode one, so it must not sit in
 * the initial bundle.
 */

export type DecodeError = {
  readonly code: 'decode-failed'
  readonly format: SupportedFormat
  /** The codec's own message. For logs and bug reports, not for the user. */
  readonly detail: string
}

/**
 * MozJPEG applies the EXIF rotation to the pixels when this is true.
 *
 * The name reads backwards and the default makes it worse: `preserveOrientation`
 * means "preserve the orientation the photographer intended", not "preserve the
 * stored pixel layout", and jSquash defaults it to false. Taking that default
 * ships every phone photo sideways, which the spec singles out as the most
 * common bug in tools of this kind.
 *
 * Verified against all eight orientation fixtures, whose expected output was
 * itself measured against Chromium rather than reasoned about.
 */
const APPLY_EXIF_ROTATION = true

async function decodeJpeg(bytes: ArrayBuffer): Promise<ImageData> {
  const { default: decode } = await import('@jsquash/jpeg/decode')
  return decode(bytes, { preserveOrientation: APPLY_EXIF_ROTATION })
}

async function decodePng(bytes: ArrayBuffer): Promise<ImageData> {
  const { default: decode } = await import('@jsquash/png/decode')
  // 16-bit PNGs come back truncated to 8 bits. That is the right trade here:
  // the output formats this tool writes are all 8-bit, so carrying 16 bits
  // through the pipeline would double memory for something we then discard.
  return decode(bytes)
}

async function decodeWebp(bytes: ArrayBuffer): Promise<ImageData> {
  const { default: decode } = await import('@jsquash/webp/decode')
  return decode(bytes)
}

async function decodeAvif(bytes: ArrayBuffer): Promise<ImageData> {
  const { default: decode } = await import('@jsquash/avif/decode')
  const image = await decode(bytes)

  // The published types say this can be null; the implementation actually
  // throws instead. Guarded rather than asserted, so a release that starts
  // honouring its own declaration turns into a typed error, not a crash.
  if (image === null) throw new Error('AVIF decoder returned no image')
  return image
}

const DECODERS: Readonly<Record<SupportedFormat, (bytes: ArrayBuffer) => Promise<ImageData>>> = {
  jpeg: decodeJpeg,
  png: decodePng,
  webp: decodeWebp,
  avif: decodeAvif,
}

/**
 * Decodes to pixels, with the EXIF rotation already applied.
 *
 * Orientation is settled here, at the entrance, rather than carried alongside
 * the bitmap. Anything downstream — resizing, encoding, the preview — can then
 * treat width and height as what the user actually sees, and there is no flag
 * left for a later step to forget.
 */
export async function decodeImage(
  format: SupportedFormat,
  bytes: ArrayBuffer,
): Promise<Result<ImageData, DecodeError>> {
  try {
    return ok(await DECODERS[format](bytes))
  } catch (cause) {
    return err({
      code: 'decode-failed',
      format,
      detail: cause instanceof Error ? cause.message : String(cause),
    })
  }
}
