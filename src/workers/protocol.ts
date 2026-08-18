import type { OutputPlan, PipelineError, PipelineOutcome } from '../core/pipeline'
import type { Result } from '../core/result'

/**
 * The contract between the queue and whatever actually does the work.
 *
 * It is written as an interface rather than as calls into a worker because the
 * pool's behaviour — concurrency, per-file failure, cancellation — has nothing
 * to do with codecs, and testing it against a real worker would mean waiting
 * on real encodes to reach cases like "the worker never answers".
 */

export type JobId = string

export type EncodeJob = {
  readonly id: JobId
  /**
   * The file itself, not its bytes.
   *
   * A `File` is a handle to data the browser already has on disk; reading it
   * into an ArrayBuffer here would put every queued image in the tab's memory
   * at once, which is precisely the failure this phase exists to avoid. The
   * worker reads its own file, one at a time, and it clones for free.
   */
  readonly file: File
  readonly plan: OutputPlan
}

/**
 * The worker died: out of memory, a wasm trap, or a terminate that raced the
 * answer. It is not a `PipelineError` because nothing about the image caused
 * it, and the interface should not blame the file for it.
 */
export type WorkerError = {
  readonly code: 'worker-crashed'
  readonly detail: string
}

export type JobError = PipelineError | WorkerError

export type JobSuccess = {
  readonly outcome: PipelineOutcome
  /**
   * Measured where the work happens. The pipeline deliberately takes no
   * clock, and timing it from the main thread would measure queue waiting
   * instead of encoding.
   */
  readonly ms: number
}

export type JobReport = Result<JobSuccess, JobError>

/**
 * Every job ends in exactly one of `settled` or `cancelled`. The queue counts
 * on that: a file that reports twice, or never, leaves a row spinning forever.
 */
export type JobEvent =
  | { readonly type: 'started'; readonly id: JobId }
  | { readonly type: 'settled'; readonly id: JobId; readonly report: JobReport }
  | { readonly type: 'cancelled'; readonly id: JobId }

export type Runner = {
  run(job: EncodeJob): Promise<JobReport>
  /**
   * Stops the runner for good, mid-job if need be, and the pool discards it
   * afterwards. There is no softer verb on purpose: see the note on
   * cancellation in pool.ts.
   */
  terminate(): void
}
