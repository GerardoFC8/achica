import { useMemo, useState } from 'react'
import { PERFILES, toOutputPlan, type Profile } from '../core/profiles'
import { totalsOf } from '../state/queue'
import { queueActions, useQueue } from '../state/queue-store'
import { Comparator } from './Comparator'
import { DropZone } from './DropZone'
import { FilterBar } from './FilterBar'
import {
  buildRows,
  countsOf,
  visibleRows,
  type FilterId,
  type SortDirection,
  type SortKey,
} from './queue-view'
import { QueueTable } from './QueueTable'
import { Toolbar } from './Toolbar'
import { TotalsBar } from './TotalsBar'
import { useFormatters } from './useFormatters'
import { useSave } from './useSave'

/**
 * The whole interface, and the only place that holds view state.
 *
 * The queue itself lives in the store, which believes the pool; everything
 * here — which destination is chosen, what is filtered, what is selected — is
 * about looking at the queue rather than about what it is doing.
 */

const toggle = (set: ReadonlySet<string>, id: string): Set<string> => {
  const next = new Set(set)
  if (!next.delete(id)) next.add(id)
  return next
}

export function App() {
  const formatters = useFormatters()
  const items = useQueue((state) => state.items)
  const save = useSave(formatters)

  const [profile, setProfile] = useState<Profile>(() => PERFILES[0] as Profile)
  const [filter, setFilter] = useState<FilterId>('todos')
  const [sortKey, setSortKey] = useState<SortKey>('orden')
  const [direction, setDirection] = useState<SortDirection>('asc')
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [comparing, setComparing] = useState<string | null>(null)

  const rows = useMemo(() => buildRows(items, profile), [items, profile])
  const counts = useMemo(() => countsOf(rows), [rows])
  const visible = useMemo(
    () => visibleRows(rows, { filter, sortKey, direction }),
    [rows, filter, sortKey, direction],
  )
  const totals = useMemo(() => totalsOf(items), [items])

  const running = items.some((item) => item.status === 'running')
  const pending = items.filter((item) => item.status === 'pending').length
  const done = items.filter((item) => item.status === 'done').length
  const compared = items.find((item) => item.id === comparing)

  const sortBy = (key: SortKey): void => {
    if (key === sortKey) setDirection(direction === 'asc' ? 'desc' : 'asc')
    else {
      setSortKey(key)
      setDirection('asc')
    }
  }

  const selectedIds = [...selected].filter((id) => items.some((item) => item.id === id))
  const selectedItems = items.filter((item) => selected.has(item.id))
  const selectedDone = selectedItems.filter((item) => item.status === 'done').length

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-paper text-ink">
      <Toolbar
        profile={profile}
        formatters={formatters}
        pending={pending}
        done={done}
        running={running}
        toFolder={save.toFolder}
        onSelectProfile={setProfile}
        onStart={() => queueActions.start(toOutputPlan(profile))}
        onCancelAll={queueActions.cancelAll}
        onSave={() => void save.saveAll(items)}
      />

      <main className="flex min-h-0 flex-1 flex-col">
        {items.length === 0 ? (
          <DropZone onFiles={(files) => queueActions.add(files)} />
        ) : (
          <>
            <FilterBar
              counts={counts}
              active={filter}
              formatters={formatters}
              selectedCount={selectedIds.length}
              selectedDone={selectedDone}
              onFilter={setFilter}
              onSave={() => void save.saveAll(selectedItems)}
              onRecompress={() => queueActions.requeue(selectedIds, toOutputPlan(profile))}
              onRemove={() => {
                queueActions.remove(selectedIds)
                setSelected(new Set())
              }}
            />

            <QueueTable
              rows={visible}
              profile={profile}
              formatters={formatters}
              selected={selected}
              expanded={expanded}
              sortKey={sortKey}
              direction={direction}
              onSort={sortBy}
              onToggleSelect={(id) => setSelected((set) => toggle(set, id))}
              onToggleDetail={(id) => setExpanded((set) => toggle(set, id))}
              onToggleAll={() =>
                setSelected((set) => {
                  const all = visible.length > 0 && visible.every((row) => set.has(row.item.id))
                  const next = new Set(set)
                  for (const row of visible) {
                    if (all) next.delete(row.item.id)
                    else next.add(row.item.id)
                  }
                  return next
                })
              }
              onCancel={queueActions.cancel}
              onCompare={setComparing}
              onSave={(id) => {
                const item = items.find((candidate) => candidate.id === id)
                if (item !== undefined) save.saveRow(item)
              }}
            />
          </>
        )}
      </main>

      {items.length === 0 ? null : (
        <TotalsBar
          totals={totals}
          counts={counts}
          queued={items.length}
          bytesQueued={items.reduce((sum, item) => sum + item.bytesBefore, 0)}
          formatters={formatters}
          flash={save.flash}
          onClear={() => {
            queueActions.clear()
            setSelected(new Set())
            setExpanded(new Set())
            setComparing(null)
          }}
        />
      )}

      {compared?.status === 'done' ? (
        <Comparator
          item={compared}
          profile={profile}
          formatters={formatters}
          onClose={() => setComparing(null)}
        />
      ) : null}
    </div>
  )
}
