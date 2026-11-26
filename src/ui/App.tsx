import { useMemo, useState } from 'react'
import type { OutputFormat } from '../core/codecs/encode'
import { PERFILES, type Profile } from '../core/profiles'
import type { ToolId } from '../tools/registry'
import { totalsOf } from '../state/queue'
import { queueActions, useQueue } from '../state/queue-store'
import { NO_BUDGET, type BudgetChoice } from './budget'
import { Comparator } from './Comparator'
import { DropZone } from './DropZone'
import { FilterBar } from './FilterBar'
import { DEFAULT_FORMAT } from './format-choice'
import {
  buildRows,
  countsOf,
  visibleRows,
  type FilterId,
  type SortDirection,
  type SortKey,
} from './queue-view'
import { QueueTable } from './QueueTable'
import { DEFAULT_RESIZE, type ResizeChoice } from './resize-choice'
import { ToolProvider } from './tool-context'
import { planForTool, profileForTool, type ToolChoices } from './tool-profiles'
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

type Props = {
  /** Which tool this screen is. Required: there is no tool to fall back to. */
  readonly tool: ToolId
}

export function App({ tool }: Props) {
  return (
    <ToolProvider value={tool}>
      <Screen tool={tool} />
    </ToolProvider>
  )
}

function Screen({ tool }: Props) {
  const formatters = useFormatters()
  const items = useQueue((state) => state.items)
  const save = useSave(formatters)

  const [destination, setDestination] = useState<Profile>(() => PERFILES[0] as Profile)
  const [budget, setBudget] = useState<BudgetChoice>(NO_BUDGET)
  const [resize, setResize] = useState<ResizeChoice>(DEFAULT_RESIZE)
  const [format, setFormat] = useState<OutputFormat>(DEFAULT_FORMAT)
  const choices = useMemo<ToolChoices>(
    () => ({ destination, budget, resize, format }),
    [destination, budget, resize, format],
  )
  // What every row is measured against: the tool's own choice, with the weight
  // ceiling in for the compressor.
  const profile = useMemo(() => profileForTool(tool, choices), [tool, choices])
  const [filter, setFilter] = useState<FilterId>('todos')
  const [sortKey, setSortKey] = useState<SortKey>('orden')
  const [direction, setDirection] = useState<SortDirection>('asc')
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [comparing, setComparing] = useState<string | null>(null)

  const rows = useMemo(() => buildRows(items, profile, tool), [items, profile, tool])
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
        destination={destination}
        budget={budget}
        resize={resize}
        format={format}
        formatters={formatters}
        pending={pending}
        done={done}
        running={running}
        canUseFolder={save.canUseFolder}
        onSelectProfile={setDestination}
        onBudget={setBudget}
        onResize={setResize}
        onFormat={setFormat}
        onStart={() => queueActions.start(planForTool(tool, choices))}
        onCancelAll={queueActions.cancelAll}
        onDownload={() => void save.download(items)}
        onSaveToFolder={() => void save.toFolder(items)}
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
              onSave={() => void save.download(selectedItems)}
              onRecompress={() => queueActions.requeue(selectedIds, planForTool(tool, choices))}
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
