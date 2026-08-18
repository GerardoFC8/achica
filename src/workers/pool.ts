import type { EncodeJob, JobEvent, JobId, JobReport, Runner } from './protocol'

/**
 * The queue: how many files are in flight, what happens to the batch when one
 * of them fails, and what cancelling actually stops.
 *
 * Cancellation is the reason this file owns worker lifetimes.
 *
 * The spec asks for an AbortController per job, and that cannot be honoured
 * literally: an AbortSignal is not structured-cloneable, so it cannot reach a
 * worker at all (Chromium answers `postMessage` with DataCloneError; Node
 * quietly clones it into a plain object with `aborted: undefined`, which is
 * worse, because a Node test would pass). Even if it could cross, a wasm
 * encode runs synchronously inside the worker and would not read the flag
 * until it was already finished.
 *
 * So "cancel must stop work in flight, not just stop enqueuing" leaves exactly
 * one mechanism: terminate the worker. The pool therefore creates workers,
 * kills them on cancel, and spawns replacements for the files still waiting.
 *
 * The pool also holds no results. Reports go out through `onEvent` and are
 * forgotten here, so a queue of three hundred photos does not turn into three
 * hundred output buffers held by the scheduler.
 */

/**
 * Concurrency for the pool, from the core count the browser reports.
 *
 * One core is left for the main thread, or the interface stops answering
 * during a batch. The cap is the spec's, and it is about memory rather than
 * speed: every worker in flight holds a decoded bitmap, and a 12 MP photo is
 * some 48 MB of RGBA. Four is already ~200 MB at peak.
 */
const MAX_CONCURRENCY = 4

/**
 * `navigator.hardwareConcurrency` is optional and some browsers lie about it
 * for fingerprinting reasons. Two keeps a batch moving without betting memory
 * on a machine we know nothing about.
 */
const UNKNOWN_CORES_CONCURRENCY = 2

export function poolConcurrency(hardwareConcurrency: number | undefined): number {
  if (hardwareConcurrency === undefined) return UNKNOWN_CORES_CONCURRENCY
  if (!Number.isFinite(hardwareConcurrency) || hardwareConcurrency < 1) {
    return UNKNOWN_CORES_CONCURRENCY
  }

  return Math.min(MAX_CONCURRENCY, Math.max(1, Math.floor(hardwareConcurrency) - 1))
}

export type PoolOptions = {
  readonly concurrency: number
  /** Called only when there is work for a new worker, never up front. */
  readonly createRunner: () => Runner
  readonly onEvent: (event: JobEvent) => void
}

export type PoolStats = {
  readonly running: number
  readonly queued: number
}

export type Pool = {
  enqueue(jobs: readonly EncodeJob[]): void
  cancel(id: JobId): void
  cancelAll(): void
  /** Resolves when nothing is queued or in flight. Cancelling counts as done. */
  whenIdle(): Promise<void>
  stats(): PoolStats
  /** Terminates every worker for good. The pool is unusable afterwards. */
  dispose(): void
}

type Slot = { readonly runner: Runner }

export function createPool(options: PoolOptions): Pool {
  const { concurrency, createRunner, onEvent } = options

  const queue: EncodeJob[] = []
  /** Live workers. A slot leaves this list only by being terminated. */
  const slots: Slot[] = []
  /**
   * The job a slot is running. Deleting an entry is what marks a job as
   * already finished: a report that arrives afterwards belongs to a job the
   * pool has closed, and gets dropped.
   */
  const running = new Map<JobId, Slot>()

  let idleWaiters: (() => void)[] = []
  let disposed = false

  const isIdle = (): boolean => queue.length === 0 && running.size === 0

  function releaseIdleWaiters(): void {
    if (!isIdle() || idleWaiters.length === 0) return

    const waiting = idleWaiters
    idleWaiters = []
    for (const resolve of waiting) resolve()
  }

  function busySlots(): ReadonlySet<Slot> {
    return new Set(running.values())
  }

  function claimSlot(): Slot | null {
    const busy = busySlots()
    const idle = slots.find((slot) => !busy.has(slot))
    if (idle !== undefined) return idle

    if (slots.length >= concurrency) return null

    const slot: Slot = { runner: createRunner() }
    slots.push(slot)
    return slot
  }

  function discardSlot(slot: Slot): void {
    const at = slots.indexOf(slot)
    if (at >= 0) slots.splice(at, 1)
    slot.runner.terminate()
  }

  function settle(id: JobId, slot: Slot, report: JobReport): void {
    // The job was cancelled while the worker was answering, or the worker it
    // ran on has since been killed and replaced. Either way it is closed.
    if (running.get(id) !== slot) return

    running.delete(id)
    onEvent({ type: 'settled', id, report })
    pump()
  }

  function start(slot: Slot, job: EncodeJob): void {
    running.set(job.id, slot)
    onEvent({ type: 'started', id: job.id })

    slot.runner.run(job).then(
      (report) => settle(job.id, slot, report),
      (cause: unknown) =>
        settle(job.id, slot, {
          ok: false,
          error: { code: 'worker-crashed', detail: describeCause(cause) },
        }),
    )
  }

  function pump(): void {
    while (queue.length > 0 && !disposed) {
      const slot = claimSlot()
      if (slot === null) break

      const job = queue.shift()
      if (job === undefined) break

      start(slot, job)
    }

    releaseIdleWaiters()
  }

  function cancelRunning(id: JobId): boolean {
    const slot = running.get(id)
    if (slot === undefined) return false

    running.delete(id)
    discardSlot(slot)
    onEvent({ type: 'cancelled', id })
    return true
  }

  function cancelAll(): void {
    const inFlight = [...running.keys()]
    const waiting = queue.splice(0)

    for (const id of inFlight) cancelRunning(id)
    for (const job of waiting) onEvent({ type: 'cancelled', id: job.id })

    releaseIdleWaiters()
  }

  function cancelQueued(id: JobId): boolean {
    const at = queue.findIndex((job) => job.id === id)
    if (at < 0) return false

    queue.splice(at, 1)
    onEvent({ type: 'cancelled', id })
    return true
  }

  return {
    enqueue(jobs) {
      if (disposed) throw new Error('pool is disposed')

      queue.push(...jobs)
      pump()
    },

    cancel(id) {
      if (cancelRunning(id)) {
        pump()
        return
      }

      if (cancelQueued(id)) releaseIdleWaiters()
    },

    cancelAll,

    whenIdle() {
      if (isIdle()) return Promise.resolve()
      return new Promise<void>((resolve) => idleWaiters.push(resolve))
    },

    stats() {
      return { running: running.size, queued: queue.length }
    },

    dispose() {
      cancelAll()
      disposed = true
      for (const slot of slots.splice(0)) slot.runner.terminate()
      releaseIdleWaiters()
    },
  }
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  return String(cause)
}
