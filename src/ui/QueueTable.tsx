import type { Profile } from '../core/profiles'
import type { Formatters } from './format'
import type { SortDirection, SortKey, ViewRow } from './queue-view'
import { QueueRow } from './QueueRow'

type Props = {
  readonly rows: readonly ViewRow[]
  readonly profile: Profile
  readonly formatters: Formatters
  readonly selected: ReadonlySet<string>
  readonly expanded: ReadonlySet<string>
  readonly sortKey: SortKey
  readonly direction: SortDirection
  readonly onSort: (key: SortKey) => void
  readonly onToggleSelect: (id: string) => void
  readonly onToggleDetail: (id: string) => void
  readonly onToggleAll: () => void
  readonly onCancel: (id: string) => void
  readonly onCompare: (id: string) => void
}

const COLUMNS: readonly { readonly key: SortKey; readonly label: string; readonly cell: string }[] =
  [
    { key: 'name', label: 'Archivo', cell: 'cell-name' },
    { key: 'before', label: 'Antes', cell: 'cell-before' },
    { key: 'after', label: 'Después', cell: 'cell-after' },
    { key: 'saved', label: 'Ahorro', cell: 'cell-saved' },
    { key: 'time', label: 'Tiempo', cell: 'cell-time' },
  ]

export function QueueTable({
  rows,
  profile,
  formatters,
  selected,
  expanded,
  sortKey,
  direction,
  onSort,
  onToggleSelect,
  onToggleDetail,
  onToggleAll,
  onCancel,
  onCompare,
}: Props) {
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.item.id))

  return (
    <div role="table" aria-label="Cola de compresión" className="flex min-h-0 flex-1 flex-col">
      <div
        role="row"
        className="queue-head hidden border-b border-rule text-xs leading-4 text-ink-soft md:grid"
      >
        <div role="columnheader" className="cell-select flex items-center">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={onToggleAll}
            aria-label="Seleccionar todo lo visible"
            className="size-4 accent-ink"
          />
        </div>

        {COLUMNS.map((column) => (
          <div
            key={column.key}
            role="columnheader"
            className={`${column.cell} ${column.key === 'name' ? '' : 'hidden md:block'}`}
            aria-sort={
              sortKey === column.key ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'
            }
          >
            <button
              type="button"
              onClick={() => onSort(column.key)}
              className={`w-full cursor-pointer ${column.key === 'name' ? 'text-left' : 'text-right'}`}
            >
              {column.label}
              {sortKey === column.key ? (direction === 'asc' ? ' ↑' : ' ↓') : ''}
            </button>
          </div>
        ))}

        <div role="columnheader" className="cell-bar hidden md:block">
          Peso contra presupuesto
        </div>
        <div role="columnheader" className="cell-actions hidden md:block" />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {rows.map((row) => (
          <QueueRow
            key={row.item.id}
            item={row.item}
            kind={row.kind}
            profile={profile}
            formatters={formatters}
            selected={selected.has(row.item.id)}
            expanded={expanded.has(row.item.id)}
            onToggleSelect={() => onToggleSelect(row.item.id)}
            onToggleDetail={() => onToggleDetail(row.item.id)}
            onCancel={() => onCancel(row.item.id)}
            onCompare={() => onCompare(row.item.id)}
          />
        ))}
      </div>
    </div>
  )
}
