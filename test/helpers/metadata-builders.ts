/**
 * Byte builders for the metadata tests.
 *
 * The tests build their dirty files here, from clean fixtures, instead of
 * keeping hand-edited binaries in the repository. The point of the stripper's
 * tests is that the parser must not be allowed to approve itself: a dirty
 * file is assembled with recognisable sentinels, and the assertion is a raw
 * byte search of the output for every one of them.
 *
 * Pure: no Node and no DOM, so the node and the browser projects share it.
 */

const encoder = new TextEncoder()

export const ascii = (text: string): Uint8Array<ArrayBuffer> => new Uint8Array(encoder.encode(text))

export function cat(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

const be16 = (value: number): Uint8Array<ArrayBuffer> => new Uint8Array([value >> 8, value & 0xff])
const be32 = (value: number): Uint8Array<ArrayBuffer> =>
  new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff])
const le16 = (value: number): Uint8Array<ArrayBuffer> => new Uint8Array([value & 0xff, value >> 8])
const le32 = (value: number): Uint8Array<ArrayBuffer> =>
  new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff])
const le24 = (value: number): Uint8Array<ArrayBuffer> =>
  new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff])

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index])
}

/** Raw search: the offset of `needle` inside `haystack`, or -1. */
export function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  if (needle.length === 0) return from
  const first = needle[0]
  for (
    let at = haystack.indexOf(first ?? 0, from);
    at !== -1;
    at = haystack.indexOf(first ?? 0, at + 1)
  ) {
    if (at + needle.length > haystack.length) return -1
    let match = true
    for (let index = 1; index < needle.length; index += 1) {
      if (haystack[at + index] !== needle[index]) {
        match = false
        break
      }
    }
    if (match) return at
  }
  return -1
}

/* ------------------------------------------------------------------ */
/* Sentinels                                                           */
/* ------------------------------------------------------------------ */

/** GPS latitude as three RATIONALs (40/1, 26/1, 4631/100), little-endian. */
export const GPS_LATITUDE = cat(le32(40), le32(1), le32(26), le32(1), le32(4631), le32(100))
/** GPS longitude as three RATIONALs (79/1, 58/1, 5614/100), little-endian. */
export const GPS_LONGITUDE = cat(le32(79), le32(1), le32(58), le32(1), le32(5614), le32(100))
/** The seconds of the latitude alone: eight bytes that exist nowhere else. */
export const GPS_SECONDS = cat(le32(4631), le32(100))

export const TEXT_SENTINELS = {
  make: 'SENTINEL_MAKE_ZX81',
  model: 'SENTINEL_MODEL_QQ9',
  xmp: 'SENTINEL_XMP_CREATOR_JANE',
  comment: 'SENTINEL_COMMENT_HELLO',
  iptc: 'SENTINEL_IPTC_CAPTION',
  mpf: 'SENTINEL_MPF_SECOND_IMAGE',
  exifThumb: 'SENTINEL_EXIF_THUMB_PIXELS',
  jfifThumb: 'SENTINEL_JFIF_THUMB!', // 20 bytes, filled in below
  jfxx: 'SENTINEL_JFXX_THUMB',
  tail: 'SENTINEL_TAIL_MOTION_VIDEO',
  png: 'SENTINEL_PNG_TEXT_KEY',
  pngPrivate: 'SENTINEL_PNG_PRIVATE',
  pngTime: 'SENTINEL_PNG_ZTXT',
  other: 'SENTINEL_UNKNOWN_SEGMENT',
} as const

export const ALL_TEXT_SENTINELS: readonly Uint8Array[] = Object.values(TEXT_SENTINELS).map(ascii)
export const ALL_GPS_SENTINELS: readonly Uint8Array[] = [GPS_LATITUDE, GPS_LONGITUDE, GPS_SECONDS]

/** Every sentinel the dirty builders can plant: text and GPS rationals. */
export const ALL_SENTINELS: readonly Uint8Array[] = [...ALL_TEXT_SENTINELS, ...ALL_GPS_SENTINELS]

/* ------------------------------------------------------------------ */
/* TIFF / EXIF                                                         */
/* ------------------------------------------------------------------ */

export type TiffOptions = {
  readonly orientation?: number
  readonly make?: string
  readonly model?: string
  /** A GPS IFD with latitude and longitude rationals. */
  readonly gps?: boolean
  /** A JPEG thumbnail, stored the standard way, in IFD1. */
  readonly thumbnail?: Uint8Array
}

type Entry = { tag: number; type: number; count: number; value: Uint8Array }

const entryBytes = (entry: Entry): Uint8Array<ArrayBuffer> =>
  cat(le16(entry.tag), le16(entry.type), le32(entry.count), entry.value)

/** A little-endian TIFF block with the pieces `options` asks for. */
export function buildTiff(options: TiffOptions): Uint8Array<ArrayBuffer> {
  const ifd0Entries =
    (options.make === undefined ? 0 : 1) +
    (options.model === undefined ? 0 : 1) +
    (options.orientation === undefined ? 0 : 1) +
    (options.gps === true ? 1 : 0)
  const ifd0Size = 2 + ifd0Entries * 12 + 4
  const dataStart = 8 + ifd0Size

  const data: Uint8Array[] = []
  let used = 0
  const place = (bytes: Uint8Array): number => {
    const at = dataStart + used
    data.push(bytes)
    used += bytes.length
    return at
  }
  const pad = (): void => {
    if (used % 2 === 1) place(new Uint8Array(1))
  }

  const entries: Entry[] = []
  if (options.make !== undefined) {
    const text = ascii(`${options.make}\0`)
    entries.push({ tag: 0x010f, type: 2, count: text.length, value: le32(place(text)) })
    pad()
  }
  if (options.model !== undefined) {
    const text = ascii(`${options.model}\0`)
    entries.push({ tag: 0x0110, type: 2, count: text.length, value: le32(place(text)) })
    pad()
  }
  if (options.orientation !== undefined) {
    entries.push({
      tag: 0x0112,
      type: 3,
      count: 1,
      value: cat(le16(options.orientation), new Uint8Array(2)),
    })
  }
  if (options.gps === true) {
    const latitudeAt = place(GPS_LATITUDE)
    const longitudeAt = place(GPS_LONGITUDE)
    const gpsIfd = cat(
      le16(4),
      entryBytes({ tag: 1, type: 2, count: 2, value: cat(ascii('N\0'), new Uint8Array(2)) }),
      entryBytes({ tag: 2, type: 5, count: 3, value: le32(latitudeAt) }),
      entryBytes({ tag: 3, type: 2, count: 2, value: cat(ascii('W\0'), new Uint8Array(2)) }),
      entryBytes({ tag: 4, type: 5, count: 3, value: le32(longitudeAt) }),
      le32(0),
    )
    entries.push({ tag: 0x8825, type: 4, count: 1, value: le32(place(gpsIfd)) })
  }

  let ifd1Offset = 0
  if (options.thumbnail !== undefined) {
    const thumbnailAt = place(options.thumbnail)
    pad()
    ifd1Offset = place(
      cat(
        le16(2),
        entryBytes({ tag: 0x0201, type: 4, count: 1, value: le32(thumbnailAt) }),
        entryBytes({ tag: 0x0202, type: 4, count: 1, value: le32(options.thumbnail.length) }),
        le32(0),
      ),
    )
  }

  return cat(
    ascii('II'),
    le16(42),
    le32(8),
    le16(ifd0Entries),
    ...entries.map(entryBytes),
    le32(ifd1Offset),
    ...data,
  )
}

/** A thumbnail with its own FFD9 in the middle of an APP1: a trap for FFD9 searches. */
export const FAKE_EXIF_THUMBNAIL = cat(
  new Uint8Array([0xff, 0xd8, 0xff, 0xfe]),
  be16(2 + TEXT_SENTINELS.exifThumb.length),
  ascii(TEXT_SENTINELS.exifThumb),
  new Uint8Array([0xff, 0xd9]),
)

/* ------------------------------------------------------------------ */
/* JPEG                                                                */
/* ------------------------------------------------------------------ */

export function jpegSegment(marker: number, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  return cat(new Uint8Array([0xff, marker]), be16(2 + payload.length), payload)
}

export type DirtyJpegOptions = {
  readonly orientation?: number
  readonly tail?: boolean
}

/**
 * Takes a clean baseline JFIF JPEG (as the browser writes it) and returns the
 * same picture wrapped in every kind of metadata the stripper must remove.
 * The clean file is the expected answer for orientation-less options.
 */
export function dirtyJpeg(
  clean: Uint8Array,
  options: DirtyJpegOptions = {},
): Uint8Array<ArrayBuffer> {
  const jfifLength = (clean[4] ?? 0) * 256 + (clean[5] ?? 0)
  if (clean[2] !== 0xff || clean[3] !== 0xe0 || jfifLength !== 16) {
    throw new Error('the clean JPEG is expected to start with a bare 16-byte JFIF segment')
  }
  const jfif = clean.subarray(2, 2 + 2 + jfifLength)
  const rest = clean.subarray(2 + 2 + jfifLength, clean.length - 2) // up to, not including, EOI
  if (clean[clean.length - 2] !== 0xff || clean[clean.length - 1] !== 0xd9) {
    throw new Error('the clean JPEG is expected to end with EOI')
  }

  // JFIF with a 4x5 thumbnail of 60 bytes, whose first 20 are a sentinel.
  const jfifPayload = jfif.slice(4)
  jfifPayload[12] = 4
  jfifPayload[13] = 5
  const thumbPixels = cat(ascii(TEXT_SENTINELS.jfifThumb), new Uint8Array(40).fill(0x7e))
  const jfifWithThumbnail = jpegSegment(0xe0, cat(jfifPayload, thumbPixels))

  const tiff = buildTiff({
    ...(options.orientation === undefined ? {} : { orientation: options.orientation }),
    make: TEXT_SENTINELS.make,
    model: TEXT_SENTINELS.model,
    gps: true,
    thumbnail: FAKE_EXIF_THUMBNAIL,
  })

  const parts: Uint8Array[] = [
    new Uint8Array([0xff, 0xd8]),
    jfifWithThumbnail,
    jpegSegment(0xe1, cat(ascii('Exif\0\0'), tiff)),
    jpegSegment(
      0xe1,
      cat(
        ascii('http://ns.adobe.com/xap/1.0/\0'),
        ascii(`<x:xmpmeta><dc:creator>${TEXT_SENTINELS.xmp}</dc:creator></x:xmpmeta>`),
      ),
    ),
    jpegSegment(0xe2, cat(ascii('MPF\0'), ascii(TEXT_SENTINELS.mpf))),
    jpegSegment(0xe0, cat(ascii('JFXX\0'), new Uint8Array([0x10]), ascii(TEXT_SENTINELS.jfxx))),
    jpegSegment(0xed, cat(ascii('Photoshop 3.0\0'), ascii('8BIM'), ascii(TEXT_SENTINELS.iptc))),
    jpegSegment(0xfe, ascii(TEXT_SENTINELS.comment)),
    jpegSegment(0xe3, ascii(TEXT_SENTINELS.other)),
    jpegSegment(0xef, ascii('APP15 data')),
    jpegSegment(0xf0, ascii('JPG0 data')),
    rest,
    new Uint8Array([0xff, 0xd9]),
  ]
  if (options.tail !== false) {
    parts.push(ascii(TEXT_SENTINELS.tail), new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 0x00]))
  }
  return cat(...parts)
}

export type SyntheticScan = {
  /** Raw entropy-coded bytes, stuffing and restart markers included. */
  readonly entropy: Uint8Array
  /** Segments that sit between this scan and the next one. */
  readonly after?: readonly Uint8Array[]
}

/**
 * A progressive-shaped JPEG made only of structure: SOF2, a table, and one SOS
 * per scan. It is not decodable and is not meant to be: it exists to exercise
 * the walker's scan handling with bytes chosen to be awkward.
 */
export function syntheticProgressiveJpeg(scans: readonly SyntheticScan[]): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [
    new Uint8Array([0xff, 0xd8]),
    jpegSegment(0xc2, new Uint8Array([8, 0, 16, 0, 16, 1, 1, 0x11, 0])),
    jpegSegment(0xc4, new Uint8Array([0x00, ...new Array<number>(16).fill(0), 0x00])),
  ]
  for (const scan of scans) {
    parts.push(jpegSegment(0xda, new Uint8Array([1, 1, 0, 0, 63, 0])), scan.entropy)
    for (const segment of scan.after ?? []) parts.push(segment)
  }
  parts.push(new Uint8Array([0xff, 0xd9]))
  return cat(...parts)
}

/* ------------------------------------------------------------------ */
/* PNG                                                                 */
/* ------------------------------------------------------------------ */

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

export function pngChunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const body = cat(ascii(type), data)
  return cat(be32(data.length), body, be32(crc32(body)))
}

export type PngChunk = { readonly type: string; readonly bytes: Uint8Array }

export function pngChunks(png: Uint8Array): PngChunk[] {
  const chunks: PngChunk[] = []
  let at = 8
  while (at + 12 <= png.length) {
    const length = new DataView(png.buffer, png.byteOffset + at, 4).getUint32(0)
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8))
    chunks.push({ type, bytes: png.subarray(at, at + 12 + length) })
    at += 12 + length
    if (type === 'IEND') break
  }
  return chunks
}

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export const pngFromChunks = (chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> =>
  cat(PNG_SIGNATURE, ...chunks)

export function dirtyPng(
  clean: Uint8Array,
  options: { readonly orientation?: number; readonly tail?: boolean } = {},
): Uint8Array<ArrayBuffer> {
  const chunks = pngChunks(clean)
  const ihdr = chunks[0]
  if (ihdr === undefined || ihdr.type !== 'IHDR') throw new Error('clean PNG has no IHDR')

  const tiff = buildTiff({
    ...(options.orientation === undefined ? {} : { orientation: options.orientation }),
    make: TEXT_SENTINELS.make,
    model: TEXT_SENTINELS.model,
    gps: true,
    thumbnail: FAKE_EXIF_THUMBNAIL,
  })
  const xmpPacket = `<x:xmpmeta><dc:creator>${TEXT_SENTINELS.xmp}</dc:creator></x:xmpmeta>`

  const dirty: Uint8Array[] = [
    pngChunk('tEXt', ascii(`${TEXT_SENTINELS.png}\0${TEXT_SENTINELS.comment}`)),
    pngChunk(
      'iTXt',
      cat(ascii('XML:com.adobe.xmp\0'), new Uint8Array([0, 0]), ascii('\0\0'), ascii(xmpPacket)),
    ),
    pngChunk('eXIf', tiff),
    pngChunk('tIME', new Uint8Array([0x07, 0xe8, 6, 15, 12, 30, 45])),
    pngChunk('prVT', ascii(TEXT_SENTINELS.pngPrivate)),
    pngChunk('zTXt', cat(ascii(`${TEXT_SENTINELS.pngTime}\0`), new Uint8Array([0]), ascii('x'))),
  ]

  const tail = options.tail === false ? new Uint8Array(0) : ascii(TEXT_SENTINELS.tail)
  return cat(
    PNG_SIGNATURE,
    ihdr.bytes,
    ...dirty,
    ...chunks.slice(1).map((chunk) => chunk.bytes),
    tail,
  )
}

/** A PNG with an eXIf chunk carrying only an orientation, as a phone-era tool writes it. */
export function pngWithOrientation(
  clean: Uint8Array,
  orientation: number,
): Uint8Array<ArrayBuffer> {
  const chunks = pngChunks(clean)
  const [ihdr, ...rest] = chunks
  if (ihdr === undefined) throw new Error('clean PNG has no IHDR')
  return pngFromChunks([
    ihdr.bytes,
    pngChunk('eXIf', buildTiff({ orientation })),
    ...rest.map((chunk) => chunk.bytes),
  ])
}

/**
 * Turns a still PNG into a minimal APNG by adding acTL, fcTL and a fdAT frame
 * built from the same IDAT data. The animation does not need to be playable
 * for the stripper's purposes; the chunk types and bytes are what matter.
 */
export function apngFrom(clean: Uint8Array): Uint8Array<ArrayBuffer> {
  const chunks = pngChunks(clean)
  const ihdr = chunks.find((chunk) => chunk.type === 'IHDR')
  const idat = chunks.find((chunk) => chunk.type === 'IDAT')
  if (ihdr === undefined || idat === undefined) throw new Error('clean PNG lacks IHDR or IDAT')

  const view = new DataView(ihdr.bytes.buffer, ihdr.bytes.byteOffset + 8, 8)
  const width = view.getUint32(0)
  const height = view.getUint32(4)
  const frameControl = (sequence: number): Uint8Array<ArrayBuffer> =>
    pngChunk(
      'fcTL',
      cat(
        be32(sequence),
        be32(width),
        be32(height),
        be32(0),
        be32(0),
        be16(1),
        be16(10),
        new Uint8Array([0, 0]),
      ),
    )
  const idatData = idat.bytes.subarray(8, idat.bytes.length - 4)

  return pngFromChunks([
    ihdr.bytes,
    pngChunk('acTL', cat(be32(2), be32(0))),
    frameControl(0),
    idat.bytes,
    frameControl(1),
    pngChunk('fdAT', cat(be32(2), idatData)),
    pngChunk('IEND', new Uint8Array(0)),
  ])
}

/* ------------------------------------------------------------------ */
/* WebP                                                                */
/* ------------------------------------------------------------------ */

export function riffChunk(type: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  return cat(ascii(type), le32(payload.length), payload, new Uint8Array(payload.length & 1))
}

export type RiffChunk = {
  readonly type: string
  readonly bytes: Uint8Array
  readonly payload: Uint8Array
}

export function riffChunks(webp: Uint8Array): RiffChunk[] {
  const chunks: RiffChunk[] = []
  let at = 12
  while (at + 8 <= webp.length) {
    const size = new DataView(webp.buffer, webp.byteOffset + at + 4, 4).getUint32(0, true)
    const end = at + 8 + size + (size & 1)
    chunks.push({
      type: String.fromCharCode(...webp.subarray(at, at + 4)),
      bytes: webp.subarray(at, end),
      payload: webp.subarray(at + 8, at + 8 + size),
    })
    at = end
  }
  return chunks
}

export function riffFile(
  chunks: readonly Uint8Array[],
  tail?: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const body = cat(...chunks)
  return cat(ascii('RIFF'), le32(4 + body.length), ascii('WEBP'), body, tail ?? new Uint8Array(0))
}

export function vp8xPayload(flags: number, width: number, height: number): Uint8Array<ArrayBuffer> {
  return cat(new Uint8Array([flags, 0, 0, 0]), le24(width - 1), le24(height - 1))
}

/**
 * A WebP with VP8X flagged for EXIF and XMP, the chunks themselves, an unknown
 * odd-sized chunk (to exercise padding) and a tail after the RIFF end.
 * `clean` must itself be an extended file; its VP8X flags are replaced.
 */
export function dirtyWebp(
  clean: Uint8Array,
  options: { readonly orientation?: number; readonly tail?: boolean } = {},
): Uint8Array<ArrayBuffer> {
  const chunks = riffChunks(clean)
  const vp8x = chunks.find((chunk) => chunk.type === 'VP8X')
  if (vp8x === undefined) throw new Error('clean WebP is expected to be an extended file')

  const flags = (vp8x.payload[0] ?? 0) | 0x08 | 0x04
  const dirtyVp8x = riffChunk('VP8X', cat(new Uint8Array([flags]), vp8x.payload.subarray(1)))
  const tiff = buildTiff({
    ...(options.orientation === undefined ? {} : { orientation: options.orientation }),
    make: TEXT_SENTINELS.make,
    model: TEXT_SENTINELS.model,
    gps: true,
    thumbnail: FAKE_EXIF_THUMBNAIL,
  })

  return riffFile(
    [
      ...chunks.map((chunk) => (chunk.type === 'VP8X' ? dirtyVp8x : chunk.bytes)),
      riffChunk('EXIF', tiff),
      riffChunk(
        'XMP ',
        ascii(`<x:xmpmeta><dc:creator>${TEXT_SENTINELS.xmp}</dc:creator></x:xmpmeta>`),
      ),
      riffChunk('ZZZZ', ascii(`${TEXT_SENTINELS.other}!`)), // 25 bytes: odd, so padded
    ],
    options.tail === false ? undefined : ascii(TEXT_SENTINELS.tail),
  )
}

/** A WebP with only an EXIF orientation, on top of an extended file. */
export function webpWithOrientation(
  clean: Uint8Array,
  orientation: number,
): Uint8Array<ArrayBuffer> {
  const chunks = riffChunks(clean)
  return riffFile([
    ...chunks.map((chunk) =>
      chunk.type === 'VP8X'
        ? riffChunk(
            'VP8X',
            cat(new Uint8Array([(chunk.payload[0] ?? 0) | 0x08]), chunk.payload.subarray(1)),
          )
        : chunk.bytes,
    ),
    riffChunk('EXIF', buildTiff({ orientation })),
  ])
}

/** A minimal animated WebP: VP8X(animation), ANIM, two ANMF frames, then metadata. */
export function animatedWebp(
  frameBitstream: Uint8Array,
  width: number,
  height: number,
): Uint8Array<ArrayBuffer> {
  const frame = (duration: number): Uint8Array<ArrayBuffer> =>
    riffChunk(
      'ANMF',
      cat(
        le24(0),
        le24(0),
        le24(width - 1),
        le24(height - 1),
        le24(duration),
        new Uint8Array([0]),
        frameBitstream,
      ),
    )
  return riffFile(
    [
      riffChunk('VP8X', vp8xPayload(0x02 | 0x08 | 0x04, width, height)),
      riffChunk('ANIM', new Uint8Array(6)),
      frame(100),
      frame(200),
      riffChunk('EXIF', buildTiff({ make: TEXT_SENTINELS.make, gps: true })),
      riffChunk('XMP ', ascii(TEXT_SENTINELS.xmp)),
    ],
    ascii(TEXT_SENTINELS.tail),
  )
}
