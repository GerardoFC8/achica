import type { AnimationFailure, VideoFailure } from '../core/pipeline'
import type { JobError } from '../workers/protocol'
import type { ToolId } from '../tools/registry'
import { MAX_ENTRIES } from '../core/har'
import type { Copy } from './copy'
import type { Formatters } from './format'
import { MAX_HAR_BYTES, type IntakeError } from './har-intake'

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
  apng: 'APNG',
  tiff: 'TIFF',
  bmp: 'BMP',
}

/** How a format is written in a sentence, which is not how its extension is. */
export const formatName = (format: string): string => FORMAT_NAMES[format] ?? format.toUpperCase()

export function describeJobError(error: JobError, copy: Copy, tool: ToolId): string {
  const { errors } = copy

  switch (error.code) {
    case 'empty-file':
      return copy.tools[tool].emptyFile

    case 'unknown-format':
      return errors.unknownFormat

    case 'unsupported-format':
      return error.format === 'heic' ? errors.heic : errors.unsupported(formatName(error.format))

    case 'decode-failed':
      return errors.decodeFailed(formatName(error.format))

    case 'encode-failed':
      return errors.encodeFailed(formatName(error.format))

    case 'strip-unsupported':
      return errors.stripUnsupported(formatName(error.format))

    case 'corrupt':
      return errors.corrupt(formatName(error.format))

    case 'worker-crashed':
      return errors.workerCrashed

    case 'animation-failed':
      return describeAnimationFailure(error.reason, copy, tool)

    case 'video-failed':
      return describeVideoFailure(error.reason, copy)
  }
}

/** Why a video could not be read, with what to do about it. */
function describeVideoFailure(reason: VideoFailure['reason'], copy: Copy): string {
  const words = copy.errors.video

  switch (reason) {
    case 'codec-unsupported':
      return words.codecUnsupported
    case 'stalled':
      return words.stalled
    case 'no-video-track':
      return words.noVideoTrack
    case 'unsupported-video':
      return words.unsupportedVideo
    case 'corrupt':
      return words.corrupt
    case 'aborted':
      return words.aborted
    case 'bad-options':
    case 'internal':
      return words.internal
  }
}

/**
 * Why an animation could not be made, in words that say what to do. Every
 * reason is listed, so a code added to the core does not compile until it has
 * a sentence (or is knowingly folded into the generic encode failure).
 */
function describeAnimationFailure(
  reason: AnimationFailure['reason'],
  copy: Copy,
  tool: ToolId,
): string {
  const words = copy.errors.animation

  switch (reason) {
    case 'empty-file':
      return copy.tools[tool].emptyFile
    case 'not-animated':
      return words.notAnimated
    case 'animation-unsupported':
      return words.unsupportedBrowser
    case 'unsupported-format':
      return words.unsupportedFormat
    case 'corrupt':
      return words.corrupt
    case 'too-large':
      return words.tooLarge
    case 'resize-failed':
      return words.resizeFailed
    case 'compression-unavailable':
      return words.compressionUnavailable
    case 'no-frames':
    case 'too-many-frames':
    case 'bad-dimensions':
    case 'size-mismatch':
    case 'bad-frame-data':
    case 'bad-delay':
    case 'bad-option':
    case 'compression-failed':
      return words.encodeFailed
  }
}

/** A rejected HAR, in words that say what to do about it. */
export function describeIntakeError(
  error: IntakeError,
  copy: Copy,
  formatters: Formatters,
): string {
  const { errors } = copy.audit

  switch (error.code) {
    case 'not-json':
      return errors.notJson
    case 'not-har':
      return errors.notHar
    case 'too-many-entries':
      return errors.tooManyEntries(formatters.count(error.count), formatters.count(MAX_ENTRIES))
    case 'too-large':
      return errors.tooLarge(formatters.bytes(error.bytes), formatters.bytes(MAX_HAR_BYTES))
    case 'several-files':
      return errors.severalFiles
    case 'read-failed':
      return errors.readFailed
    case 'no-images': {
      const base = errors.noImages(error.imageEntries, formatters.count(error.imageEntries))
      return error.noContent ? `${base}. ${errors.noImagesNoContent}` : base
    }
  }
}
