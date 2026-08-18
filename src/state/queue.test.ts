import { describe, expect, it } from 'vitest'
import type { OutputPlan, PipelineOutcome } from '../core/pipeline'
import type { Pool } from '../workers/pool'
import type { EncodeJob, JobEvent, JobId, JobReport } from '../workers/protocol'
import { createQueueStore, totalsOf, type QueueItem } from './queue'

/**
 * The store's job is translation: pool events in, rows a table can render out.
 * The pool is faked because its own behaviour is tested next door, and because
 * the case that matters most here — the pool starting a job synchronously,
 * before enqueue has even returned — is trivial to stage with a fake and
 * awkward with the real thing.
 */

const PLAN: OutputPlan = { format: 'webp', maxBytes: 100_000 }

function outcome(bytesBefore: number, bytesAfter: number): PipelineOutcome {
  return {
    output: new Uint8Array(bytesAfter),
    format: 'webp',
    bytesBefore,
    bytesAfter,
    width: 800,
    height: 600,
    quality: 70,
    withinBudget: true,
    shrunkForBudget: null,
    encodes: 3,
  }
}

const done = (bytesBefore: number, bytesAfter: number): JobReport => ({
  ok: true,
  value: { outcome: outcome(bytesBefore, bytesAfter), ms: 42 },
})

const failed: JobReport = {
  ok: false,
  error: { code: 'unsupported-format', format: 'heic' },
}

function file(name: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], name)
}

function harness(options: { readonly startImmediately?: boolean } = {}) {
  const enqueued: EncodeJob[] = []
  const cancelled: JobId[] = []
  let cancelledAll = 0
  let emit: (event: JobEvent) => void = () => {}

  const pool: Pool = {
    enqueue(jobs) {
      enqueued.push(...jobs)
      // The real pool hands work to a worker inside enqueue, so the first
      // 'started' arrives before the caller gets control back.
      if (options.startImmediately === true) {
        for (const job of jobs) emit({ type: 'started', id: job.id })
      }
    },
    cancel: (id) => cancelled.push(id),
    cancelAll: () => {
      cancelledAll += 1
    },
    whenIdle: () => Promise.resolve(),
    stats: () => ({ running: 0, queued: 0 }),
    dispose: () => {},
  }

  let nextId = 0
  const store = createQueueStore({
    createPool: (onEvent) => {
      emit = onEvent
      return pool
    },
    newId: () => `job-${(nextId += 1)}`,
  })

  /** What the interface does when the user drops files and presses the button. */
  const drop = (files: readonly File[], plan: OutputPlan = PLAN): void => {
    store.getState().add(files)
    store.getState().start(plan)
  }

  const items = (): readonly QueueItem[] => store.getState().items
  const itemAt = (index: number): QueueItem => {
    const item = items()[index]
    if (item === undefined) throw new Error(`no row at ${index}`)
    return item
  }

  return {
    store,
    drop,
    enqueued,
    cancelled,
    items,
    itemAt,
    emit: (event: JobEvent) => emit(event),
    cancelledAll: () => cancelledAll,
  }
}

describe('queue store', () => {
  it('adds one pending row per file, in the order they were dropped', () => {
    const { drop, items } = harness()

    drop([file('a.jpg', 300), file('b.png', 500)])

    expect(items().map((item) => item.name)).toEqual(['a.jpg', 'b.png'])
    expect(items().map((item) => item.status)).toEqual(['pending', 'pending'])
  })

  it('adds rows without spending a single encode', () => {
    const { store, enqueued, itemAt } = harness()

    store.getState().add([file('a.jpg', 300)])

    // Choosing a destination is the second decision and the product's whole
    // idea. Compressing on the drop would spend the batch before the user has
    // said where it is going.
    expect(enqueued).toHaveLength(0)
    expect(itemAt(0).status).toBe('pending')
  })

  it('starts only the rows that are still waiting', () => {
    const { store, drop, enqueued, emit } = harness()
    drop([file('a.jpg', 300)])
    emit({ type: 'settled', id: 'job-1', report: done(300, 100) })
    store.getState().add([file('b.jpg', 300)])

    store.getState().start(PLAN)

    // The finished row is not re-encoded just because a second file arrived.
    expect(enqueued.map((job) => job.id)).toEqual(['job-1', 'job-2'])
  })

  it('keeps the original size, because the saving is the number the user came for', () => {
    const { drop, itemAt } = harness()

    drop([file('a.jpg', 300)])

    expect(itemAt(0).bytesBefore).toBe(300)
  })

  it('hands the pool one job per file, carrying the plan', () => {
    const { drop, enqueued } = harness()

    drop([file('a.jpg', 300), file('b.png', 500)])

    expect(enqueued.map((job) => job.file.name)).toEqual(['a.jpg', 'b.png'])
    expect(enqueued.every((job) => job.plan === PLAN)).toBe(true)
  })

  it('has the rows in place before the pool starts anything', () => {
    // Rows are added before the pool is told about them on purpose: the pool
    // starts jobs synchronously, and an event that finds no row would leave a
    // file stuck on 'pending' forever.
    const { drop, itemAt } = harness({ startImmediately: true })

    drop([file('a.jpg', 300)])

    expect(itemAt(0).status).toBe('running')
  })

  it('turns a finished job into a blob and drops the raw bytes', () => {
    const { drop, itemAt, emit } = harness()
    drop([file('a.jpg', 1_000)])

    emit({ type: 'settled', id: 'job-1', report: done(1_000, 250) })

    const item = itemAt(0)
    expect(item.status).toBe('done')
    if (item.status !== 'done') return

    /*
     * A Blob rather than the Uint8Array the worker sent.
     *
     * A typed array is pinned in the tab's heap; a Blob is a handle the
     * browser is free to keep on disk. With two hundred results waiting to be
     * saved, that is the difference between a queue that finishes and a tab
     * the browser kills.
     */
    expect(item.blob).toBeInstanceOf(Blob)
    expect(item.blob.size).toBe(250)
    expect(item.blob.type).toBe('image/webp')
    expect(item.ms).toBe(42)
    expect(item.outcome.bytesAfter).toBe(250)
    expect('output' in item.outcome).toBe(false)
  })

  it('marks a failed file with its cause and leaves the others alone', () => {
    const { drop, itemAt, emit } = harness()
    drop([file('a.heic', 900), file('b.jpg', 900)])

    emit({ type: 'settled', id: 'job-1', report: failed })

    const item = itemAt(0)
    expect(item.status).toBe('failed')
    if (item.status === 'failed') expect(item.error.code).toBe('unsupported-format')
    expect(itemAt(1).status).toBe('pending')
  })

  it('marks a cancelled file without inventing an error for it', () => {
    const { drop, itemAt, emit } = harness()
    drop([file('a.jpg', 900)])

    emit({ type: 'cancelled', id: 'job-1' })

    // Cancelling is the user's own doing. Showing it as a failure would be
    // blaming the file for a decision the user made.
    expect(itemAt(0).status).toBe('cancelled')
  })

  it('ignores an event for a row that is no longer listed', () => {
    const { store, drop, items, emit } = harness()
    drop([file('a.jpg', 900)])
    store.getState().clear()

    expect(() => emit({ type: 'settled', id: 'job-1', report: done(900, 100) })).not.toThrow()
    expect(items()).toHaveLength(0)
  })

  it('asks the pool to cancel, and waits for the pool to say it happened', () => {
    const { store, drop, cancelled, itemAt } = harness()
    drop([file('a.jpg', 900)])

    store.getState().cancel('job-1')

    expect(cancelled).toEqual(['job-1'])
    // Still pending: the pool owns the truth about what actually stopped, and
    // guessing here is how a row ends up in a state the queue never reached.
    expect(itemAt(0).status).toBe('pending')
  })

  it('cancels everything through the pool', () => {
    const { store, drop, cancelledAll } = harness()
    drop([file('a.jpg', 900), file('b.jpg', 900)])

    store.getState().cancelAll()

    expect(cancelledAll()).toBe(1)
  })

  it('cancels before emptying the list, so nothing keeps encoding unseen', () => {
    const { store, drop, items, cancelledAll } = harness()
    drop([file('a.jpg', 900)])

    store.getState().clear()

    expect(cancelledAll()).toBe(1)
    expect(items()).toHaveLength(0)
  })

  it('keeps the file itself, which the comparator and a recompress both need', () => {
    const { drop, itemAt } = harness()
    const dropped = file('a.jpg', 300)

    drop([dropped])

    // A File is a handle to data the browser already has, not a copy of it,
    // so holding it costs a reference rather than three hundred buffers.
    expect(itemAt(0).file).toBe(dropped)
  })

  it('sends a row back through the queue with its identity intact', () => {
    const { store, drop, itemAt, enqueued, emit } = harness()
    drop([file('a.jpg', 300)])
    emit({ type: 'settled', id: 'job-1', report: done(300, 100) })

    store.getState().requeue(['job-1'], { format: 'jpeg', maxBytes: 50_000 })

    expect(itemAt(0).status).toBe('pending')
    expect(enqueued[1]?.id).toBe('job-1')
    expect(enqueued[1]?.plan).toEqual({ format: 'jpeg', maxBytes: 50_000 })
  })

  it('drops a row and stops whatever it was doing', () => {
    const { store, drop, items, cancelled } = harness()
    drop([file('a.jpg', 300), file('b.jpg', 300)])

    store.getState().remove(['job-1'])

    // Cancel first: a removed row is still a file a worker is busy encoding,
    // and nothing would be left watching for it.
    expect(cancelled).toEqual(['job-1'])
    expect(items().map((item) => item.name)).toEqual(['b.jpg'])
  })

  it('ignores a removal for a row that is not there', () => {
    const { store, drop, items } = harness()
    drop([file('a.jpg', 300)])

    expect(() => store.getState().remove(['nope'])).not.toThrow()
    expect(items()).toHaveLength(1)
  })

  it('keeps rows from a second drop alongside the first', () => {
    const { drop, items } = harness()
    drop([file('a.jpg', 900)])

    drop([file('b.jpg', 900)])

    expect(items().map((item) => item.name)).toEqual(['a.jpg', 'b.jpg'])
  })
})

describe('totalsOf', () => {
  function storeWith(reports: readonly JobReport[]): readonly QueueItem[] {
    const { store, drop, emit } = harness()
    drop(
      reports.map((_, index) => file(`f${index}.jpg`, 1_000)),
      PLAN,
    )
    reports.forEach((report, index) => {
      emit({ type: 'settled', id: `job-${index + 1}`, report })
    })
    return store.getState().items
  }

  it('counts what finished, what failed and what is still waiting', () => {
    const totals = totalsOf(storeWith([done(1_000, 200), failed]))

    expect(totals).toMatchObject({ done: 1, failed: 1, cancelled: 0, pending: 0 })
  })

  it('counts cancelled rows apart from failed ones', () => {
    const { store, drop, emit } = harness()
    drop([file('a.jpg', 900), file('b.jpg', 900)])
    emit({ type: 'cancelled', id: 'job-1' })

    const totals = totalsOf(store.getState().items)

    expect(totals).toMatchObject({ cancelled: 1, failed: 0, pending: 1 })
  })

  it('adds up the saving over the files that actually finished', () => {
    const totals = totalsOf(storeWith([done(1_000, 200), done(1_000, 400)]))

    expect(totals.bytesBefore).toBe(2_000)
    expect(totals.bytesAfter).toBe(600)
    expect(totals.savedBytes).toBe(1_400)
    expect(totals.savedRatio).toBeCloseTo(0.7)
  })

  it('does not count a failed file as a saving of its whole weight', () => {
    // Counting the original bytes of a file that produced nothing would report
    // a batch that failed as a spectacular success.
    const totals = totalsOf(storeWith([failed]))

    expect(totals.bytesBefore).toBe(0)
    expect(totals.savedRatio).toBe(0)
  })

  it('reports nothing rather than dividing by zero on an empty queue', () => {
    expect(totalsOf([])).toMatchObject({ done: 0, savedBytes: 0, savedRatio: 0 })
  })
})
