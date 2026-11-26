/**
 * A deliberately small, defensive EXIF reader, and the writer for the one tag
 * we keep.
 *
 * The reader is informational only. Removing metadata never depends on
 * understanding it: a block this code cannot parse is dropped all the same and
 * reported as unreadable. Because the input is hostile by assumption, every
 * access is bounds-checked and every loop has a fixed ceiling.
 */

export type ExifInfo = {
  /** The TIFF header and IFD0 were present and inside the block. */
  readonly readable: boolean
  /** 1 to 8 when IFD0 carries a valid Orientation, else null. */
  readonly orientation: number | null
  readonly hadGps: boolean
  readonly hadCameraInfo: boolean
  /** IFD0 links to a second directory, which is where EXIF keeps its thumbnail. */
  readonly hasThumbnail: boolean
}

const UNREADABLE: ExifInfo = {
  readable: false,
  orientation: null,
  hadGps: false,
  hadCameraInfo: false,
  hasThumbnail: false,
}

/** No real IFD0 has more than a few dozen tags; this only bounds the loop. */
const MAX_IFD_ENTRIES = 512

const TAG_MAKE = 0x010f
const TAG_MODEL = 0x0110
const TAG_ORIENTATION = 0x0112
const TAG_GPS_IFD = 0x8825
const TYPE_SHORT = 3

/** Parses a TIFF block (the bytes after `Exif\0\0`) without ever throwing. */
export function readExif(tiff: Uint8Array): ExifInfo {
  const length = tiff.length
  if (length < 8) return UNREADABLE

  const little = tiff[0] === 0x49 && tiff[1] === 0x49
  const big = tiff[0] === 0x4d && tiff[1] === 0x4d
  if (!little && !big) return UNREADABLE

  const u16 = (at: number): number | null => {
    if (at < 0 || at + 2 > length) return null
    const a = tiff[at] ?? 0
    const b = tiff[at + 1] ?? 0
    return little ? a | (b << 8) : (a << 8) | b
  }
  const u32 = (at: number): number | null => {
    if (at < 0 || at + 4 > length) return null
    const a = tiff[at] ?? 0
    const b = tiff[at + 1] ?? 0
    const c = tiff[at + 2] ?? 0
    const d = tiff[at + 3] ?? 0
    return (
      (little ? (d << 24) | (c << 16) | (b << 8) | a : (a << 24) | (b << 16) | (c << 8) | d) >>> 0
    )
  }

  if (u16(2) !== 42) return UNREADABLE
  const ifd0 = u32(4)
  if (ifd0 === null || ifd0 < 8) return UNREADABLE
  const declared = u16(ifd0)
  if (declared === null) return UNREADABLE

  // Read only the entries that actually fit in the block, up to the ceiling.
  const fitting = Math.floor((length - ifd0 - 2) / 12)
  const entries = Math.min(declared, fitting, MAX_IFD_ENTRIES)

  let orientation: number | null = null
  let hadGps = false
  let hadCameraInfo = false

  for (let index = 0; index < entries; index += 1) {
    const entry = ifd0 + 2 + index * 12
    const tag = u16(entry)

    if (tag === TAG_MAKE || tag === TAG_MODEL) {
      hadCameraInfo = true
    } else if (tag === TAG_ORIENTATION) {
      // A SHORT with count 1 sits inline, left-justified in the value field.
      if (u16(entry + 2) === TYPE_SHORT && u32(entry + 4) === 1) {
        const value = u16(entry + 8)
        if (value !== null && value >= 1 && value <= 8 && orientation === null) {
          orientation = value
        }
      }
    } else if (tag === TAG_GPS_IFD) {
      // The tag existing proves nothing; its directory must hold an entry.
      const gps = u32(entry + 8)
      if (gps !== null && gps >= 8) {
        const gpsCount = u16(gps)
        if (gpsCount !== null && gpsCount >= 1 && gps + 2 + 12 <= length) hadGps = true
      }
    }
  }

  const next = u32(ifd0 + 2 + declared * 12)
  let hasThumbnail = false
  if (next !== null && next >= 8) {
    const secondCount = u16(next)
    hasThumbnail = secondCount !== null && secondCount >= 1
  }

  return { readable: true, orientation, hadGps, hadCameraInfo, hasThumbnail }
}

/**
 * The smallest EXIF that keeps a photo upright: a little-endian TIFF with one
 * IFD0 holding one SHORT Orientation entry and no next IFD (26 bytes). It is
 * written from scratch and never derived from the original block, because
 * copying or patching the original is how the rest of it would come along.
 *
 * Byte for byte it is what scripts/make-fixtures.mjs writes, which is what
 * lets a test compare a stripped file with the fixture.
 */
export function orientationTiff(orientation: number): Uint8Array<ArrayBuffer> {
  const tiff = new Uint8Array(26)
  const view = new DataView(tiff.buffer)
  tiff[0] = 0x49 // "II": little-endian
  tiff[1] = 0x49
  view.setUint16(2, 42, true) // TIFF magic
  view.setUint32(4, 8, true) // IFD0 right after the header
  view.setUint16(8, 1, true) // one entry
  view.setUint16(10, TAG_ORIENTATION, true)
  view.setUint16(12, TYPE_SHORT, true)
  view.setUint32(14, 1, true) // count
  view.setUint16(18, orientation, true) // value, inline
  // bytes 20..21 are the unused half of the value field; 22..25 are "no IFD1"
  return tiff
}

/** True when `bytes` holds the ASCII `text` at `offset`. */
export function hasAscii(bytes: Uint8Array, offset: number, text: string): boolean {
  if (offset < 0 || offset + text.length > bytes.length) return false
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false
  }
  return true
}

/** Concatenates byte runs into one fresh buffer. */
export function concatBytes(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  let total = 0
  for (const part of parts) total += part.length
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}
