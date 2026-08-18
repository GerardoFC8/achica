import type { RowKind } from './row-model'
import type { WeightBar as Bar } from './row-model'
import { FILL_TONE } from './tone'

/**
 * The one distinctive element in the interface.
 *
 * The track is the file's original weight, the fill is what it weighs now, and
 * the mark is where its budget falls. What makes the row readable is that
 * geometry — a fill that stops short of the mark, touches it, or passes it —
 * so the colour is a second reading and never the only one.
 *
 * Per-row normalisation is deliberate: the track is always this file's
 * original size, so what compares across rows is the proportion, which is the
 * question being asked. A scale shared across the batch would make the small
 * file invisible next to the large one.
 */

type Props = {
  readonly bar: Bar | null
  readonly kind: RowKind
  /** What the bar says, in words, for anyone who is not reading pixels. */
  readonly description: string
}

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`

/**
 * The stretch past the budget is hatched, not merely tinted. Someone who
 * cannot tell violet from teal still sees that this piece is made of stripes
 * and the rest is solid.
 */
const HATCH =
  'repeating-linear-gradient(135deg, var(--color-over) 0 2px, var(--color-paper) 2px 4px)'

export function WeightBar({ bar, kind, description }: Props) {
  // A file that failed has no final weight to plot, and an empty track would
  // read as one that compressed to nothing.
  if (bar === null) return null

  const busy = kind === 'running'

  return (
    <div className="relative flex h-2.5 items-center" role="img" aria-label={description}>
      <div
        data-busy={busy}
        className="absolute inset-x-0 top-px h-2 overflow-hidden bg-rule"
        style={busy ? { animation: 'track-busy 1.2s ease-in-out infinite' } : undefined}
      >
        <div
          className={`absolute inset-y-0 left-0 ${FILL_TONE[kind]}`}
          style={{ width: percent(bar.fill) }}
        />
        {bar.overflow === null ? null : (
          <div
            className="absolute inset-y-0"
            style={{
              left: percent(bar.overflow.start),
              width: percent(bar.overflow.width),
              background: HATCH,
            }}
          />
        )}
      </div>
      {bar.mark === null ? null : (
        <div
          className="absolute -top-px -bottom-px w-0.5 bg-ink"
          style={{ left: percent(bar.mark) }}
        />
      )}
    </div>
  )
}
