import * as Comlink from 'comlink'
import type { Frame, FramesContext } from '../core/animation'
import {
  processImage,
  processVideoFrames,
  type OutputPlan,
  type PipelineError,
  type PipelineOutcome,
} from '../core/pipeline'
import type { Result } from '../core/result'
import type { JobReport } from './protocol'

/**
 * One file, off the main thread.
 *
 * The worker knows nothing about queues, ids or cancellation. It takes a file
 * and a plan and gives back a report, which is what lets the pool stay pure
 * scheduling and this stay pure work.
 *
 * It also reads its own file. The main thread never turns a queued image into
 * bytes, so a batch of three hundred photos costs three hundred file handles
 * rather than three hundred buffers.
 */
async function encodeFile(file: File, plan: OutputPlan): Promise<JobReport> {
  // The clock starts at the read, because waiting on disk is part of what the
  // file cost. The pipeline deliberately takes no clock of its own.
  const startedAt = performance.now()

  const bytes = await file.arrayBuffer()
  return toReport(await processImage(bytes, plan), startedAt)
}

/**
 * Frames the main thread extracted from a video, already at their final size.
 * Their buffers arrive transferred, so the main thread no longer holds them.
 * The clock starts here: the extraction is timed by whoever ran it.
 */
async function encodeFrames(
  frames: readonly Frame[],
  context: FramesContext,
  plan: OutputPlan,
): Promise<JobReport> {
  const startedAt = performance.now()
  return toReport(await processVideoFrames(frames, plan, context), startedAt)
}

function toReport(result: Result<PipelineOutcome, PipelineError>, startedAt: number): JobReport {
  const ms = Math.round(performance.now() - startedAt)

  if (!result.ok) return { ok: false, error: result.error }

  const report: JobReport = { ok: true, value: { outcome: result.value, ms } }

  /*
   * Hand the bytes over instead of copying them.
   *
   * Structured cloning would duplicate every output on its way across, which
   * for a batch is a second copy of everything the user just compressed. The
   * worker has no use for the buffer afterwards, so transferring it is free.
   */
  const { buffer } = result.value.output
  return buffer instanceof ArrayBuffer ? Comlink.transfer(report, [buffer]) : report
}

export type EncodeApi = { encodeFile: typeof encodeFile; encodeFrames: typeof encodeFrames }

Comlink.expose({ encodeFile, encodeFrames } satisfies EncodeApi)
