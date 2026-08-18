import { createStore, type StoreApi } from 'zustand/vanilla'
import { mimeTypeOf } from '../core/codecs/encode'
import type { OutputPlan, PipelineOutcome } from '../core/pipeline'
import type { Pool } from '../workers/pool'
import type { EncodeJob, JobError, JobEvent, JobId } from '../workers/protocol'

/**
 * The queue as the interface sees it: one row per file, and the numbers that
 * row has to show.
 *
 * The store translates and nothing more. It does not decide what runs, when,
 * or what stops — the pool owns all of that, and the store only asks and then
 * believes what comes back. Mirroring the pool's decisions here would mean two
 * places that disagree the first time a cancel races an encode.
 */

/** Everything about the result except the bytes, which become a Blob. */
export type ItemOutcome = Omit<PipelineOutcome, 'output'>

export type QueueItem = {
  readonly id: JobId
  readonly name: string
  readonly bytesBefore: number
} & (
  | { readonly status: 'pending' }
  | { readonly status: 'running' }
  | {
      readonly status: 'done'
      /**
       * A Blob, not the Uint8Array the worker produced.
       *
       * A typed array is pinned in the tab's heap for as long as the row
       * exists. A Blob is a handle the browser may keep on disk, which is what
       * lets two hundred finished files wait to be saved without the tab being
       * killed for it.
       */
      readonly blob: Blob
      readonly outcome: ItemOutcome
      readonly ms: number
    }
  | { readonly status: 'failed'; readonly error: JobError }
  | { readonly status: 'cancelled' }
)

export type QueueState = {
  readonly items: readonly QueueItem[]
  enqueue(files: readonly File[], plan: OutputPlan): void
  cancel(id: JobId): void
  cancelAll(): void
  clear(): void
}

export type QueueDeps = {
  readonly createPool: (onEvent: (event: JobEvent) => void) => Pool
  readonly newId: () => JobId
}

export type QueueTotals = {
  readonly done: number
  readonly failed: number
  readonly pending: number
  readonly bytesBefore: number
  readonly bytesAfter: number
  readonly savedBytes: number
  /** Between 0 and 1, over the files that finished. */
  readonly savedRatio: number
}

function applied(item: QueueItem, event: JobEvent): QueueItem {
  const identity = { id: item.id, name: item.name, bytesBefore: item.bytesBefore }

  if (event.type === 'started') return { ...identity, status: 'running' }
  if (event.type === 'cancelled') return { ...identity, status: 'cancelled' }

  if (!event.report.ok) return { ...identity, status: 'failed', error: event.report.error }

  const { outcome, ms } = event.report.value
  const { output, ...rest } = outcome

  return {
    ...identity,
    status: 'done',
    blob: new Blob([output], { type: mimeTypeOf(outcome.format) }),
    outcome: rest,
    ms,
  }
}

export function createQueueStore(deps: QueueDeps): StoreApi<QueueState> {
  let receive: (event: JobEvent) => void = () => {}
  const pool = deps.createPool((event) => receive(event))

  const store = createStore<QueueState>()((set, get) => ({
    items: [],

    enqueue(files, plan) {
      const jobs: EncodeJob[] = files.map((file) => ({ id: deps.newId(), file, plan }))

      /*
       * Rows first, pool second, and the order is not cosmetic: the pool hands
       * work to a worker inside `enqueue`, so its first 'started' event fires
       * before this method returns. Told in the other order, that event would
       * find no row to update and the file would sit on 'pending' forever.
       */
      set({
        items: [
          ...get().items,
          ...jobs.map((job): QueueItem => ({
            id: job.id,
            name: job.file.name,
            bytesBefore: job.file.size,
            status: 'pending',
          })),
        ],
      })

      pool.enqueue(jobs)
    },

    cancel(id) {
      pool.cancel(id)
    },

    cancelAll() {
      pool.cancelAll()
    },

    clear() {
      // Cancel before forgetting. A row removed from the list is still a file
      // a worker is busy encoding, and nothing would be watching for it.
      pool.cancelAll()
      set({ items: [] })
    },
  }))

  receive = (event) => {
    store.setState((state) => ({
      items: state.items.map((item) => (item.id === event.id ? applied(item, event) : item)),
    }))
  }

  return store
}

export function totalsOf(items: readonly QueueItem[]): QueueTotals {
  let done = 0
  let failed = 0
  let pending = 0
  let bytesBefore = 0
  let bytesAfter = 0

  for (const item of items) {
    if (item.status === 'done') {
      done += 1
      // Only finished files count towards the saving. Adding the weight of a
      // file that produced nothing would report a failed batch as a triumph.
      bytesBefore += item.outcome.bytesBefore
      bytesAfter += item.outcome.bytesAfter
      continue
    }

    if (item.status === 'failed') failed += 1
    else if (item.status !== 'cancelled') pending += 1
  }

  const savedBytes = bytesBefore - bytesAfter

  return {
    done,
    failed,
    pending,
    bytesBefore,
    bytesAfter,
    savedBytes,
    savedRatio: bytesBefore === 0 ? 0 : savedBytes / bytesBefore,
  }
}
