import { useMemo, useState } from 'react'
import type { OutputFormat } from '../core/codecs/encode'
import type { Profile } from '../core/profiles'
import type { ToolId } from '../tools/registry'
import { totalsOf } from '../state/queue'
import { auditActions, useAudit } from '../state/audit-store'
import { queueActions, useQueue } from '../state/queue-store'
import { NO_BUDGET, type BudgetChoice } from './budget'
import { AuditSummary } from './AuditSummary'
import { Comparator } from './Comparator'
import { useCopy } from './copy'
import { DropZone } from './DropZone'
import { FilterBar } from './FilterBar'
import { DEFAULT_FORMAT } from './format-choice'
import { readDroppedHar, type IntakeError } from './har-intake'
import { describeIntakeError } from './messages'
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
import { defaultDestination, planForTool, profileForTool, type ToolChoices } from './tool-profiles'
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

  const copy = useCopy()
  const audit = useAudit((state) => state.audit)
  const [destination, setDestination] = useState<Profile>(() => defaultDestination(tool))
  // The destination the audit's figures were produced with, which is not
  // necessarily the one selected now: changing it measures nothing until the
  // images run again (D60).
  const [measuredWith, setMeasuredWith] = useState<Profile | null>(null)
  const [reading, setReading] = useState(false)
  const [harError, setHarError] = useState<IntakeError | null>(null)
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
  const totals = useMemo(() => totalsOf(items, { onlyLighter: tool === 'auditar' }), [items, tool])
  const alreadyFine = items.filter(
    (item) => item.status === 'done' && item.outcome.bytesAfter >= item.bytesBefore,
  ).length

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

  /**
   * The audit takes one HAR and turns it into the queue's files. Nothing is
   * added unless the whole read worked, so a refused file leaves no half of a
   * batch behind.
   */
  const takeHar = async (files: readonly File[]): Promise<void> => {
    setHarError(null)
    setReading(true)
    const result = await readDroppedHar(files)
    setReading(false)

    if (!result.ok) {
      setHarError(result.error)
      return
    }
    auditActions.set(result.value.audit)
    queueActions.add(result.value.files)
  }

  const run = (plan: ReturnType<typeof planForTool>, again?: readonly string[]): void => {
    if (tool === 'auditar') setMeasuredWith(destination)
    if (again === undefined) queueActions.start(plan)
    else queueActions.requeue(again, plan)
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
        onStart={() => run(planForTool(tool, choices))}
        onCancelAll={queueActions.cancelAll}
        onDownload={() => void save.download(items)}
        onSaveToFolder={() => void save.toFolder(items)}
      />

      <main className="flex min-h-0 flex-1 flex-col">
        {items.length === 0 ? (
          <DropZone
            onFiles={(files) =>
              tool === 'auditar' ? void takeHar(files) : queueActions.add(files)
            }
            reading={reading}
            error={harError === null ? null : describeIntakeError(harError, copy, formatters)}
          />
        ) : (
          <>
            {tool === 'auditar' && audit !== null ? (
              <AuditSummary
                audit={audit}
                profile={measuredWith ?? profile}
                alreadyFine={alreadyFine}
                formatters={formatters}
              />
            ) : null}
            <FilterBar
              counts={counts}
              active={filter}
              formatters={formatters}
              selectedCount={selectedIds.length}
              selectedDone={selectedDone}
              onFilter={setFilter}
              onSave={() => void save.download(selectedItems)}
              onRecompress={() => run(planForTool(tool, choices), selectedIds)}
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
            auditActions.clear()
            setMeasuredWith(null)
            setHarError(null)
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
