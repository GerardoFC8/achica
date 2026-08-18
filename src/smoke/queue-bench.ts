import type { OutputPlan } from '../core/pipeline'
import { createQueueStore, totalsOf, type QueueItem } from '../state/queue'
import { createPool, poolConcurrency } from '../workers/pool'
import type { JobError, JobEvent } from '../workers/protocol'
import { createWorkerRunner } from '../workers/runner'

/**
 * The phase 2 acceptance run: two hundred images through the real store, the
 * real pool and real workers.
 *
 * It measures no memory, and that is deliberate. Three gauges were tried from
 * inside the page and all three lie:
 *
 *   - `performance.memory.usedJSHeapSize` returns a constant 10,000,000 in
 *     Chromium. Allocating 50 MB does not move it.
 *   - `performance.measureUserAgentSpecificMemory()` refuses to run even with
 *     `crossOriginIsolated` true, which is the condition it documents.
 *   - CDP's `Performance.getMetrics` reports the JS heap, which excludes
 *     ArrayBuffer backing stores — and a decoded bitmap is exactly that.
 *
 * Memory is measured from outside instead, by `scripts/bench.mjs`, as the
 * resident size of the whole Chrome process tree. That is the same quantity
 * Chrome's own task manager shows, and it is the number in the README.
 *
 * What this harness does measure is time, which says something memory does not
 * ask directly: a queue that leaks ends up thrashing the collector, and its
 * last files take far longer than its first ones.
 */

export type BenchSample = {
  readonly settled: number
  /** Milliseconds since the batch started. */
  readonly ms: number
}

export type BenchReport = {
  readonly files: number
  readonly done: number
  readonly failed: number
  readonly cancelled: number
  readonly ms: number
  readonly bytesBefore: number
  readonly bytesAfter: number
  readonly concurrency: number
  readonly samples: readonly BenchSample[]
  /**
   * The slowest stretch of the batch against its typical stretch, ignoring the
   * first one — which pays for spawning workers and instantiating wasm. Near 1
   * means the queue ran at a steady rate from start to finish.
   */
  readonly slowdown: number | null
  /** The first failure, if any. A bench that only says "200 failed" is useless. */
  readonly firstError: JobError | null
}

export type BenchOptions = {
  readonly files: readonly File[]
  readonly plan: OutputPlan
  readonly concurrency?: number
  /** How many settled files between samples. */
  readonly sampleEvery?: number
  readonly onProgress?: (settled: number, total: number) => void
}

/** Copies one image into `count` distinct files, the way a folder drop arrives. */
export function benchFiles(bytes: ArrayBuffer, count: number, extension = 'jpg'): File[] {
  return Array.from(
    { length: count },
    (_, index) => new File([bytes], `bench-${String(index + 1).padStart(3, '0')}.${extension}`),
  )
}

export async function runQueueBench(options: BenchOptions): Promise<BenchReport> {
  const total = options.files.length
  const sampleEvery = options.sampleEvery ?? 25
  const concurrency = options.concurrency ?? poolConcurrency(navigator.hardwareConcurrency)

  const samples: BenchSample[] = []
  let lastSampledAt = -1
  const startedAt = performance.now()

  const sample = (settled: number): void => {
    if (settled === lastSampledAt) return
    lastSampledAt = settled
    samples.push({ settled, ms: Math.round(performance.now() - startedAt) })
  }

  // The bench owns the pool so it can shut the workers down at the end; the
  // store is handed the same one rather than building its own.
  let receive: (event: JobEvent) => void = () => {}
  const pool = createPool({
    concurrency,
    createRunner: createWorkerRunner,
    onEvent: (event) => receive(event),
  })

  const store = createQueueStore({
    createPool: (onEvent) => {
      receive = onEvent
      return pool
    },
    newId: () => crypto.randomUUID(),
  })

  const finished = new Promise<void>((resolve) => {
    const unsubscribe = store.subscribe((state) => {
      const totals = totalsOf(state.items)
      const settled = totals.done + totals.failed + totals.cancelled

      if (settled % sampleEvery === 0) sample(settled)
      options.onProgress?.(settled, total)

      if (settled === total) {
        unsubscribe()
        resolve()
      }
    })
  })

  sample(0)
  store.getState().enqueue(options.files, options.plan)
  await finished

  const ms = Math.round(performance.now() - startedAt)
  sample(total)
  pool.dispose()

  const totals = totalsOf(store.getState().items)

  return {
    files: total,
    done: totals.done,
    failed: totals.failed,
    cancelled: totals.cancelled,
    ms,
    bytesBefore: totals.bytesBefore,
    bytesAfter: totals.bytesAfter,
    concurrency,
    samples,
    slowdown: slowdownOf(samples),
    firstError: firstErrorIn(store.getState().items),
  }
}

/**
 * Compared against the median rather than the first stretch: the first one
 * spawns four workers and instantiates a wasm codec in each, so it is always
 * the slowest and would flatter every run measured against it.
 */
export function slowdownOf(samples: readonly BenchSample[]): number | null {
  const windows: number[] = []
  for (let index = 2; index < samples.length; index += 1) {
    const previous = samples[index - 1]
    const current = samples[index]
    if (previous === undefined || current === undefined) continue
    if (current.settled <= previous.settled) continue
    windows.push((current.ms - previous.ms) / (current.settled - previous.settled))
  }

  if (windows.length < 2) return null

  const sorted = [...windows].toSorted((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const slowest = sorted[sorted.length - 1]

  if (median === undefined || slowest === undefined || median === 0) return null
  return slowest / median
}

function firstErrorIn(items: readonly QueueItem[]): JobError | null {
  for (const item of items) if (item.status === 'failed') return item.error
  return null
}
