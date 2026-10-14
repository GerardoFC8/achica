import type { Profile } from '../core/profiles'
import type { QueueItem } from '../state/queue'
import { useCopy, type Copy } from './copy'
import type { Formatters } from './format'
import { rowDetails, rowNote, savedRatio, weightBar, type RowKind } from './row-model'
import { STRIPE_TONE, TEXT_TONE } from './tone'
import { WeightBar } from './WeightBar'

type Props = {
  readonly item: QueueItem
  readonly kind: RowKind
  readonly profile: Profile
  readonly formatters: Formatters
  readonly selected: boolean
  readonly expanded: boolean
  readonly onToggleSelect: () => void
  readonly onToggleDetail: () => void
  readonly onCancel: () => void
  readonly onCompare: () => void
  readonly onSave: () => void
}

/** Says the bar out loud, for anyone not reading pixels. */
function describeBar(
  item: QueueItem,
  profile: Profile,
  formatters: Formatters,
  copy: Copy,
): string {
  if (item.status !== 'done') return rowNote(item, formatters, copy)

  return copy.row.bar(
    formatters.bytes(item.bytesBefore),
    formatters.bytes(item.outcome.bytesAfter),
    profile.maxBytes === undefined ? null : formatters.bytes(profile.maxBytes),
  )
}

export function QueueRow({
  item,
  kind,
  profile,
  formatters,
  selected,
  expanded,
  onToggleSelect,
  onToggleDetail,
  onCancel,
  onCompare,
  onSave,
}: Props) {
  const saved = savedRatio(item)
  const tone = TEXT_TONE[kind]
  const running = item.status === 'pending' || item.status === 'running'
  const copy = useCopy()
  const note = rowNote(item, formatters, copy)
  const details = expanded ? rowDetails(item, profile, formatters, copy) : []

  const after = item.status === 'done' ? formatters.bytes(item.outcome.bytesAfter) : '—'
  const savedText = saved === null ? '' : formatters.percent(saved)
  const time = item.status === 'done' ? formatters.ms(item.ms) : ''

  return (
    <div
      role="row"
      className={`border-b border-rule ${selected ? 'bg-raised' : ''}`}
      // The stripe restates the outcome at the edge of the row, where the eye
      // scanning a column of two hundred lands first.
      style={{ boxShadow: `inset 3px 0 0 ${STRIPE_TONE[kind]}` }}
    >
      <div className={`queue-row ${item.status === 'cancelled' ? 'text-ink-soft' : 'text-ink'}`}>
        <div role="cell" className="cell-select flex items-center">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label={copy.row.select(item.name)}
            className="size-5 accent-ink coarse:size-6 md:size-4"
          />
        </div>

        <div role="cell" className="cell-name flex min-w-0 items-baseline gap-2">
          <button
            type="button"
            onClick={onToggleDetail}
            aria-expanded={expanded}
            className="min-w-0 shrink truncate text-left text-[15px] leading-5 font-medium hover:underline md:text-[13px] md:leading-4"
          >
            {item.name}
          </button>
          <span
            title={note}
            className={`min-w-0 shrink truncate text-[13px] leading-4 md:text-xs ${
              item.status === 'failed' ? 'text-over' : 'text-ink-soft'
            }`}
          >
            {note}
          </span>
          {/* Pushes nothing: keeps the note beside the name instead of letting
              it drift to the far edge of a wide column. */}
          <span className="flex-1" />
        </div>

        {/* Narrow screens get one line of numbers instead of four columns. */}
        <div role="cell" className="cell-numbers tnum flex items-baseline gap-3 text-sm md:hidden">
          <span>{formatters.bytes(item.bytesBefore)}</span>
          <span className="text-ink-soft">→</span>
          <span className={tone}>{after}</span>
          <span className={tone}>{savedText}</span>
          <span className="flex-1" />
          <span className="text-ink-soft">{time}</span>
        </div>

        <div role="cell" className="cell-before tnum hidden text-xs md:block">
          {formatters.bytes(item.bytesBefore)}
        </div>
        <div role="cell" className={`cell-after tnum hidden text-xs md:block ${tone}`}>
          {after}
        </div>
        <div role="cell" className={`cell-saved tnum hidden text-xs md:block ${tone}`}>
          {savedText}
        </div>

        <div role="cell" className="cell-bar">
          <WeightBar
            bar={weightBar(item, profile)}
            kind={kind}
            description={describeBar(item, profile, formatters, copy)}
          />
        </div>

        <div role="cell" className="cell-time tnum hidden text-xs text-ink-soft md:block">
          {time}
        </div>

        <div role="cell" className="cell-actions flex justify-end gap-2 md:gap-1">
          {running ? (
            <button
              type="button"
              onClick={onCancel}
              className="h-11 rounded-sm border border-rule px-3 text-[13px] text-ink-soft hover:border-ink-soft hover:text-ink md:h-5 md:border-0 md:px-0 md:text-xs"
            >
              {copy.row.cancel}
            </button>
          ) : null}
          {item.status === 'done' ? (
            <>
              <button
                type="button"
                onClick={onCompare}
                className="h-11 rounded-sm border border-rule px-3 text-[13px] hover:border-ink-soft md:h-5 md:px-2 md:text-xs"
              >
                {copy.row.compare}
              </button>
              <button
                type="button"
                onClick={onSave}
                title={copy.row.downloadTitle(item.name)}
                className="h-11 rounded-sm border border-rule px-3 text-[13px] text-fits hover:bg-fits hover:text-paper md:h-5 md:px-2 md:text-xs"
              >
                {copy.row.download}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {expanded ? (
        <dl className="grid gap-x-6 gap-y-0.5 border-t border-rule bg-raised px-4 py-2 md:grid-cols-[repeat(auto-fit,minmax(240px,1fr))]">
          {details.map((detail) => (
            <div key={detail.label} className="flex min-w-0 items-baseline gap-2">
              <dt className="shrink-0 text-xs text-ink-soft">{detail.label}</dt>
              <span className="flex-1 -translate-y-[3px] border-b border-dotted border-rule" />
              <dd
                className={`tnum min-w-0 shrink truncate text-xs ${
                  detail.kind === undefined ? '' : TEXT_TONE[detail.kind]
                }`}
              >
                {detail.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}
