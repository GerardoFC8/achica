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
function describeTarget(profile: Profile, formatters: Formatters): string {
  if (profile.maxBytes !== undefined) return `máx. ${formatters.bytes(profile.maxBytes)}`

  const bound = profile.maxWidth ?? profile.maxHeight
  const size = bound === undefined ? 'cualquier tamaño' : `máx. ${bound} px`

  return profile.format === 'keep'
    ? `${size}, formato original`
    : `${size}, ${profile.format.toUpperCase()}`
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
): readonly RowDetail[] {
  const target: RowDetail = { label: 'Destino pide', value: describeTarget(profile, formatters) }

  if (item.status === 'failed') {
    // The message in full, because the row truncates it and it is the only
    // content a failed row has. The code goes with it for a bug report.
    return [
      { label: 'Qué pasó', value: describeJobError(item.error), kind: 'failed' },
      { label: 'Código', value: item.error.code },
      { label: 'Origen', value: formatters.bytes(item.bytesBefore) },
    ]
  }

  if (item.status !== 'done') {
    return [
      { label: 'Origen', value: formatters.bytes(item.bytesBefore) },
      target,
      ...(item.status === 'running'
        ? [{ label: 'Avance', value: 'no medible dentro de un archivo' }]
        : []),
    ]
  }

  const { outcome } = item
  const kind = rowKind(item, profile)
  const ceiling =
    profile.maxBytes === undefined ? null : Math.min(profile.maxBytes, item.bytesBefore)
  const margin = ceiling === null ? null : ceiling - outcome.bytesAfter

  return [
    {
      label: 'Salida',
      value:
        outcome.quality === null
          ? outcome.format.toUpperCase()
          : `${outcome.format.toUpperCase()} · calidad ${formatters.count(outcome.quality)}`,
    },
    { label: 'Dimensiones', value: formatters.dimensions(outcome.width, outcome.height) },
    { label: 'Pasadas de codificación', value: formatters.count(outcome.encodes) },
    target,
    ...(margin === null
      ? []
      : [
          {
            label: margin >= 0 ? 'Margen' : 'Exceso',
            value: formatters.bytes(Math.abs(margin)),
            kind,
          },
        ]),
    {
      label: 'Ahorro',
      value: `${formatters.bytes(item.bytesBefore - outcome.bytesAfter)} · ${formatters.percent(savedRatio(item) ?? 0)}`,
      kind,
    },
    { label: 'Tiempo en el worker', value: formatters.ms(item.ms) },
  ]
}
