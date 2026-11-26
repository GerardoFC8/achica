import { detectSupportedFormat } from '../detect'
import { err, ok, type Result } from '../result'
import { stripJpeg, type Stripped } from './jpeg'
import { stripPng } from './png'
import type { CorruptError, StripError, StripFormat, StripOutcome } from './types'
import { stripWebp } from './webp'

export type {
  CorruptError,
  RemovedKind,
  RemovedMetadata,
  StripError,
  StripFormat,
  StripOutcome,
  StripUnsupportedError,
} from './types'

/**
 * Removes the metadata of a JPEG, PNG or WebP without decoding it.
 *
 * What it promises, and what it does not: the output keeps only what is needed
 * to paint the image (see each container module for the exact list) and the
 * report lists what was dropped. It does not recompress, so pixels and quality
 * are untouched. AVIF stores its metadata as items addressed by offsets inside
 * `meta`, which cannot be cut without rewriting every offset; it is refused
 * with a typed error rather than recompressed as a fallback.
 *
 * It never throws. The try/catch below is a last net for a bug on hostile
 * input, and it is labelled "internal" so a test (and the fuzz test) can tell
 * a deliberate rejection from an unexpected exception.
 */
export function stripMetadata(input: Uint8Array): Result<StripOutcome, StripError> {
  const detected = detectSupportedFormat(input)
  if (!detected.ok) return err(detected.error)

  const format = detected.value
  if (format === 'avif') return err({ code: 'strip-unsupported', format: 'avif' })

  let result: Result<Stripped, CorruptError>
  try {
    result =
      format === 'jpeg' ? stripJpeg(input) : format === 'png' ? stripPng(input) : stripWebp(input)
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    return err({ code: 'corrupt', format, detail: `internal: ${detail}` })
  }
  if (!result.ok) return err(result.error)

  const stripped = result.value
  const identical = sameBytes(stripped.bytes, input)

  // A file the walker leaves byte-for-byte as it found it lost nothing, which
  // also covers one whose only EXIF was already the minimal orientation block.
  // Reporting its own orientation block as "removed" would be a lie.
  const removed = identical
    ? {
        kinds: [],
        bytesRemoved: 0,
        trailingBytes: 0,
        orientation: stripped.removed.orientation,
        exifUnreadable: false,
        hadGps: false,
        hadCameraInfo: false,
      }
    : stripped.removed

  return ok({
    bytes: stripped.bytes,
    format: format satisfies StripFormat,
    width: stripped.width,
    height: stripped.height,
    removed,
  })
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false
  }
  return true
}
