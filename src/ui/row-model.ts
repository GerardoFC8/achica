import type { Profile } from '../core/profiles'
import type { ToolId } from '../tools/registry'
import type { ItemOutcome, QueueItem } from '../state/queue'
import type { RemovedMetadata } from '../core/metadata'
import type { Copy } from './copy'
import type { StripFacts, StripPart } from './copy/es'
import type { Formatters } from './format'
import { describeJobError, formatName } from './messages'

/**
 * The arithmetic behind a row, kept out of the components that draw it.
 *
 * The weight bar is the interface's one distinctive element, and what makes it
 * readable is geometry rather than colour: where the fill ends relative to the
 * budget mark is the whole message. That geometry is decided here and tested
 * here.
 */

/*
 * `done` is the neutral verdict: finished, with nothing to judge. The tools
 * that do not weigh their result (resize, convert) end here, because for them
 * a file that grew is not a failure: JPEG to PNG grows by nature (D58).
 */
export type RowKind =
  'pending' | 'running' | 'fits' | 'tight' | 'over' | 'done' | 'failed' | 'cancelled'

export type WeightBar = {
  /** Final weight as a fraction of the original, clamped to the track. */
  readonly fill: number
  /** Where the budget falls on the track, or null when there is no budget. */
  readonly mark: number | null
  /** The stretch past the budget, drawn apart so colour is not the only cue. */
  readonly overflow: { readonly start: number; readonly width: number } | null
}

/** Inside this much of the mark, a result counts as having only just fitted. */
const TIGHT_FRACTION = 0.9

/**
 * The budget as a fraction of the original file, or nothing when the budget
 * never constrained this file at all.
 *
 * A limit the file already met is not a limit it met narrowly. Pinning the
 * mark to the right edge in that case invites reading "only just made it" from
 * a row where the budget was never in play — and the pipeline treats that case
 * as a plain quality encode for the same reason.
 */
function budgetMark(item: QueueItem, profile: Profile): number | null {
  if (profile.maxBytes === undefined || item.bytesBefore <= 0) return null
  if (profile.maxBytes >= item.bytesBefore) return null
  return profile.maxBytes / item.bytesBefore
}

/**
 * The weight limit a finished row was judged against.
 *
 * An animation carries it in its own result, because the destination selected
 * now may not be the one it was processed with: `withinBudget` is a verdict
 * about that number, and a bar or a margin measured against another one would
 * contradict it (D61). Every other row is measured against the selected
 * profile, as before.
 */
export function appliedLimit(item: QueueItem, profile: Profile): number | undefined {
  if (item.status === 'done' && item.outcome.animation !== undefined) {
    return item.outcome.animation.limitBytes
  }
  return profile.maxBytes
}

/**
 * True when a finished animation was fitted to a limit other than the selected
 * destination's. The queue does not remember which destination a row used, so
 * the limit is the evidence: it is the one thing the verdict depends on.
 */
export function processedWithOther(item: QueueItem, profile: Profile): boolean {
  return (
    item.status === 'done' &&
    item.outcome.animation !== undefined &&
    profile.maxBytes !== undefined &&
    item.outcome.animation.limitBytes !== profile.maxBytes
  )
}

export function rowKind(item: QueueItem, profile: Profile, tool: ToolId): RowKind {
  if (item.status !== 'done') return item.status

  /*
   * Discord's limit is somebody else's absolute one, not a share of the
   * original: a file it would reject is `over` whatever the original weighed,
   * and one that fits is `tight` once it uses more than 90 % of the limit. The
   * verdict is the one the pipeline reached when the file was made, so
   * choosing another destination afterwards does not rewrite it.
   */
  if (tool === 'discord') {
    if (!item.outcome.withinBudget) return 'over'
    const limit = appliedLimit(item, profile)
    return limit !== undefined && item.outcome.bytesAfter > limit * TIGHT_FRACTION
      ? 'tight'
      : 'fits'
  }

  // Only the compressor judges weight. The saving column still carries the
  // real sign, so a file that grew reads as grown, just not as a failure.
  if (tool !== 'comprimir') return 'done'

  const fill = item.bytesBefore > 0 ? item.outcome.bytesAfter / item.bytesBefore : 0
  const mark = budgetMark(item, profile)

  /*
   * With no budget there is nothing to miss — except the point. This tool
   * exists to make files smaller, so a result that grew failed at the only
   * thing it was asked to do, and saying it "fits" would be flattery.
   */
  if (mark === null) return fill >= 1 ? 'over' : 'fits'

  if (fill > mark) return 'over'
  if (fill > mark * TIGHT_FRACTION) return 'tight'
  return 'fits'
}

/**
 * The bar of a destination with an absolute limit: the track is the limit and
 * the fill is the share of it the file uses. A file past the limit needs room
 * to be drawn past it, so the track then stretches to the file and the mark
 * (the limit) moves inside it, with the stretch after the mark hatched. Within
 * the limit the mark is the right edge, which is where the limit is.
 */
function limitBar(item: QueueItem, limit: number): WeightBar {
  if (item.status !== 'done') return { fill: 0, mark: 1, overflow: null }

  const after = item.outcome.bytesAfter
  const scale = Math.max(limit, after)
  const mark = limit / scale

  return {
    fill: after / scale,
    mark,
    overflow: after > limit ? { start: mark, width: 1 - mark } : null,
  }
}

export function weightBar(item: QueueItem, profile: Profile): WeightBar | null {
  /*
   * A file that failed has no final weight to plot, and one that was cancelled
   * never produced one. An empty track would read as a file that compressed
   * to nothing, which is the opposite of what happened.
   */
  if (item.status === 'failed' || item.status === 'cancelled') return null

  if (item.status === 'done' && item.outcome.animation !== undefined) {
    return limitBar(item, item.outcome.animation.limitBytes)
  }
  if (profile.animation !== undefined && profile.maxBytes !== undefined) {
    return limitBar(item, profile.maxBytes)
  }

  const mark = budgetMark(item, profile)

  if (item.status !== 'done') return { fill: 0, mark, overflow: null }

  const raw = item.bytesBefore > 0 ? item.outcome.bytesAfter / item.bytesBefore : 0
  const fill = Math.min(1, raw)

  return {
    fill,
    mark,
    overflow: mark !== null && fill > mark ? { start: mark, width: fill - mark } : null,
  }
}

export function rowNote(
  item: QueueItem,
  formatters: Formatters,
  copy: Copy,
  tool: ToolId,
  /**
   * The selected destination's limit. The note names the limit the row was
   * judged against, which is the animation's own; this one only tells whether
   * the selection has moved to another destination since.
   */
  selectedMaxBytes?: number,
): string {
  const { note } = copy

  switch (item.status) {
    case 'pending':
      return note.pending
    case 'running':
      return copy.tools[tool].running
    case 'cancelled':
      return note.cancelled
    case 'failed':
      return describeJobError(item.error, copy, tool)
    case 'done': {
      const { outcome } = item

      if (outcome.animation !== undefined) {
        const animation = animationNote(outcome, formatters, copy)
        if (animation !== null) {
          const other =
            selectedMaxBytes !== undefined && selectedMaxBytes !== outcome.animation.limitBytes
          // The verdict leads when the file does not fit: the row truncates, and
          // that is the one thing that must not be cut.
          return [
            ...(animation.fits ? [] : [animation.verdict]),
            animation.headline,
            ...(animation.clip === null ? [] : [animation.clip]),
            ...animation.steps,
            ...(other ? [copy.note.animation.otherDestination] : []),
          ].join(' · ')
        }
      }

      // The audit reads an image that did not come out lighter as good news:
      // nothing to gain there, and nothing wrong with it (D60).
      if (tool === 'auditar' && outcome.bytesAfter >= item.bytesBefore) return note.alreadyFine

      if (outcome.metadata !== undefined) {
        const facts = stripFacts(outcome.metadata, formatters)
        return removedNothing(facts)
          ? note.stripUnchanged(facts.keptOrientation)
          : note.stripped(facts)
      }

      const size = formatters.dimensions(outcome.width, outcome.height)
      const shrunk = outcome.shrunkForBudget !== null

      // Both are things the user did not ask for in so many words, so the row
      // says them before the file is opened (D53).
      if (outcome.convertedForBudget) {
        const name = formatName(outcome.format)
        return shrunk ? note.convertedAndShrunk(size, name) : note.converted(size, name)
      }
      return shrunk ? note.shrunk(size) : size
    }
  }
}

/**
 * What the core says a strip-only run removed, as the facts a sentence is
 * built from. Read from the report and nothing else: a part is named only if
 * the core dropped it (location only when the EXIF really held a GPS entry).
 */
export function stripFacts(metadata: RemovedMetadata, formatters: Formatters): StripFacts {
  const parts: StripPart[] = []
  const has = (kind: RemovedMetadata['kinds'][number]): boolean => metadata.kinds.includes(kind)

  if (metadata.exifUnreadable) parts.push('exif-unreadable')
  else if (has('exif')) {
    if (metadata.hadGps) parts.push('gps')
    if (metadata.hadCameraInfo) parts.push('camera')
    if (!metadata.hadGps && !metadata.hadCameraInfo) parts.push('exif')
  }
  for (const kind of [
    'xmp',
    'iptc',
    'comment',
    'thumbnail',
    'mpf',
    'png-text',
    'png-time',
    'other',
  ] as const) {
    if (has(kind)) parts.push(kind)
  }

  return {
    parts,
    trailing: metadata.trailingBytes > 0 ? formatters.bytes(metadata.trailingBytes) : null,
    keptOrientation: metadata.orientation !== null,
  }
}

const removedNothing = (facts: StripFacts): boolean =>
  facts.parts.length === 0 && facts.trailing === null

/** What the row says about an animation: the numbers, what was given up, and whether it fit. */
export type AnimationNote = {
  /** For example "15 fps · 32 colores · lienzo 320 × 320". */
  readonly headline: string
  /** What was given up to fit, in the order it was given up, in words. Empty when nothing was. */
  readonly steps: readonly string[]
  /**
   * For a video: which part was kept, like "de 0 a 5 s de 42 s". It is the
   * user's own choice of segment, so it is said as a fact and never as a
   * verdict. Null for an animation that was not cut out of a video.
   */
  readonly clip: string | null
  /** Whether the result is within the destination's weight limit. */
  readonly fits: boolean
  readonly verdict: string
}

/**
 * The note for an animated result, or null for any other file. Pure: it reads
 * the outcome and nothing else, so it is tested in Node.
 */
export function animationNote(
  outcome: Pick<ItemOutcome, 'animation' | 'withinBudget' | 'width' | 'height' | 'bytesAfter'>,
  formatters: Formatters,
  copy: Copy,
): AnimationNote | null {
  const { animation } = outcome
  if (animation === undefined) return null

  const words = copy.note.animation
  const steps: string[] = []

  for (const step of animation.steps) {
    switch (step.kind) {
      case 'fps':
        steps.push(words.steps.fps(formatters.count(step.to)))
        break
      case 'palette':
        steps.push(words.steps.palette(step.colors))
        break
      case 'scale':
        steps.push(words.steps.scale(Math.round(step.to * 100)))
        break
      case 'canvas':
        steps.push(words.steps.canvas(step.to))
        break
      case 'optimise':
        // Turning it on is the default, not something that was given up.
        if (!step.on) steps.push(words.steps.diffOff)
        break
    }
  }

  const headline = [
    words.fps(formatters.count(animation.fps)),
    animation.colors === null ? words.fullColor : words.colors(animation.colors),
    words.canvas(formatters.dimensions(outcome.width, outcome.height)),
  ].join(' · ')

  const { clip } = animation
  return {
    headline,
    steps,
    clip:
      clip === undefined
        ? null
        : words.clip(
            formatters.seconds(clip.startSeconds),
            formatters.seconds(clip.startSeconds + clip.lengthSeconds),
            formatters.seconds(clip.sourceDurationSeconds),
          ),
    fits: outcome.withinBudget,
    verdict: outcome.withinBudget
      ? words.fits
      : words.over(formatters.bytes(outcome.bytesAfter), formatters.bytes(animation.limitBytes)),
  }
}

/** Negative when the result grew, which the interface shows rather than hides. */
export function savedRatio(item: QueueItem): number | null {
  if (item.status !== 'done' || item.bytesBefore <= 0) return null
  return 1 - item.outcome.bytesAfter / item.bytesBefore
}

export type RowDetail = {
  readonly label: string
  readonly value: string
  readonly kind?: RowKind
}

/**
 * What the destination asked for, in the profile's own terms.
 *
 * This row used to read "Presupuesto: sin tope" whenever a profile set no
 * weight ceiling — true, and it said nothing. Since no shipped profile sets one
 * any more (D49) that would be every file in the batch, so the row now carries
 * the bound the profile actually imposes.
 */
function describeTarget(profile: Profile, formatters: Formatters, copy: Copy): string {
  const { details } = copy
  if (profile.stripOnly === true) return details.stripTarget
  if (profile.maxBytes !== undefined) return details.ceiling(formatters.bytes(profile.maxBytes))

  /*
   * What the profile leaves untouched has its own words. "Any size" is true of
   * a destination that sets no bound, but it would be a wrong thing to say of
   * a conversion (which keeps the dimensions on purpose) or of a percentage
   * (which is a bound, just not one in pixels).
   */
  let size: string
  if (profile.scale !== undefined) size = details.scale(Math.round(profile.scale * 100))
  else if (profile.maxWidth !== undefined && profile.maxHeight !== undefined)
    size = details.maxBox(profile.maxWidth, profile.maxHeight)
  else {
    const bound = profile.maxWidth ?? profile.maxHeight
    size =
      bound !== undefined
        ? details.maxSize(bound)
        : profile.group === 'Formato'
          ? details.sameSize
          : details.anySize
  }

  return profile.format === 'keep'
    ? `${size}, ${details.originalFormat}`
    : `${size}, ${formatName(profile.format)}`
}

/**
 * What the row hides until asked.
 *
 * The table shows the numbers a batch is scanned by; this is where the ones
 * that answer "why" live — which quality it landed on, how many encodes it
 * cost, how much room was left against the budget. Kept out of the row so
 * thirty files still fit on a screen.
 */
export function rowDetails(
  item: QueueItem,
  profile: Profile,
  formatters: Formatters,
  copy: Copy,
  tool: ToolId,
  /** Where the audit found this file, as text. Never a link (D60). */
  origin?: string,
): readonly RowDetail[] {
  const list = detailsOf(item, profile, formatters, copy, tool)
  return origin === undefined ? list : [{ label: copy.details.harUrl, value: origin }, ...list]
}

function detailsOf(
  item: QueueItem,
  profile: Profile,
  formatters: Formatters,
  copy: Copy,
  tool: ToolId,
): readonly RowDetail[] {
  const { details } = copy
  const target: RowDetail = {
    label: details.target,
    value: describeTarget(profile, formatters, copy),
  }

  if (item.status === 'failed') {
    // The message in full, because the row truncates it and it is the only
    // content a failed row has. The code goes with it for a bug report.
    return [
      {
        label: details.whatHappened,
        value: describeJobError(item.error, copy, tool),
        kind: 'failed',
      },
      { label: details.code, value: item.error.code },
      { label: details.source, value: formatters.bytes(item.bytesBefore) },
    ]
  }

  if (item.status !== 'done') {
    return [
      { label: details.source, value: formatters.bytes(item.bytesBefore) },
      target,
      ...(item.status === 'running'
        ? [{ label: details.progress, value: details.progressUnknown }]
        : []),
    ]
  }

  const { outcome } = item
  const kind = rowKind(item, profile, tool)
  // An animation is enlarged to its canvas, so its original weight says
  // nothing about its room: the limit is the limit.
  const limit = appliedLimit(item, profile)
  const ceiling =
    limit === undefined
      ? null
      : outcome.animation !== undefined
        ? limit
        : Math.min(limit, item.bytesBefore)
  const margin = ceiling === null ? null : ceiling - outcome.bytesAfter

  if (outcome.metadata !== undefined) {
    const facts = stripFacts(outcome.metadata, formatters)
    return [
      { label: details.output, value: outcome.format.toUpperCase() },
      { label: details.dimensions, value: formatters.dimensions(outcome.width, outcome.height) },
      {
        label: details.removed,
        value: removedNothing(facts) ? details.removedNothing : details.removedList(facts),
      },
      { label: details.removedBytes, value: formatters.bytes(outcome.metadata.bytesRemoved) },
      { label: details.reencoding, value: details.reencodingNone },
      { label: details.kept, value: details.keptValue(facts.keptOrientation) },
      target,
      {
        label: details.saved,
        value: `${formatters.bytes(item.bytesBefore - outcome.bytesAfter)} · ${formatters.percent(savedRatio(item) ?? 0)}`,
        kind,
      },
      { label: details.time, value: formatters.ms(item.ms) },
    ]
  }

  const animation = outcome.animation
  if (animation !== undefined) {
    const steps = animationNote(outcome, formatters, copy)?.steps ?? []
    const { clip } = animation
    return [
      { label: details.output, value: outcome.format.toUpperCase() },
      { label: details.dimensions, value: formatters.dimensions(outcome.width, outcome.height) },
      { label: details.frames, value: formatters.count(animation.frames) },
      { label: details.duration, value: formatters.ms(animation.durationMs) },
      { label: details.fps, value: formatters.count(animation.fps) },
      {
        label: details.colors,
        value:
          animation.colors === null
            ? copy.note.animation.fullColor
            : formatters.count(animation.colors),
      },
      {
        label: details.adjusted,
        value: steps.length === 0 ? details.adjustedNothing : steps.join(', '),
      },
      { label: details.encodes, value: formatters.count(outcome.encodes) },
      ...(clip === undefined
        ? []
        : [
            {
              label: details.clip,
              value: details.clipValue(
                formatters.seconds(clip.startSeconds),
                formatters.seconds(clip.lengthSeconds),
                formatters.seconds(clip.sourceDurationSeconds),
              ),
            },
          ]),
      // Says the limit the row was judged against, which may not be the
      // selected destination's: the margin below is measured against it.
      outcome.animation !== undefined && processedWithOther(item, profile)
        ? { label: details.target, value: details.processedWithOther(formatters.bytes(limit ?? 0)) }
        : target,
      ...(margin === null
        ? []
        : [
            {
              label: margin >= 0 ? details.margin : details.excess,
              value: formatters.bytes(Math.abs(margin)),
              kind,
            },
          ]),
      {
        label: details.saved,
        value: `${formatters.bytes(item.bytesBefore - outcome.bytesAfter)} · ${formatters.percent(savedRatio(item) ?? 0)}`,
        kind,
      },
      { label: details.time, value: formatters.ms(item.ms) },
    ]
  }

  return [
    {
      label: details.output,
      value:
        outcome.quality === null
          ? outcome.format.toUpperCase()
          : `${outcome.format.toUpperCase()} · ${details.quality(formatters.count(outcome.quality))}`,
    },
    { label: details.dimensions, value: formatters.dimensions(outcome.width, outcome.height) },
    { label: details.encodes, value: formatters.count(outcome.encodes) },
    target,
    ...(margin === null
      ? []
      : [
          {
            label: margin >= 0 ? details.margin : details.excess,
            value: formatters.bytes(Math.abs(margin)),
            kind,
          },
        ]),
    {
      label: details.saved,
      value: `${formatters.bytes(item.bytesBefore - outcome.bytesAfter)} · ${formatters.percent(savedRatio(item) ?? 0)}`,
      kind,
    },
    { label: details.time, value: formatters.ms(item.ms) },
  ]
}
