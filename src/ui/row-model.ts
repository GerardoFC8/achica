import type { Profile } from '../core/profiles'
import type { QueueItem } from '../state/queue'
import type { Formatters } from './format'
import { describeJobError } from './messages'

/**
 * The arithmetic behind a row, kept out of the components that draw it.
 *
 * The weight bar is the interface's one distinctive element, and what makes it
 * readable is geometry rather than colour: where the fill ends relative to the
 * budget mark is the whole message. That geometry is decided here and tested
 * here.
 */

export type RowKind = 'pending' | 'running' | 'fits' | 'tight' | 'over' | 'failed' | 'cancelled'

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
 * The budget as a fraction of the original file.
 *
 * Capped at the whole file because a budget is a ceiling and never a target
 * (D24): asked for 500 KB with a 300 KB photo in hand, the effective limit is
 * the photo, and the mark belongs at the right edge rather than off the track.
 */
function budgetMark(item: QueueItem, profile: Profile): number | null {
  if (profile.maxBytes === undefined || item.bytesBefore <= 0) return null
  return Math.min(profile.maxBytes, item.bytesBefore) / item.bytesBefore
}

export function rowKind(item: QueueItem, profile: Profile): RowKind {
  if (item.status !== 'done') return item.status

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

export function weightBar(item: QueueItem, profile: Profile): WeightBar | null {
  /*
   * A file that failed has no final weight to plot, and one that was cancelled
   * never produced one. An empty track would read as a file that compressed
   * to nothing, which is the opposite of what happened.
   */
  if (item.status === 'failed' || item.status === 'cancelled') return null

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

export function rowNote(item: QueueItem, formatters: Formatters): string {
  switch (item.status) {
    case 'pending':
      return 'En cola'
    case 'running':
      return 'Comprimiendo'
    case 'cancelled':
      return 'Cancelado'
    case 'failed':
      return describeJobError(item.error)
    case 'done': {
      const size = formatters.dimensions(item.outcome.width, item.outcome.height)
      return item.outcome.shrunkForBudget === null ? size : `Se redujo a ${size} para entrar`
    }
  }
}

/** Negative when the result grew, which the interface shows rather than hides. */
export function savedRatio(item: QueueItem): number | null {
  if (item.status !== 'done' || item.bytesBefore <= 0) return null
  return 1 - item.outcome.bytesAfter / item.bytesBefore
}
