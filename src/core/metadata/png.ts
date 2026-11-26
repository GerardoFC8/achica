import { err, ok, type Result } from '../result'
import { concatBytes, hasAscii, orientationTiff } from './exif'
import type { Stripped } from './jpeg'
import { createLedger } from './ledger'
import type { CorruptError } from './types'

/**
 * PNG: walk the chunks by length, keep an allowlist, copy kept chunks verbatim.
 *
 * Kept chunks are copied with their original CRC and never re-checked or
 * rebuilt, so the pixels cannot change. The animation chunks (acTL, fcTL,
 * fdAT) are on the list because dropping them turns an APNG into its first
 * frame. Everything else goes, private chunks and unknown ones included, and
 * so does anything after IEND.
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const KEPT: ReadonlySet<string> = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'iCCP',
  'sBIT',
  'bKGD',
  'hIST',
  'pHYs',
  'cICP',
  'mDCV',
  'cLLI',
  'acTL',
  'fcTL',
  'fdAT',
])

const CHUNK_OVERHEAD = 12 // length + type + CRC

let crcTable: Uint32Array | null = null

function crc32(bytes: Uint8Array): number {
  if (crcTable === null) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function buildChunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const chunk = new Uint8Array(CHUNK_OVERHEAD + data.length)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, data.length)
  for (let index = 0; index < 4; index += 1) chunk[4 + index] = type.charCodeAt(index)
  chunk.set(data, 8)
  // The CRC covers the type and the data, not the length.
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)))
  return chunk
}

const typeOf = (input: Uint8Array, at: number): string =>
  String.fromCharCode(input[at] ?? 0, input[at + 1] ?? 0, input[at + 2] ?? 0, input[at + 3] ?? 0)

/** An iTXt chunk is XMP when its keyword is XML:com.adobe.xmp. */
const isXmpText = (data: Uint8Array): boolean => hasAscii(data, 0, 'XML:com.adobe.xmp\0')

export function stripPng(input: Uint8Array): Result<Stripped, CorruptError> {
  const length = input.length
  const fail = (detail: string): Result<never, CorruptError> =>
    err({ code: 'corrupt', format: 'png', detail })

  if (length < SIGNATURE.length || SIGNATURE.some((byte, index) => input[index] !== byte)) {
    return fail('missing PNG signature')
  }

  const ledger = createLedger()
  const kept: Uint8Array[] = [input.subarray(0, 8)]
  let ihdrEnd = 0
  let width = 0
  let height = 0
  let finished = false
  let position = 8

  while (position < length) {
    if (position + CHUNK_OVERHEAD > length) return fail(`chunk header cut off at byte ${position}`)
    const dataLength =
      (((input[position] ?? 0) << 24) |
        ((input[position + 1] ?? 0) << 16) |
        ((input[position + 2] ?? 0) << 8) |
        (input[position + 3] ?? 0)) >>>
      0
    const type = typeOf(input, position + 4)
    const end = position + CHUNK_OVERHEAD + dataLength
    if (end > length) return fail(`${type} chunk at byte ${position} is longer than the file`)

    const data = input.subarray(position + 8, position + 8 + dataLength)
    const chunk = input.subarray(position, end)

    if (kept.length === 1 && type !== 'IHDR') return fail('the first chunk is not IHDR')

    if (type === 'IHDR') {
      if (kept.length !== 1) return fail('more than one IHDR')
      if (dataLength !== 13) return fail('IHDR chunk has the wrong size')
      width =
        (((data[0] ?? 0) << 24) |
          ((data[1] ?? 0) << 16) |
          ((data[2] ?? 0) << 8) |
          (data[3] ?? 0)) >>>
        0
      height =
        (((data[4] ?? 0) << 24) |
          ((data[5] ?? 0) << 16) |
          ((data[6] ?? 0) << 8) |
          (data[7] ?? 0)) >>>
        0
      if (width === 0 || height === 0) return fail('IHDR declares a zero dimension')
      kept.push(chunk)
      ihdrEnd = kept.length
    } else if (KEPT.has(type)) {
      kept.push(chunk)
    } else if (type === 'eXIf') {
      ledger.drop('exif', chunk.length)
      ledger.noteExif(hasAscii(data, 0, 'Exif\0\0') ? data.subarray(6) : data)
    } else if (type === 'iTXt' && isXmpText(data)) {
      ledger.drop('xmp', chunk.length)
    } else if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      ledger.drop('png-text', chunk.length)
    } else if (type === 'tIME') {
      ledger.drop('png-time', chunk.length)
    } else {
      ledger.drop('other', chunk.length)
    }

    position = end
    if (type === 'IEND') {
      const trailing = length - end
      if (trailing > 0) ledger.dropTrailing(trailing)
      finished = true
      break
    }
  }

  if (!finished) return fail('missing IEND chunk')

  // The orientation chunk goes right after IHDR, where PNG readers look first.
  const orientation = ledger.orientationToWrite()
  if (orientation !== null)
    kept.splice(ihdrEnd, 0, buildChunk('eXIf', orientationTiff(orientation)))

  return ok({ bytes: concatBytes(kept), width, height, removed: ledger.finish() })
}
