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
  /**
   * The file itself, kept for as long as the row exists.
   *
   * A File is a handle to data the browser already holds, not a copy, so this
   * costs a reference and not a buffer. Both the before/after comparator and
   * a recompress under a different destination need the original, and neither
   * can ask the user to drop it again.
   */
  readonly file: File
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
  /**
   * Adds rows without starting any work.
   *
   * Dropping a folder and choosing a destination are two decisions, and the
   * second one is the product's whole idea. Compressing on the drop would
   * spend the batch before the user has said where it is going.
   */
  add(files: readonly File[]): void
  /** Sends every row still waiting to the pool. */
  start(plan: OutputPlan): void
  /** Sends specific rows back through the queue, keeping their identity. */
  requeue(ids: readonly JobId[], plan: OutputPlan): void
  cancel(id: JobId): void
  cancelAll(): void
  /** Forgets rows entirely. Whatever they were doing is cancelled first. */
  remove(ids: readonly JobId[]): void
  clear(): void
}

export type QueueDeps = {
  readonly createPool: (onEvent: (event: JobEvent) => void) => Pool
  readonly newId: () => JobId
}

export type QueueTotals = {
  readonly done: number
  readonly failed: number
  readonly cancelled: number
  /** Queued or encoding: the rows that have not reached an end yet. */
  readonly pending: number
  readonly bytesBefore: number
  readonly bytesAfter: number
  readonly savedBytes: number
  /** Between 0 and 1, over the files that finished. */
  readonly savedRatio: number
}

function applied(item: QueueItem, event: JobEvent): QueueItem {
  const identity = {
    id: item.id,
    file: item.file,
    name: item.name,
    bytesBefore: item.bytesBefore,
  }

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

    add(files) {
      set({
        items: [
          ...get().items,
          ...files.map((file): QueueItem => ({
            id: deps.newId(),
            file,
            name: file.name,
            bytesBefore: file.size,
            status: 'pending',
          })),
        ],
      })
    },

    start(plan) {
      const waiting = get()
        .items.filter((item) => item.status === 'pending')
        .map((item) => item.id)

      get().requeue(waiting, plan)
    },

    requeue(ids, plan) {
      const wanted = new Set(ids)
      const jobs: EncodeJob[] = get()
        .items.filter((item) => wanted.has(item.id))
        .map((item) => ({ id: item.id, file: item.file, plan }))

      /*
       * Rows first, pool second, and the order is not cosmetic: the pool hands
       * work to a worker inside its own enqueue, so the first 'started' event
       * fires before this returns. Told the other way round, that event would
       * find a row still marked done and the file would never show as running.
       */
      set({
        items: get().items.map((item) =>
          wanted.has(item.id)
            ? {
                id: item.id,
                file: item.file,
                name: item.name,
                bytesBefore: item.bytesBefore,
                status: 'pending',
              }
            : item,
        ),
      })

      pool.enqueue(jobs)
    },

    cancel(id) {
      pool.cancel(id)
    },

    remove(ids) {
      // Cancel before forgetting: a removed row can still be a file a worker
      // is busy encoding, and nothing would be left watching for it.
      for (const id of ids) pool.cancel(id)

      const wanted = new Set(ids)
      set({ items: get().items.filter((item) => !wanted.has(item.id)) })
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
  let cancelled = 0
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
    else if (item.status === 'cancelled') cancelled += 1
    else pending += 1
  }

  const savedBytes = bytesBefore - bytesAfter

  return {
    done,
    failed,
    cancelled,
    pending,
    bytesBefore,
    bytesAfter,
    savedBytes,
    savedRatio: bytesBefore === 0 ? 0 : savedBytes / bytesBefore,
  }
}
