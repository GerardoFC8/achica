import type { JobError } from '../workers/protocol'
import type { Copy } from './copy'

/**
 * A typed code becomes a sentence here, and only here.
 *
 * The core reports codes precisely so the wording is not baked into it — that
 * is what lets the same failure be shown in Spanish and in English (the
 * sentences themselves are in ./copy). Each message says what happened and what to do about it. The codec's
 * own `detail` never reaches the user: it is for a bug report, and a stack
 * trace in a table row helps nobody.
 */

const FORMAT_NAMES: Readonly<Record<string, string>> = {
  jpeg: 'JPEG',
  png: 'PNG',
  webp: 'WebP',
  avif: 'AVIF',
  heic: 'HEIC',
  gif: 'GIF',
  tiff: 'TIFF',
  bmp: 'BMP',
}

/** How a format is written in a sentence, which is not how its extension is. */
export const formatName = (format: string): string => FORMAT_NAMES[format] ?? format.toUpperCase()

export function describeJobError(error: JobError, copy: Copy): string {
  const { errors } = copy

  switch (error.code) {
    case 'empty-file':
      return errors.emptyFile

    case 'unknown-format':
      return errors.unknownFormat

    case 'unsupported-format':
      return error.format === 'heic' ? errors.heic : errors.unsupported(formatName(error.format))

    case 'decode-failed':
      return errors.decodeFailed(formatName(error.format))

    case 'encode-failed':
      return errors.encodeFailed(formatName(error.format))

    case 'worker-crashed':
      return errors.workerCrashed
  }
}
