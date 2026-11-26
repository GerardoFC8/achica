import {
  DEFAULT_VIDEO_SEGMENT,
  normalizeVideoSegment,
  type VideoSegment,
} from '../core/animation/video-segment'

/**
 * The three numbers a user types to cut a video, as pure functions.
 *
 * The text fields hold what was typed; this file decides what it means. A
 * value that is not a number never reaches the plan: the field keeps the last
 * good value and says why. A number outside the tool's bounds is not refused
 * but cut to them by `normalizeVideoSegment`, and the field says it was cut.
 */

export const DEFAULT_VIDEO = DEFAULT_VIDEO_SEGMENT

export type VideoField = keyof VideoSegment

export const VIDEO_FIELDS: readonly VideoField[] = ['startSeconds', 'lengthSeconds', 'fps']

/** What the typed text is not: empty, not a number, or below zero. */
export type VideoProblem = 'empty' | 'not-a-number' | 'negative'

/**
 * One typed field as a number. Accepts a decimal comma as well as a point
 * ("2,5" is how a decimal is written in Spanish) and a trailing separator, so
 * typing "2," on the way to "2,5" is not an error. Anything else (units,
 * thousands separators, exponents, signs other than a leading minus) is not a
 * number here.
 */
export function parseVideoNumber(
  text: string,
):
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly problem: VideoProblem } {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: false, problem: 'empty' }

  const negative = trimmed.startsWith('-')
  const body = negative ? trimmed.slice(1) : trimmed
  if (!/^(\d+([.,]\d*)?|[.,]\d+)$/.test(body)) return { ok: false, problem: 'not-a-number' }

  const value = Number(body.replace(',', '.'))
  if (!Number.isFinite(value)) return { ok: false, problem: 'not-a-number' }
  // "-0" is zero, not a negative amount of seconds.
  return value > 0 && negative ? { ok: false, problem: 'negative' } : { ok: true, value }
}

export type VideoTexts = Readonly<Record<VideoField, string>>

export type VideoReading = {
  /** What goes into the plan: always valid, always inside the bounds. */
  readonly segment: VideoSegment
  /** Fields whose text is not a number; the segment holds their previous value. */
  readonly problems: Readonly<Partial<Record<VideoField, VideoProblem>>>
  /** Fields whose number was valid but had to be cut to the tool's bounds. */
  readonly adjusted: readonly VideoField[]
}

/**
 * The segment the typed texts ask for. A field that cannot be read keeps the
 * `previous` value (which is already a valid segment); the rest are
 * normalised together, because the length's cap depends on the rate.
 */
export function readVideoTexts(texts: VideoTexts, previous: VideoSegment): VideoReading {
  const problems: Partial<Record<VideoField, VideoProblem>> = {}
  const requested: Record<VideoField, number> = { ...previous }

  for (const field of VIDEO_FIELDS) {
    const parsed = parseVideoNumber(texts[field])
    if (parsed.ok) requested[field] = parsed.value
    else problems[field] = parsed.problem
  }

  const segment = normalizeVideoSegment(requested)
  const adjusted = VIDEO_FIELDS.filter(
    (field) => problems[field] === undefined && segment[field] !== requested[field],
  )
  return { segment, problems, adjusted }
}

/** A number as it is written back into a field: no trailing zeros, a decimal comma in Spanish. */
export function videoText(value: number, decimalComma: boolean): string {
  const text = String(Math.round(value * 100) / 100)
  return decimalComma ? text.replace('.', ',') : text
}

/** The fields' texts for a segment, for the first render and after a field is left. */
export function textsOf(segment: VideoSegment, decimalComma: boolean): VideoTexts {
  return {
    startSeconds: videoText(segment.startSeconds, decimalComma),
    lengthSeconds: videoText(segment.lengthSeconds, decimalComma),
    fps: videoText(segment.fps, decimalComma),
  }
}
