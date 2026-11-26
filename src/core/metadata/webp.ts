import { err, ok, type Result } from '../result'
import { concatBytes, hasAscii, orientationTiff } from './exif'
import type { Stripped } from './jpeg'
import { createLedger } from './ledger'
import type { CorruptError } from './types'

/**
 * WebP (RIFF): walk the chunks, keep an allowlist, rewrite VP8X.
 *
 * VP8X carries flags that announce EXIF (0x08) and XMP (0x04). Dropping the
 * chunks and leaving the flags would be a file that promises metadata it does
 * not have, so both bits are cleared, and 0x08 is set again only when the
 * minimal orientation block is written. The RIFF size is recomputed, and every
 * chunk keeps its pad byte so payloads stay on even offsets.
 *
 * ANMF (an animation frame) holds sub-chunks of its own. They are image data,
 * so the frame is copied whole and its insides are not searched for metadata.
 */

const KEPT: ReadonlySet<string> = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF', 'ICCP'])

const FLAG_EXIF = 0x08
const FLAG_XMP = 0x04
const VP8X_PAYLOAD = 10
const ANMF_HEADER = 16

const u32le = (bytes: Uint8Array, at: number): number =>
  (((bytes[at + 3] ?? 0) << 24) |
    ((bytes[at + 2] ?? 0) << 16) |
    ((bytes[at + 1] ?? 0) << 8) |
    (bytes[at] ?? 0)) >>>
  0

const u24le = (bytes: Uint8Array, at: number): number =>
  (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16)

const typeOf = (input: Uint8Array, at: number): string =>
  String.fromCharCode(input[at] ?? 0, input[at + 1] ?? 0, input[at + 2] ?? 0, input[at + 3] ?? 0)

/** A chunk whose pad byte is missing (lazy writer, last chunk) gets one. */
function withPad(chunk: Uint8Array): Uint8Array {
  if ((chunk.length & 1) === 0) return chunk
  const padded = new Uint8Array(chunk.length + 1)
  padded.set(chunk)
  return padded
}

function riffChunk(type: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const padded = payload.length + (payload.length & 1)
  const chunk = new Uint8Array(8 + padded)
  for (let index = 0; index < 4; index += 1) chunk[index] = type.charCodeAt(index)
  new DataView(chunk.buffer).setUint32(4, payload.length, true)
  chunk.set(payload, 8)
  return chunk
}

/** Dimensions from a bare `VP8 ` or `VP8L` payload, or null when too short. */
function bitstreamSize(type: string, payload: Uint8Array): [number, number] | null {
  if (type === 'VP8 ') {
    if (payload.length < 10) return null
    const width = ((payload[6] ?? 0) | ((payload[7] ?? 0) << 8)) & 0x3fff
    const height = ((payload[8] ?? 0) | ((payload[9] ?? 0) << 8)) & 0x3fff
    return [width, height]
  }
  if (payload.length < 5) return null
  const bits = u32le(payload, 1)
  return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1]
}

export function stripWebp(input: Uint8Array): Result<Stripped, CorruptError> {
  const length = input.length
  const fail = (detail: string): Result<never, CorruptError> =>
    err({ code: 'corrupt', format: 'webp', detail })

  if (length < 12 || !hasAscii(input, 0, 'RIFF') || !hasAscii(input, 8, 'WEBP')) {
    return fail('missing RIFF/WEBP header')
  }
  const riffSize = u32le(input, 4)
  if (riffSize < 4) return fail('RIFF size is too small')
  const riffEnd = riffSize + 8
  if (riffEnd > length) return fail('RIFF size is larger than the file')

  const ledger = createLedger()
  const kept: Uint8Array[] = []
  let vp8xIndex = -1
  let vp8xFlags = 0
  let width = 0
  let height = 0
  let imageSeen = false

  let position = 12
  while (position < riffEnd) {
    if (position + 8 > riffEnd) return fail(`chunk header cut off at byte ${position}`)
    const type = typeOf(input, position)
    const size = u32le(input, position + 4)
    const payloadStart = position + 8
    const payloadEnd = payloadStart + size
    if (payloadEnd > riffEnd)
      return fail(`${type} chunk at byte ${position} is longer than the file`)
    // The pad byte can be missing only on the very last chunk of a lazy writer.
    const next = Math.min(payloadEnd + (size & 1), riffEnd)
    const payload = input.subarray(payloadStart, payloadEnd)

    if (type === 'VP8X') {
      if (size < VP8X_PAYLOAD) return fail('VP8X chunk is cut short')
      if (vp8xIndex !== -1) return fail('more than one VP8X chunk')
      vp8xFlags = payload[0] ?? 0
      width = u24le(payload, 4) + 1
      height = u24le(payload, 7) + 1
      vp8xIndex = kept.length
      kept.push(withPad(input.subarray(position, next))) // rewritten below
    } else if (KEPT.has(type)) {
      if (type === 'VP8 ' || type === 'VP8L') {
        const size2 = bitstreamSize(type, payload)
        if (size2 === null) return fail(`${type} chunk is cut short`)
        imageSeen = true
        if (vp8xIndex === -1) [width, height] = size2
      } else if (type === 'ANMF') {
        if (size < ANMF_HEADER) return fail('ANMF chunk is cut short')
        // Validate the frame's sub-chunks so a cut frame is an error, not a copy.
        let inner = payloadStart + ANMF_HEADER
        while (inner < payloadEnd) {
          if (inner + 8 > payloadEnd) return fail('ANMF sub-chunk header is cut short')
          const innerSize = u32le(input, inner + 4)
          const innerEnd = inner + 8 + innerSize + (innerSize & 1)
          if (inner + 8 + innerSize > payloadEnd)
            return fail('ANMF sub-chunk is longer than its frame')
          inner = Math.max(inner + 8, Math.min(innerEnd, payloadEnd))
        }
        imageSeen = true
      }
      kept.push(withPad(input.subarray(position, next)))
    } else if (type === 'EXIF') {
      ledger.drop('exif', next - position)
      ledger.noteExif(hasAscii(payload, 0, 'Exif\0\0') ? payload.subarray(6) : payload)
    } else if (type === 'XMP ') {
      ledger.drop('xmp', next - position)
    } else {
      ledger.drop('other', next - position)
    }

    position = next
  }

  if (!imageSeen) return fail('no image data (VP8, VP8L or ANMF chunk)')
  if (width === 0 || height === 0) return fail('image has a zero dimension')

  const trailing = length - riffEnd
  if (trailing > 0) ledger.dropTrailing(trailing)

  /*
   * An EXIF block is only legal in an extended file, and a plain `VP8 ` or
   * `VP8L` file has no VP8X to flag it. A plain file that nevertheless carried
   * an EXIF chunk is non-standard, and viewers that follow the spec ignored it
   * too, so the orientation is not carried over (it would need a VP8X built
   * from the bitstream).
   */
  const orientation = vp8xIndex === -1 ? null : ledger.orientationToWrite()

  if (vp8xIndex !== -1) {
    const original = kept[vp8xIndex] ?? new Uint8Array(0)
    const rewritten = original.slice()
    let flags = vp8xFlags & ~(FLAG_EXIF | FLAG_XMP)
    if (orientation !== null) flags |= FLAG_EXIF
    rewritten[8] = flags
    kept[vp8xIndex] = rewritten
  }
  if (orientation !== null) kept.push(riffChunk('EXIF', orientationTiff(orientation)))

  const body = concatBytes(kept)
  const out = new Uint8Array(12 + body.length)
  out.set([0x52, 0x49, 0x46, 0x46], 0)
  new DataView(out.buffer).setUint32(4, 4 + body.length, true)
  out.set([0x57, 0x45, 0x42, 0x50], 8)
  out.set(body, 12)

  return ok({ bytes: out, width, height, removed: ledger.finish() })
}
