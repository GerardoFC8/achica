import * as Comlink from 'comlink'
import { processImage, type OutputPlan } from '../core/pipeline'
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
  const result = await processImage(bytes, plan)
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

export type EncodeApi = { encodeFile: typeof encodeFile }

Comlink.expose({ encodeFile } satisfies EncodeApi)
