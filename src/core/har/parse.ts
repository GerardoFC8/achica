import { detectFormat, detectSupportedFormat, type SupportedFormat } from '../detect'
import { err, ok, type Result } from '../result'
import { decodeBase64 } from './base64'
import { createNamer, fnv1a } from './names'
import type { HarAudit, HarError, HarImage, HarSkipped, SkipReason } from './types'
import { describeUrl, UNREADABLE_URL } from './display-url'

/**
 * Reads a HAR file and extracts its images. Never throws, never fetches.
 *
 * A HAR is hostile input that carries secrets, so the reader is a
 * whitelist: it looks at `log.entries[].request.url` and
 * `response.{status, bodySize, _transferSize, content.{mimeType, size, text,
 * encoding}}` and at nothing else. Headers, cookies, `postData` and
 * `queryString` are never read, so they cannot be copied by accident. Every
 * field is checked at run time, because the types of parsed JSON are a
 * wish, not a fact.
 *
 * Non-image entries are dropped after reading their mime type: their bodies
 * (scripts, HTML, JSON with session data) are never touched.
 */

/** Past this a HAR is not a page audit, and the loop must have a bound. */
export const MAX_ENTRIES = 50_000
/** A single decoded image above this is treated as unreadable rather than allocated. */
const MAX_IMAGE_BYTES = 256 * 1024 * 1024
const MAX_BASE64_CHARS = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 16
/** Base64 characters decoded to sniff the format of an unlabelled body. */
const SNIFF_CHARS = 2048
const MIME = /^[a-z0-9][a-z0-9.+-]{0,60}\/[a-z0-9][a-z0-9.+-]{0,60}$/

type Rec = Record<string, unknown>

function asRecord(value: unknown): Rec | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Rec)
    : null
}

/** A non-negative safe integer, or null. */
function size(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

/** `type/subtype` in lower case with parameters dropped, or '' when it is anything else. */
function cleanMime(value: unknown): string {
  if (typeof value !== 'string') return ''
  const bare = (value.split(';', 1)[0] ?? '').trim().toLowerCase()
  return MIME.test(bare) ? bare : ''
}

/** A formats we recognise by bytes but do not process: SVG is text, ICO has no sniffer in detect. */
function isKnownUnsupported(bytes: Uint8Array): boolean {
  if (detectFormat(bytes) !== null) return true
  if (
    bytes.length >= 6 &&
    bytes[0] === 0 &&
    bytes[1] === 0 &&
    (bytes[2] === 1 || bytes[2] === 2) &&
    bytes[3] === 0
  ) {
    return true // ICO / CUR
  }
  const head = String.fromCharCode(...bytes.subarray(0, 512)).toLowerCase()
  return head.includes('<svg')
}

type Candidate = {
  readonly key: string
  readonly url: string
  readonly mime: string
  readonly status: number | null
  readonly encoding: unknown
  readonly text: string
  readonly content: Rec
  readonly contentSize: number | null
  readonly bodySize: number | null
  readonly transfer: number | null
}

/** Cheap, body-free pass: is this an image entry, and what does it claim to be? */
function inspect(entry: unknown): Candidate | null {
  const e = asRecord(entry)
  const response = asRecord(e?.response)
  const content = asRecord(response?.content)
  if (response === null || content === null) return null

  const request = asRecord(e?.request)
  const url = typeof request?.url === 'string' ? request.url : ''
  const mime = cleanMime(content.mimeType)
  const text = typeof content.text === 'string' ? content.text : ''
  const status =
    typeof response.status === 'number' && Number.isInteger(response.status)
      ? response.status
      : null

  const candidate: Candidate = {
    // Long keys (data: URLs) are hashed so the dedupe set stays small.
    key:
      url.length > 512 ? `${url.length}:${fnv1a(url)}:${fnv1a(url.slice(url.length >> 1))}` : url,
    url,
    mime,
    status,
    encoding: content.encoding,
    text,
    content,
    contentSize: size(content.size),
    bodySize: size(response.bodySize),
    transfer: size(response._transferSize),
  }

  if (mime.startsWith('image/')) return candidate
  if (mime !== '') return null

  // No usable mime type: the bytes decide, but only for a body that is
  // there and readable, and only by its first few bytes.
  if (text === '' || candidate.encoding !== 'base64' || !statusLooksServed(status)) return null
  const head = decodeBase64(text.slice(0, SNIFF_CHARS), { prefix: true })
  return head !== null && head.length > 0 && isKnownUnsupported(head) ? candidate : null
}

const statusLooksServed = (status: number | null): boolean =>
  status !== null && status !== 0 && status < 400 && status !== 206

type Resolved =
  | {
      readonly kind: 'image'
      readonly bytes: Uint8Array<ArrayBuffer>
      readonly format: SupportedFormat
    }
  | { readonly kind: 'skip'; readonly reason: SkipReason }

/** The weight to show for something we cannot measure. */
function skippedWeight(c: Candidate): number | null {
  for (const value of [c.contentSize, c.transfer, c.bodySize]) {
    if (value !== null && value > 0) return value
  }
  return null
}

function resolve(c: Candidate): Resolved {
  const skip = (reason: SkipReason): Resolved => ({ kind: 'skip', reason })
  const { status } = c

  if (status === null || status === 0 || status < 0 || status >= 400) return skip('failed-request')
  if (status === 206) return skip('partial')
  if (status === 304) return skip('cached')

  if (c.text === '') {
    // Chrome reports a cache hit as a transfer of 0 bytes. Without a body
    // and without that hint, the export simply left the bodies out.
    const fromCache = c.contentSize === 0 && (c.transfer === 0 || c.bodySize === 0)
    return skip(fromCache ? 'cached' : 'no-content')
  }

  // Chrome writes SVG as plain text, so it never reaches the base64 check.
  if (c.mime === 'image/svg+xml') return skip('unsupported-format')
  if (c.encoding !== 'base64' || c.text.length > MAX_BASE64_CHARS) return skip('unreadable-content')

  const bytes = decodeBase64(c.text)
  // Let go of the base64 text now: it is the biggest thing the parsed tree holds.
  c.content.text = ''
  if (bytes === null) return skip('unreadable-content')

  const detected = detectSupportedFormat(bytes)
  if (detected.ok) return { kind: 'image', bytes, format: detected.value }
  if (detected.error.code === 'unsupported-format' || isKnownUnsupported(bytes)) {
    return skip('unsupported-format')
  }
  return skip('unreadable-content')
}

type Found = {
  readonly url: string
  readonly displayUrl: string
  readonly segments: readonly string[]
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly format: SupportedFormat
  readonly transferBytes: number | null
}

export function parseHar(text: string): Result<HarAudit, HarError> {
  try {
    return parse(text)
  } catch {
    // Last net for a bug on hostile input. Tests tell it apart from the
    // deliberate rejections: none of them is allowed to land here.
    return err({ code: 'not-har' })
  }
}

function parse(text: string): Result<HarAudit, HarError> {
  if (typeof text !== 'string') return err({ code: 'not-json' })

  let root: unknown
  try {
    root = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch {
    return err({ code: 'not-json' })
  }

  const entries = asRecord(asRecord(root)?.log)?.entries
  if (!Array.isArray(entries)) return err({ code: 'not-har' })
  if (entries.length > MAX_ENTRIES) return err({ code: 'too-many-entries', count: entries.length })

  const found: Found[] = []
  const skipped: (HarSkipped | null)[] = []
  // Where each URL's earlier outcome sits, so a later success can replace a skip.
  const imageKeys = new Set<string>()
  const skipSlots = new Map<string, number>()
  let imageEntryCount = 0
  let duplicatesIgnored = 0

  for (let i = 0; i < entries.length; i += 1) {
    const candidate = inspect(entries[i])
    if (candidate === null) continue
    imageEntryCount += 1

    if (imageKeys.has(candidate.key)) {
      duplicatesIgnored += 1
      continue
    }

    const parts = candidate.url === '' ? null : describeUrl(candidate.url)
    const displayUrl = parts?.display ?? UNREADABLE_URL

    let outcome: Resolved
    try {
      outcome = resolve(candidate)
    } catch {
      // An allocation that fails (RangeError) is an unreadable body, not a crash.
      outcome = { kind: 'skip', reason: 'unreadable-content' }
    }

    if (outcome.kind === 'image') {
      const earlier = skipSlots.get(candidate.key)
      if (earlier !== undefined) {
        skipped[earlier] = null
        skipSlots.delete(candidate.key)
        // The earlier attempt at this URL failed and this one worked. The
        // failed one is withdrawn and counted as ignored, which keeps
        // images + skipped + duplicatesIgnored equal to imageEntryCount.
        duplicatesIgnored += 1
      }
      imageKeys.add(candidate.key)
      found.push({
        url: candidate.url,
        displayUrl,
        segments: parts?.segments ?? [],
        bytes: outcome.bytes,
        format: outcome.format,
        transferBytes:
          candidate.transfer ?? ((candidate.bodySize ?? 0) > 0 ? candidate.bodySize : null),
      })
    } else if (skipSlots.has(candidate.key)) {
      duplicatesIgnored += 1
    } else {
      skipSlots.set(candidate.key, skipped.length)
      skipped.push({
        displayUrl,
        mimeType: candidate.mime,
        reason: outcome.reason,
        bytes: skippedWeight(candidate),
      })
    }
  }

  const nameFor = createNamer()
  const images: HarImage[] = []
  for (const item of found) {
    images.push({
      name: nameFor({ segments: item.segments, format: item.format, fullUrl: item.url }),
      displayUrl: item.displayUrl,
      bytes: item.bytes,
      format: item.format,
      transferBytes: item.transferBytes,
    })
  }

  return ok({
    images,
    skipped: skipped.filter((item): item is HarSkipped => item !== null),
    entryCount: entries.length,
    imageEntryCount,
    duplicatesIgnored,
  })
}
