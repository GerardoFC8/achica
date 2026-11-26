/**
 * Runs jobs one at a time, in the order they were queued.
 *
 * The worker pool starts several jobs at once, but the main thread has one
 * <video> pipeline worth using at a time: two players decoding in parallel
 * each stall the other, and a stalled player is reported as an error. Every
 * video extraction goes through one queue.
 *
 * A job whose signal aborts while it is still waiting never starts and
 * resolves with `whenAborted()` right away, without waiting for the jobs ahead
 * of it. A job that is already running is the job's own business: it gets the
 * signal and is expected to stop. A job that throws does not stall the queue.
 */
export type SerialQueue = {
  run<T>(
    job: () => Promise<T>,
    options: { signal?: AbortSignal | undefined; whenAborted: () => T },
  ): Promise<T>
  /** Jobs waiting or running. */
  readonly size: number
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve()
  let size = 0
  return {
    run(job, { signal, whenAborted }) {
      if (signal?.aborted === true) return Promise.resolve(whenAborted())
      size += 1
      return new Promise((resolve, reject) => {
        let started = false
        let settled = false
        const onAbort = (): void => {
          // Only a job that has not started can leave the line early.
          if (!started) finish(() => resolve(whenAborted()))
        }
        const finish = (settle: () => void): void => {
          if (settled) return
          settled = true
          size -= 1
          signal?.removeEventListener('abort', onAbort)
          settle()
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        const turn = (): Promise<void> => {
          // It left the line already: its turn passes without running anything.
          if (settled) return Promise.resolve()
          started = true
          return job().then(
            (value) => finish(() => resolve(value)),
            (error: unknown) => finish(() => reject(error)),
          )
        }
        tail = tail.then(turn, turn)
      })
    },
    get size() {
      return size
    },
  }
}
