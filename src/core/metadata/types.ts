import type { DetectionError } from '../detect'

/**
 * Types shared by the metadata stripper and the layers that report on it.
 *
 * This module removes metadata by editing the container bytes. It never
 * decodes a pixel and never re-encodes one, which is the whole point: an
 * image that is not recompressed cannot lose quality, and cannot be changed by
 * a codec that decides to write its own metadata.
 *
 * Do not confuse it with `Profile.stripMetadata`. That field means "the codec
 * we encode with writes no metadata on its own", a property of the recompress
 * path. Nothing here reads it, and nothing here should be wired to it.
 */

/** The containers this module can rewrite. AVIF is detected but not supported. */
export type StripFormat = 'jpeg' | 'png' | 'webp'

/**
 * What was found and removed, as classes a person understands.
 *
 * - `exif`: the camera block (also where GPS lives).
 * - `xmp`: Adobe's XML packet, in JPEG APP1, PNG iTXt or WebP `XMP `.
 * - `iptc`: Photoshop image resource blocks (captions, keywords, copyright).
 * - `comment`: free text a JPEG COM segment carried.
 * - `thumbnail`: an embedded preview, in the EXIF or in the JFIF header.
 * - `mpf`: Multi-Picture Format, which links extra images stored after this one.
 * - `png-text`: tEXt / zTXt / iTXt chunks that are not XMP.
 * - `png-time`: the tIME chunk (last modification time).
 * - `trailing-data`: whatever followed the end-of-image marker.
 * - `other`: every unrecognised or unneeded segment and chunk.
 */
export type RemovedKind =
  | 'exif'
  | 'xmp'
  | 'iptc'
  | 'comment'
  | 'thumbnail'
  | 'mpf'
  | 'png-text'
  | 'png-time'
  | 'trailing-data'
  | 'other'

/** The order kinds are reported in, so the report is stable and testable. */
export const REMOVED_KIND_ORDER: readonly RemovedKind[] = [
  'exif',
  'xmp',
  'iptc',
  'comment',
  'thumbnail',
  'mpf',
  'png-text',
  'png-time',
  'trailing-data',
  'other',
]

/**
 * The report. It is derived from what the walker actually dropped, never from
 * what it expected to find, so it cannot claim a removal that did not happen.
 */
export type RemovedMetadata = {
  readonly kinds: readonly RemovedKind[]
  /**
   * Gross bytes dropped from the input: every removed segment or chunk, the
   * trimmed JFIF thumbnail and the trailing data. It does not subtract the few
   * bytes of the orientation block that may be written back, so it is not the
   * same number as `input.length - output.length` when an orientation is kept.
   */
  readonly bytesRemoved: number
  /** The part of `bytesRemoved` that sat after the end-of-image marker. */
  readonly trailingBytes: number
  /** The orientation (2 to 8) that was written back, or null when none was. */
  readonly orientation: number | null
  /** An EXIF block existed and none of its copies could be read. */
  readonly exifUnreadable: boolean
  /** The original EXIF had a GPS tag whose directory holds at least one entry. */
  readonly hadGps: boolean
  /** The original EXIF named a camera make or model. */
  readonly hadCameraInfo: boolean
}

export type StripOutcome = {
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly format: StripFormat
  /** Read from the headers, as stored in the file (orientation is not applied). */
  readonly width: number
  readonly height: number
  readonly removed: RemovedMetadata
}

export type StripUnsupportedError = {
  readonly code: 'strip-unsupported'
  readonly format: 'avif'
}

export type CorruptError = {
  readonly code: 'corrupt'
  readonly format: StripFormat
  /** For logs and bug reports, not for the user. */
  readonly detail: string
}

export type StripError = DetectionError | StripUnsupportedError | CorruptError
