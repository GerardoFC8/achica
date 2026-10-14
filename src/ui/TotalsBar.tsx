import type { QueueTotals } from '../state/queue'
import { useCopy } from './copy'
import type { Formatters } from './format'
import type { FilterCounts } from './queue-view'

/**
 * The figure the user came for, and above it the batch as one line.
 *
 * The strip is the same idea as the weight bar taken up a level: the whole
 * queue read at a glance, in proportion, without counting rows. The stretch
 * that did not fit is hatched there too, so the reading survives without
 * colour.
 */

type Props = {
  readonly totals: QueueTotals
  readonly counts: FilterCounts
  readonly queued: number
  readonly bytesQueued: number
  readonly formatters: Formatters
  /** What the last save did. Empty most of the time, and that is the point. */
  readonly flash: string
  readonly onClear: () => void
}

const SEGMENTS = [
  { key: 'fits', fill: 'var(--color-fits)', text: 'text-fits' },
  { key: 'tight', fill: 'var(--color-tight)', text: 'text-tight' },
  {
    key: 'over',
    fill: 'repeating-linear-gradient(135deg, var(--color-over) 0 2px, var(--color-paper) 2px 4px)',
    text: 'text-over',
  },
  { key: 'failed', fill: 'var(--color-over)', text: 'text-over' },
  { key: 'cancelled', fill: 'var(--color-ink-soft)', text: 'text-ink-soft' },
] as const

export function TotalsBar({
  totals,
  counts,
  queued,
  bytesQueued,
  formatters,
  flash,
  onClear,
}: Props) {
  const { totals: words } = useCopy()
  const present = SEGMENTS.filter((segment) => counts[segment.key] > 0)
  const finished = totals.done > 0

  return (
    <footer className="flex flex-col border-t border-rule">
      <div className="flex h-1.5 shrink-0 bg-rule" aria-hidden="true">
        {present.map((segment) => (
          <div
            key={segment.key}
            style={{
              width: `${((counts[segment.key] / Math.max(1, counts.todos)) * 100).toFixed(2)}%`,
              background: segment.fill,
            }}
          />
        ))}
      </div>

      <div className="flex min-h-13 flex-wrap items-center gap-x-3.5 gap-y-1.5 px-4 py-1.5">
        <p className="tnum text-sm whitespace-nowrap">
          {finished
            ? words.compressed(totals.done, formatters.count(totals.done))
            : words.queued(queued, formatters.count(queued))}
        </p>
        <span className="text-ink-soft">·</span>
        <p className="tnum text-sm whitespace-nowrap">
          {finished
            ? `${formatters.bytes(totals.bytesBefore)} → ${formatters.bytes(totals.bytesAfter)}`
            : formatters.bytes(bytesQueued)}
        </p>
        {finished ? (
          <>
            <span className="text-ink-soft">·</span>
            <p
              className={`tnum text-sm whitespace-nowrap ${
                totals.savedRatio > 0 ? 'text-fits' : 'text-ink-soft'
              }`}
            >
              {words.less(formatters.percent(totals.savedRatio))}
            </p>
          </>
        ) : null}

        <div className="flex-1" />

        <ul className="flex flex-wrap items-center gap-3">
          {present.map((segment) => (
            <li key={segment.key} className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="size-2" style={{ background: segment.fill }} />
              <span className="text-xs leading-4 text-ink-soft">{words.segments[segment.key]}</span>
              <span className={`tnum text-xs leading-4 ${segment.text}`}>
                {formatters.count(counts[segment.key])}
              </span>
            </li>
          ))}
        </ul>

        {flash === '' ? null : (
          <p role="status" className="text-xs leading-4 whitespace-nowrap text-fits">
            {flash}
          </p>
        )}

        <button
          type="button"
          onClick={onClear}
          className="h-7 rounded-sm border border-rule px-2.5 text-[13px] leading-4 whitespace-nowrap hover:border-ink-soft coarse:h-11"
        >
          {words.clear}
        </button>
      </div>
    </footer>
  )
}
