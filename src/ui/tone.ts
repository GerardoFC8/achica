import type { RowKind } from './row-model'

/**
 * A row's outcome maps to one of the three signals, and cancelled or waiting
 * rows map to none of them.
 *
 * "No entró" and "falló" share the same signal on purpose: the spec treats
 * them as one state, and they are one from where the user sits — this file did
 * not come back the way it was asked for. What separates them is the wording
 * in the row, not the colour.
 */

export const TEXT_TONE: Readonly<Record<RowKind, string>> = {
  pending: 'text-ink-soft',
  running: 'text-ink-soft',
  fits: 'text-fits',
  tight: 'text-tight',
  over: 'text-over',
  failed: 'text-over',
  cancelled: 'text-ink-soft',
}

export const FILL_TONE: Readonly<Record<RowKind, string>> = {
  pending: 'bg-rule',
  running: 'bg-rule',
  fits: 'bg-fits',
  tight: 'bg-tight',
  over: 'bg-over',
  failed: 'bg-over',
  cancelled: 'bg-ink-soft',
}

/** The 3 px stripe down the edge of a row, where a scanning eye lands first. */
export const STRIPE_TONE: Readonly<Record<RowKind, string>> = {
  pending: 'var(--color-rule)',
  running: 'var(--color-rule)',
  fits: 'var(--color-fits)',
  tight: 'var(--color-tight)',
  over: 'var(--color-over)',
  failed: 'var(--color-over)',
  cancelled: 'var(--color-ink-soft)',
}
