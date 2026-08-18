import type { Formatters } from './format'
import type { FilterCounts, FilterId } from './queue-view'

/**
 * Two hundred rows is the size at which "show me the ones that did not fit"
 * stops being a nicety. Filters that would match nothing are not offered:
 * an empty result the user asked for is fine, an empty result they had no way
 * to predict is a dead end.
 */

const FILTERS: readonly { readonly id: FilterId; readonly label: string; readonly dot: string }[] =
  [
    { id: 'todos', label: 'Todos', dot: '' },
    { id: 'fits', label: 'Entraron con margen', dot: 'bg-fits' },
    { id: 'tight', label: 'Justos', dot: 'bg-tight' },
    { id: 'over', label: 'No entraron', dot: 'bg-over' },
    { id: 'failed', label: 'Fallaron', dot: 'bg-over' },
    { id: 'cancelled', label: 'Cancelados', dot: 'bg-ink-soft' },
    { id: 'pending', label: 'En cola', dot: 'bg-rule' },
  ]

type Props = {
  readonly counts: FilterCounts
  readonly active: FilterId
  readonly formatters: Formatters
  readonly selectedCount: number
  readonly selectedDone: number
  readonly onFilter: (filter: FilterId) => void
  readonly onRecompress: () => void
  readonly onRemove: () => void
  readonly onSave: () => void
}

export function FilterBar({
  counts,
  active,
  formatters,
  selectedCount,
  selectedDone,
  onFilter,
  onRecompress,
  onRemove,
  onSave,
}: Props) {
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-x-1 gap-y-1.5 border-b border-rule px-4 py-1.5">
      {FILTERS.filter((filter) => filter.id === 'todos' || counts[filter.id] > 0).map((filter) => {
        const on = filter.id === active

        return (
          <button
            key={filter.id}
            type="button"
            onClick={() => onFilter(filter.id)}
            aria-pressed={on}
            className={`flex h-6 items-center gap-1.5 rounded-sm border px-2 text-xs leading-4 whitespace-nowrap coarse:h-11 ${
              on
                ? 'border-ink bg-ink text-paper'
                : 'border-rule text-ink-soft hover:border-ink-soft'
            }`}
          >
            {filter.dot === '' ? null : <span className={`size-1.5 ${filter.dot}`} />}
            <span>{filter.label}</span>
            <span className="tnum text-[11px]">{formatters.count(counts[filter.id])}</span>
          </button>
        )
      })}

      <div className="flex-1" />

      {selectedCount > 0 ? (
        <div className="flex items-center gap-2">
          <span className="tnum text-xs whitespace-nowrap text-ink-soft">
            {formatters.count(selectedCount)} seleccionados
          </span>
          <button
            type="button"
            onClick={onRecompress}
            className="h-6 rounded-sm border border-rule px-2 text-xs whitespace-nowrap hover:border-ink-soft coarse:h-11"
          >
            Recomprimir
          </button>
          {selectedDone > 0 ? (
            <button
              type="button"
              onClick={onSave}
              className="h-6 rounded-sm bg-fits px-2 text-xs whitespace-nowrap text-paper coarse:h-11"
            >
              Guardar {formatters.count(selectedDone)}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onRemove}
            className="h-6 rounded-sm border border-rule px-2 text-xs whitespace-nowrap hover:border-ink-soft coarse:h-11"
          >
            Quitar
          </button>
        </div>
      ) : null}
    </div>
  )
}
