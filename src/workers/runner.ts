import * as Comlink from 'comlink'
import { normalizeVideoSegment } from '../core/animation'
import { extractVideoFramesSerially } from '../media/extraction-queue'
import { sniffVideoContainer } from '../media/sniff'
import type { EncodeApi } from './encode.worker'
import type { EncodeJob, JobReport, Runner } from './protocol'

/** Replaceable so the runner can be tested without playing a real video. */
export type VideoExtractor = typeof extractVideoFramesSerially

/** The first bytes are enough to tell a video container from anything else. */
const HEAD_BYTES = 64

/**
 * The pool's `Runner`, backed by an actual worker.
 *
 * Everything platform-shaped lives here — spawning the worker, wrapping it in
 * Comlink, killing it — so the pool next door stays testable in Node against a
 * fake. This file is the part that only a browser can answer for, and it has
 * its own tests in a real Chromium.
 *
 * A video is the one input that cannot be read in the worker (there is no
 * <video> there): when the plan carries a video segment AND the bytes of the
 * file are an MP4 or WebM, its frames are extracted on the main thread, one
 * extraction at a time for the whole page, and handed to the worker with their
 * buffers transferred. Everything else takes the route it always had.
 */
export function createWorkerRunner(extract: VideoExtractor = extractVideoFramesSerially): Runner {
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

  /**
   * Stops the extraction of the job in flight. `terminate()` kills the worker,
   * but an extraction runs on the main thread and would not notice: it would
   * keep playing the video until the end of the clip.
   */
  let extraction: AbortController | null = null

  const onWorkerFailure = (event: Event): void => {
    const detail = event instanceof ErrorEvent ? event.message : 'worker could not be reached'
    failInFlight?.(new Error(detail))
  }

  worker.addEventListener('error', onWorkerFailure)
  worker.addEventListener('messageerror', onWorkerFailure)

  async function isVideo(file: File): Promise<boolean> {
    const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer())
    return sniffVideoContainer(head) !== null
  }

  async function runVideo(job: EncodeJob, signal: AbortSignal): Promise<JobReport> {
    const { animation } = job.plan
    if (animation === undefined || animation.video === undefined) {
      throw new Error('a video job needs a video segment')
    }
    const segment = normalizeVideoSegment(animation.video)

    const startedAt = performance.now()
    const extracted = await extract(job.file, {
      ...segment,
      fit: animation.layout,
      signal,
    })
    const extractionMs = Math.round(performance.now() - startedAt)

    // A failure to read the video is a value of the job, not a dead worker.
    if (!extracted.ok) {
      return {
        ok: false,
        error: {
          code: 'video-failed',
          reason: extracted.error.code,
          detail: extracted.error.message,
        },
      }
    }
    if (signal.aborted) {
      return { ok: false, error: { code: 'video-failed', reason: 'aborted', detail: 'Cancelled.' } }
    }

    const { frames, clip, source } = extracted.value
    // Distinct buffers only: a repeated one in the transfer list would throw.
    const buffers = [...new Set(frames.map((frame) => frame.data.buffer))]
    const report = await api.encodeFrames(
      Comlink.transfer(frames, buffers),
      {
        bytesBefore: job.file.size,
        clip: {
          startSeconds: clip.startSeconds,
          lengthSeconds: clip.lengthSeconds,
          sourceDurationSeconds: source.durationSeconds,
        },
      },
      job.plan,
    )
    return report.ok
      ? { ok: true, value: { ...report.value, ms: report.value.ms + extractionMs } }
      : report
  }

  async function work(job: EncodeJob, signal: AbortSignal): Promise<JobReport> {
    if (job.plan.animation?.video !== undefined && (await isVideo(job.file))) {
      return runVideo(job, signal)
    }
    return api.encodeFile(job.file, job.plan)
  }

  return {
    run(job: EncodeJob): Promise<JobReport> {
      const controller = new AbortController()
      extraction = controller

      return new Promise<JobReport>((resolve, reject) => {
        failInFlight = reject

        work(job, controller.signal).then(resolve, reject)
      }).finally(() => {
        failInFlight = null
        // Harmless once the extraction is over; it stops one that outlived a failed job.
        controller.abort()
        if (extraction === controller) extraction = null
      })
    },

    terminate(): void {
      extraction?.abort()
      worker.removeEventListener('error', onWorkerFailure)
      worker.removeEventListener('messageerror', onWorkerFailure)
      worker.terminate()
    },
  }
}
