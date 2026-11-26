import { err, ok, type Result } from '../result'
import { concatBytes, hasAscii, orientationTiff } from './exif'
import { createLedger } from './ledger'
import type { CorruptError, RemovedMetadata } from './types'

/**
 * JPEG: walk the segments by structure and length, keep an allowlist.
 *
 * Two rules decide everything here.
 *
 * 1. The end of the image is found by walking, never by searching for FFD9.
 *    The EXIF thumbnail is a whole JPEG inside an APP1 segment and carries its
 *    own FFD9, so a search would stop inside the metadata and mistake the real
 *    picture for trailing data.
 * 2. Nothing is kept because it is harmless, only because painting needs it.
 *    Unknown markers go. So does everything after the EOI (motion-photo video,
 *    leftovers of a crop). A segment is identified by marker AND identifier:
 *    APP2 is the colour profile only when it says `ICC_PROFILE\0`.
 */

export type Stripped = {
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly width: number
  readonly height: number
  readonly removed: RemovedMetadata
}

const SOI = 0xd8
const EOI = 0xd9
const SOS = 0xda
const DNL = 0xdc

/** DHT, DAC, DQT, DRI, DHP, EXP: tables and parameters a decoder needs. */
const KEPT_TABLES: ReadonlySet<number> = new Set([0xc4, 0xcc, 0xdb, 0xdd, 0xde, 0xdf])

/** SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC), which share the range. */
const isSof = (marker: number): boolean =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc

const isRst = (marker: number): boolean => marker >= 0xd0 && marker <= 0xd7

const JFIF_PAYLOAD = 14

/**
 * Finds where the entropy-coded data of a scan ends: the offset of the 0xFF
 * that begins the next marker, or -1 when the file ends first.
 *
 * Inside a scan, FF00 is a stuffed data byte, FFD0..FFD7 are restart markers
 * and FFFF is fill before a marker. Any other FF xx ends the scan. Every step
 * moves forward, so the loop ends.
 */
function findScanEnd(input: Uint8Array, from: number): number {
  const length = input.length
  let at = from
  while (at < length) {
    const found = input.indexOf(0xff, at)
    if (found === -1 || found + 1 >= length) return -1
    const next = input[found + 1] ?? 0
    if (next === 0x00 || isRst(next)) {
      at = found + 2
    } else if (next === 0xff) {
      at = found + 1
    } else {
      return found
    }
  }
  return -1
}

export function stripJpeg(input: Uint8Array): Result<Stripped, CorruptError> {
  const length = input.length
  const fail = (detail: string): Result<never, CorruptError> =>
    err({ code: 'corrupt', format: 'jpeg', detail })

  if (length < 4 || input[0] !== 0xff || input[1] !== SOI) return fail('missing start of image')

  const ledger = createLedger()
  const kept: Uint8Array[] = [input.subarray(0, 2)]
  let jfifAtStart = false
  let width = 0
  let height = 0
  let frameSeen = false
  let scans = 0
  let finished = false
  let dnlHeight = 0

  let position = 2
  while (position < length) {
    const start = position
    if (input[position] !== 0xff) return fail(`expected a marker at byte ${position}`)

    // Fill bytes (extra FFs) may precede any marker; they travel with it.
    let cursor = position + 1
    while (cursor < length && input[cursor] === 0xff) cursor += 1
    if (cursor >= length) return fail('file ends inside a marker')

    const marker = input[cursor] ?? 0
    const afterMarker = cursor + 1
    const span = (end: number): Uint8Array => input.subarray(start, end)

    if (marker === 0x00) return fail(`invalid marker FF00 at byte ${start}`)
    if (marker === SOI) return fail(`second start of image at byte ${start}`)

    if (marker === EOI) {
      kept.push(span(afterMarker))
      const trailing = length - afterMarker
      if (trailing > 0) ledger.dropTrailing(trailing)
      finished = true
      break
    }

    // Standalone markers carry no length.
    if (marker === 0x01) {
      ledger.drop('other', afterMarker - start)
      position = afterMarker
      continue
    }
    if (isRst(marker)) {
      kept.push(span(afterMarker))
      position = afterMarker
      continue
    }

    if (afterMarker + 2 > length) return fail('file ends inside a segment header')
    const segmentLength = ((input[afterMarker] ?? 0) << 8) | (input[afterMarker + 1] ?? 0)
    if (segmentLength < 2) return fail(`segment of length ${segmentLength} at byte ${start}`)
    const end = afterMarker + segmentLength
    if (end > length) return fail(`segment at byte ${start} is longer than the file`)
    const payload = input.subarray(afterMarker + 2, end)
    const size = end - start

    if (marker === SOS) {
      const scanEnd = findScanEnd(input, end)
      if (scanEnd === -1) return fail('scan data runs to the end of the file (no end of image)')
      kept.push(span(scanEnd))
      scans += 1
      position = scanEnd
      continue
    }

    if (isSof(marker)) {
      if (payload.length < 6) return fail('frame header is too short')
      if (!frameSeen) {
        frameSeen = true
        height = ((payload[1] ?? 0) << 8) | (payload[2] ?? 0)
        width = ((payload[3] ?? 0) << 8) | (payload[4] ?? 0)
      }
      kept.push(span(end))
    } else if (marker === DNL) {
      if (payload.length >= 2) dnlHeight = ((payload[0] ?? 0) << 8) | (payload[1] ?? 0)
      kept.push(span(end))
    } else if (KEPT_TABLES.has(marker)) {
      kept.push(span(end))
    } else if (marker === 0xe0 && hasAscii(payload, 0, 'JFIF\0')) {
      if (payload.length < JFIF_PAYLOAD) {
        ledger.drop('other', size)
      } else {
        const hasThumb = (payload[12] ?? 0) * (payload[13] ?? 0) > 0
        if (kept.length === 1) jfifAtStart = true
        if (payload.length === JFIF_PAYLOAD && !hasThumb) {
          kept.push(span(end))
        } else {
          // An embedded RGB thumbnail is a second copy of the photo. Zero its
          // size fields and cut the segment to the 16 bytes a bare JFIF has.
          const rewritten = new Uint8Array(4 + JFIF_PAYLOAD)
          rewritten.set([0xff, 0xe0, 0x00, 2 + JFIF_PAYLOAD])
          rewritten.set(payload.subarray(0, JFIF_PAYLOAD), 4)
          rewritten[4 + 12] = 0
          rewritten[4 + 13] = 0
          kept.push(rewritten)
          ledger.drop(hasThumb ? 'thumbnail' : 'other', size - rewritten.length)
          position = end
          continue
        }
      }
    } else if (marker === 0xe0 && hasAscii(payload, 0, 'JFXX\0')) {
      ledger.drop('thumbnail', size)
    } else if (marker === 0xe1) {
      if (hasAscii(payload, 0, 'Exif\0')) {
        ledger.drop('exif', size)
        ledger.noteExif(payload.subarray(6))
      } else if (
        hasAscii(payload, 0, 'http://ns.adobe.com/xap/1.0/\0') ||
        hasAscii(payload, 0, 'http://ns.adobe.com/xmp/extension/\0')
      ) {
        ledger.drop('xmp', size)
      } else {
        ledger.drop('other', size)
      }
    } else if (marker === 0xe2) {
      if (hasAscii(payload, 0, 'ICC_PROFILE\0')) kept.push(span(end))
      else ledger.drop(hasAscii(payload, 0, 'MPF\0') ? 'mpf' : 'other', size)
    } else if (marker === 0xee && hasAscii(payload, 0, 'Adobe')) {
      kept.push(span(end))
    } else if (marker === 0xed && hasAscii(payload, 0, 'Photoshop 3.0\0')) {
      ledger.drop('iptc', size)
    } else if (marker === 0xfe) {
      ledger.drop('comment', size)
    } else {
      ledger.drop('other', size)
    }

    position = end
  }

  if (!finished) return fail('missing end of image (EOI)')
  if (!frameSeen) return fail('no frame header (SOF)')
  if (scans === 0) return fail('no scan (SOS)')
  if (height === 0) height = dnlHeight
  if (width === 0 || height === 0) return fail('the frame header declares a zero dimension')

  /*
   * The orientation block goes right after a leading JFIF segment, or after
   * the SOI when there is none. JFIF asks to be first; EXIF readers look for
   * APP1 anywhere in the header, and scripts/make-fixtures.mjs places it the
   * same way. Putting it after JFIF keeps both specs satisfied for the one
   * file that matters most: a plain phone or browser JPEG.
   */
  const orientation = ledger.orientationToWrite()
  if (orientation !== null) {
    const tiff = orientationTiff(orientation)
    const segment = new Uint8Array(4 + 6 + tiff.length)
    segment.set([0xff, 0xe1, 0x00, 2 + 6 + tiff.length, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00])
    segment.set(tiff, 10)
    kept.splice(jfifAtStart ? 2 : 1, 0, segment)
  }

  return ok({ bytes: concatBytes(kept), width, height, removed: ledger.finish() })
}
