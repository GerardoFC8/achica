import * as Comlink from 'comlink'
import { mimeTypeOf } from '../core/codecs/encode'
import type { HarError } from '../core/har'
import { err, ok, type Result } from '../core/result'
import type { AuditData } from '../state/audit-store'
import type { HarApi, HarWorkerAudit, HarWorkerResult } from '../workers/har.worker'

/**
 * From a dropped HAR to the files the queue takes (D60).
 *
 * The read happens in a worker. Nothing here fetches anything: the file is a
 * handle the browser already holds, its text lives only inside the worker, and
 * the worker is terminated as soon as the images have been handed over.
 */

/**
 * The largest HAR accepted. See D60 for the measurement behind it: with the
 * read in a worker the page never blocks, so the limit is about memory and
 * patience, not about the main thread.
 */
export const MAX_HAR_BYTES = 100 * 1000 * 1000

export type IntakeError =
  | HarError
  | { readonly code: 'too-large'; readonly bytes: number }
  | { readonly code: 'several-files' }
  | { readonly code: 'read-failed' }
  | {
      readonly code: 'no-images'
      /** Image entries the HAR has, measurable or not. */
      readonly imageEntries: number
      /** At least one of them had no body, which a re-export with contents fixes. */
      readonly noContent: boolean
    }

export type Intake = {
  readonly files: readonly File[]
  readonly audit: AuditData
}

/** Turns what the worker extracted into queue files and the audit's own data. */
export function intakeFrom(audit: HarWorkerAudit): Result<Intake, IntakeError> {
  const noContent = audit.skipped.some((item) => item.reason === 'no-content')

  if (audit.images.length === 0) {
    return err({
      code: 'no-images',
      imageEntries: audit.imageEntryCount - audit.duplicatesIgnored,
      noContent,
    })
  }

  const files: File[] = []
  const origins = new Map<string, string>()
  let measurableBytes = 0

  for (const image of audit.images) {
    files.push(new File([image.buffer], image.name, { type: mimeTypeOf(image.format) }))
    origins.set(image.name, image.displayUrl)
    measurableBytes += image.buffer.byteLength
  }

  return ok({
    files,
    audit: {
      entryCount: audit.entryCount,
      imageCount: audit.images.length + audit.skipped.length,
      measurableCount: audit.images.length,
      measurableBytes,
      duplicatesIgnored: audit.duplicatesIgnored,
      skipped: audit.skipped,
      origins,
    },
  })
}

/** Runs the reader in a fresh worker and lets it go afterwards. */
function readInWorker(file: File): Promise<HarWorkerResult> {
  const worker = new Worker(new URL('../workers/har.worker.ts', import.meta.url), {
    type: 'module',
  })
  const api = Comlink.wrap<HarApi>(worker)

  return new Promise<HarWorkerResult>((resolve, reject) => {
    // A worker that dies (out of memory) never answers, and Comlink has no timeout.
    worker.addEventListener('error', () => reject(new Error('worker failed')))
    worker.addEventListener('messageerror', () => reject(new Error('worker failed')))
    api.readHar(file).then(resolve, reject)
  }).finally(() => worker.terminate())
}

export type HarReader = (file: File) => Promise<HarWorkerResult>

export async function readHarFile(
  file: File,
  read: HarReader = readInWorker,
): Promise<Result<Intake, IntakeError>> {
  // Before reading a byte: a file past the limit is not worth a worker.
  if (file.size > MAX_HAR_BYTES) return err({ code: 'too-large', bytes: file.size })

  let result: HarWorkerResult
  try {
    result = await read(file)
  } catch {
    return err({ code: 'read-failed' })
  }
  if (!result.ok) return err(result.error)

  return intakeFrom(result.value)
}

/** One file, and not an image or a folder: those are other tools' work. */
export async function readDroppedHar(
  files: readonly File[],
  read?: HarReader,
): Promise<Result<Intake, IntakeError>> {
  const [only] = files
  if (only === undefined) return err({ code: 'not-json' })
  if (files.length > 1) return err({ code: 'several-files' })
  return readHarFile(only, read)
}
