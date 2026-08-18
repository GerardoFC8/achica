import * as Comlink from 'comlink'
import type { EncodeApi } from './encode.worker'
import type { EncodeJob, JobReport, Runner } from './protocol'

/**
 * The pool's `Runner`, backed by an actual worker.
 *
 * Everything platform-shaped lives here — spawning the worker, wrapping it in
 * Comlink, killing it — so the pool next door stays testable in Node against a
 * fake. This file is the part that only a browser can answer for, and it has
 * its own tests in a real Chromium.
 */
export function createWorkerRunner(): Runner {
  const worker = new Worker(new URL('./encode.worker.ts', import.meta.url), { type: 'module' })
  const api = Comlink.wrap<EncodeApi>(worker)

  /**
   * A worker that dies outright — a wasm module that fails to load, an
   * allocation the browser refuses — never answers, and Comlink has no timeout
   * of its own. Without this the queue would show a row encoding forever,
   * which is worse than an error. The pool only ever gives a runner one job at
   * a time, so a single pending rejector is all that is needed.
   */
  let failInFlight: ((cause: unknown) => void) | null = null

  const onWorkerFailure = (event: Event): void => {
    const detail = event instanceof ErrorEvent ? event.message : 'worker could not be reached'
    failInFlight?.(new Error(detail))
  }

  worker.addEventListener('error', onWorkerFailure)
  worker.addEventListener('messageerror', onWorkerFailure)

  return {
    run(job: EncodeJob): Promise<JobReport> {
      return new Promise<JobReport>((resolve, reject) => {
        failInFlight = reject

        api.encodeFile(job.file, job.plan).then(resolve, reject)
      }).finally(() => {
        failInFlight = null
      })
    },

    terminate(): void {
      worker.removeEventListener('error', onWorkerFailure)
      worker.removeEventListener('messageerror', onWorkerFailure)
      worker.terminate()
    },
  }
}
