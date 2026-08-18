import type { QueueTotals } from '../state/queue'
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
  { key: 'fits', label: 'con margen', fill: 'var(--color-fits)', text: 'text-fits' },
  { key: 'tight', label: 'justos', fill: 'var(--color-tight)', text: 'text-tight' },
  {
    key: 'over',
    label: 'no entraron',
    fill: 'repeating-linear-gradient(135deg, var(--color-over) 0 2px, var(--color-paper) 2px 4px)',
    text: 'text-over',
  },
  { key: 'failed', label: 'fallaron', fill: 'var(--color-over)', text: 'text-over' },
  { key: 'cancelled', label: 'cancelados', fill: 'var(--color-ink-soft)', text: 'text-ink-soft' },
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
            ? `${formatters.count(totals.done)} ${totals.done === 1 ? 'imagen comprimida' : 'imágenes comprimidas'}`
            : `${formatters.count(queued)} ${queued === 1 ? 'imagen en la cola' : 'imágenes en la cola'}`}
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
              {formatters.percent(totals.savedRatio)} menos
            </p>
          </>
        ) : null}

        <div className="flex-1" />

        <ul className="flex flex-wrap items-center gap-3">
          {present.map((segment) => (
            <li key={segment.key} className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="size-2" style={{ background: segment.fill }} />
              <span className="text-xs leading-4 text-ink-soft">{segment.label}</span>
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
          Vaciar la cola
        </button>
      </div>
    </footer>
  )
}
