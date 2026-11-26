import type { SupportedFormat } from '../detect'

/**
 * What the HAR reader hands to the rest of the app.
 *
 * A HAR is a foreign file that carries secrets (cookies, Authorization
 * headers, tokens in query strings, request bodies). None of those fields has
 * a place in these types, and that is the design: the reader cannot leak what
 * it has nowhere to put.
 */

/** An image that was extracted and can be compressed and measured. */
export type HarImage = {
  /** Safe, flat and unique within the audit. The extension comes from the real bytes. */
  readonly name: string
  /** Origin and path only: no query, fragment or credentials. Plain text. */
  readonly displayUrl: string
  /** The decoded body. A fresh copy: it does not alias the parsed HAR. */
  readonly bytes: Uint8Array<ArrayBuffer>
  /** Detected from the bytes, never from the mime type the HAR claims. */
  readonly format: SupportedFormat
  /** Wire size when the HAR states it. */
  readonly transferBytes: number | null
}

export type SkipReason =
  | 'no-content' //          the HAR was exported without response bodies
  | 'cached' //              answered from cache, so there is no body to measure
  | 'unsupported-format' //  a real image we do not process (SVG, GIF, ICO, HEIC...)
  | 'unreadable-content' //  not base64, not decodable, or not an image after all
  | 'partial' //             a 206 range response: the bytes are a piece, not the file
  | 'failed-request' //      status 0 or >= 400

/** An image entry that cannot be measured, listed with its weight when the HAR says it. */
export type HarSkipped = {
  readonly displayUrl: string
  /** Sanitised mime type (`type/subtype` or empty), never free text from the HAR. */
  readonly mimeType: string
  readonly reason: SkipReason
  readonly bytes: number | null
}

export type HarAudit = {
  readonly images: readonly HarImage[]
  readonly skipped: readonly HarSkipped[]
  /** Every entry in the HAR, images or not. */
  readonly entryCount: number
  /** Entries recognised as images, duplicates included: images + skipped + duplicatesIgnored. */
  readonly imageEntryCount: number
  /** Image entries whose full URL had already been counted. */
  readonly duplicatesIgnored: number
}

export type HarError =
  | { readonly code: 'not-json' }
  | { readonly code: 'not-har' }
  | { readonly code: 'too-many-entries'; readonly count: number }
