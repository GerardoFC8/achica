import type { Profile } from '../core/profiles'
import type { QueueItem } from '../state/queue'
import { rowKind, savedRatio, type RowKind } from './row-model'

/**
 * Turning the queue into what the table shows: which rows, in what order.
 *
 * All of it is arithmetic over an array, which is why it lives here and not
 * inside a component. Two hundred rows is exactly the size at which sorting
 * by saving or filtering to "no entraron" stops being a nicety.
 */

export type FilterId = 'todos' | 'fits' | 'tight' | 'over' | 'failed' | 'cancelled' | 'pending'

export type SortKey = 'orden' | 'name' | 'before' | 'after' | 'saved' | 'time'

export type SortDirection = 'asc' | 'desc'

export type ViewRow = {
  readonly item: QueueItem
  /** Position in the queue, which is also the tie-break for every sort. */
  readonly index: number
  readonly kind: RowKind
}

export type ViewOptions = {
  readonly filter: FilterId
  readonly sortKey: SortKey
  readonly direction: SortDirection
}

export type FilterCounts = Readonly<Record<FilterId, number>>

export function buildRows(items: readonly QueueItem[], profile: Profile): readonly ViewRow[] {
  return items.map((item, index) => ({ item, index, kind: rowKind(item, profile) }))
}

export function countsOf(rows: readonly ViewRow[]): FilterCounts {
  const counts: Record<FilterId, number> = {
    todos: rows.length,
    fits: 0,
    tight: 0,
    over: 0,
    failed: 0,
    cancelled: 0,
    pending: 0,
  }

  for (const row of rows) {
    // A file being encoded has not landed anywhere yet, so it belongs with the
    // ones still waiting rather than in a state of its own.
    if (row.kind === 'pending' || row.kind === 'running') counts.pending += 1
    else counts[row.kind] += 1
  }

  return counts
}

function matches(row: ViewRow, filter: FilterId): boolean {
  if (filter === 'todos') return true
  if (filter === 'pending') return row.kind === 'pending' || row.kind === 'running'
  return row.kind === filter
}

/**
 * Rows with no result sort last whichever way the column is pointing.
 *
 * Treating a file that has not finished as if it saved nothing would bury the
 * results the user is actually reading, and reversing the sort would then dump
 * them on top. Infinity keeps them together at the end either way.
 */
function sortValue(row: ViewRow, key: SortKey): number | string {
  const { item } = row

  if (key === 'name') return item.name.toLowerCase()
  if (key === 'before') return item.bytesBefore
  if (key === 'orden') return row.index

  if (item.status !== 'done') return Number.POSITIVE_INFINITY

  if (key === 'after') return item.outcome.bytesAfter
  if (key === 'time') return item.ms

  // The column is called "Ahorro", so ascending is the smallest saving first,
  // the same way ascending is the smallest number in every other column.
  return savedRatio(item) ?? 0
}

export function visibleRows(
  rows: readonly ViewRow[],
  { filter, sortKey, direction }: ViewOptions,
): readonly ViewRow[] {
  const step = direction === 'asc' ? 1 : -1

  return rows
    .filter((row) => matches(row, filter))
    .toSorted((a, b) => {
      const left = sortValue(a, sortKey)
      const right = sortValue(b, sortKey)

      if (left === right) return a.index - b.index

      // Unfinished rows stay at the end even when the sort is reversed.
      if (left === Number.POSITIVE_INFINITY) return 1
      if (right === Number.POSITIVE_INFINITY) return -1

      return left > right ? step : -step
    })
}
