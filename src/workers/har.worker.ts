import * as Comlink from 'comlink'
import { parseHar, type HarError, type HarSkipped } from '../core/har'
import type { SupportedFormat } from '../core/detect'
import { err, ok, type Result } from '../core/result'

/**
 * Reads a HAR off the main thread (D60).
 *
 * Parsing a HAR is one long synchronous `JSON.parse` plus a base64 decode of
 * every image, and on a 100 MB export that froze the page for over half a
 * second (measured, see D60). Here it only costs this worker's time, and when
 * the worker is terminated the whole text and the parsed tree go with it, so
 * nothing from the export outlives the extraction.
 *
 * What crosses back is what the interface needs and nothing else: names, safe
 * display URLs, formats, the skipped list and the image bytes, transferred and
 * not copied.
 */

export type HarWorkerImage = {
  readonly name: string
  readonly displayUrl: string
  readonly format: SupportedFormat
  readonly buffer: ArrayBuffer
}

export type HarWorkerAudit = {
  readonly images: readonly HarWorkerImage[]
  readonly skipped: readonly HarSkipped[]
  readonly entryCount: number
  readonly imageEntryCount: number
  readonly duplicatesIgnored: number
}

export type HarWorkerResult = Result<HarWorkerAudit, HarError>

async function readHar(file: File): Promise<HarWorkerResult> {
  const parsed = parseHar(await file.text())
  if (!parsed.ok) return err(parsed.error)

  const { images, skipped, entryCount, imageEntryCount, duplicatesIgnored } = parsed.value
  const out: HarWorkerImage[] = images.map((image) => ({
    name: image.name,
    displayUrl: image.displayUrl,
    format: image.format,
    buffer: image.bytes.buffer,
  }))

  return Comlink.transfer(
    ok({ images: out, skipped, entryCount, imageEntryCount, duplicatesIgnored }),
    out.map((image) => image.buffer),
  )
}

export type HarApi = { readHar: typeof readHar }

Comlink.expose({ readHar } satisfies HarApi)
