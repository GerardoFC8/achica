import type { Frame, IndexedAnimation } from '../../src/core/animation'

/**
 * Independent checkers for the animation writers: a strict GIF parser, a
 * reference LZW decoder, a strict APNG parser, and the compositing rules for
 * both. Nothing here imports from the writers' internals, so a bug shared by
 * writer and checker would need to be a bug in the format's own description.
 * Both parsers throw on the first violation, with a message saying which.
 */

// ---------------------------------------------------------------- synthetic

/** A deterministic pseudo-random generator, so tests are reproducible. */
export function rng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

export function solidFrame(
  width: number,
  height: number,
  rgba: readonly [number, number, number, number],
  delayMs = 100,
): Frame {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let at = 0; at < data.length; at += 4) data.set(rgba, at)
  return { data, width, height, delayMs }
}

export function setPixel(
  frame: Frame,
  x: number,
  y: number,
  rgba: readonly [number, number, number, number],
): void {
  frame.data.set(rgba, (y * frame.width + x) * 4)
}

export function cloneFrame(frame: Frame, delayMs = frame.delayMs): Frame {
  return { ...frame, data: new Uint8ClampedArray(frame.data), delayMs }
}

/** A moving square over a gradient, with an optionally transparent border. */
export function movingSquare(
  width: number,
  height: number,
  count: number,
  options: { transparentBorder?: boolean; delayMs?: number } = {},
): Frame[] {
  const frames: Frame[] = []
  for (let k = 0; k < count; k += 1) {
    const data = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const at = (y * width + x) * 4
        const border = x === 0 || y === 0 || x === width - 1 || y === height - 1
        const inside = x >= k % width && x < (k % width) + 3 && y >= 2 && y < 5
        if (options.transparentBorder === true && border) {
          data.set([0, 0, 0, 0], at)
        } else if (inside) {
          data.set([255, 40 * (k % 5), 0, 255], at)
        } else {
          data.set(
            [(x * 255) / Math.max(1, width - 1), (y * 255) / Math.max(1, height - 1), 90, 255],
            at,
          )
        }
      }
    }
    frames.push({ data, width, height, delayMs: options.delayMs ?? 100 })
  }
  return frames
}

/** Random noise with `colors` distinct opaque colours. */
export function noiseFrames(
  width: number,
  height: number,
  count: number,
  colors: number,
  seed = 1,
): Frame[] {
  const random = rng(seed)
  const table = Array.from({ length: colors }, (_, i) => [
    (i * 37) % 256,
    (i * 91 + 13) % 256,
    (i * 53 + 7) % 256,
  ])
  return Array.from({ length: count }, () => {
    const data = new Uint8ClampedArray(width * height * 4)
    for (let at = 0; at < data.length; at += 4) {
      const color = table[Math.floor(random() * colors)] ?? [0, 0, 0]
      data.set([color[0] ?? 0, color[1] ?? 0, color[2] ?? 0, 255], at)
    }
    return { data, width, height, delayMs: 50 }
  })
}

/** What each frame of an indexed animation looks like: palette index, or -1 for transparent. */
export function expectedScreens(animation: IndexedAnimation): Int16Array[] {
  return animation.frames.map((frame) =>
    Int16Array.from(frame.indices, (index) => (index === animation.transparentIndex ? -1 : index)),
  )
}

/** The RGBA a decoder must show for an indexed frame. Transparent pixels are [0,0,0,0]. */
export function expectedRgba(animation: IndexedAnimation): Uint8ClampedArray[] {
  return expectedScreens(animation).map((screen) => {
    const out = new Uint8ClampedArray(screen.length * 4)
    screen.forEach((index, p) => {
      if (index < 0) return
      out[p * 4] = animation.palette[index * 3] ?? 0
      out[p * 4 + 1] = animation.palette[index * 3 + 1] ?? 0
      out[p * 4 + 2] = animation.palette[index * 3 + 2] ?? 0
      out[p * 4 + 3] = 255
    })
    return out
  })
}

/** True when two RGBA buffers show the same picture: alpha equal, colour equal where visible. */
export function samePicture(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false
  for (let at = 0; at < a.length; at += 4) {
    if (a[at + 3] !== b[at + 3]) return false
    if (a[at + 3] === 0) continue
    if (a[at] !== b[at] || a[at + 1] !== b[at + 1] || a[at + 2] !== b[at + 2]) return false
  }
  return true
}

// -------------------------------------------------------------------- LZW

/** A plain GIF LZW decoder, written independently of the encoder. */
export function lzwDecode(stream: Uint8Array, minCodeSize: number, pixelCount: number): Uint8Array {
  if (minCodeSize < 2 || minCodeSize > 8) throw new Error(`bad minimum code size ${minCodeSize}`)
  const clear = 1 << minCodeSize
  const end = clear + 1
  const prefix = new Int32Array(4096)
  const suffix = new Uint8Array(4096)
  const lengths = new Uint16Array(4096)
  for (let i = 0; i < clear; i += 1) {
    suffix[i] = i
    lengths[i] = 1
  }
  const out = new Uint8Array(pixelCount)
  let written = 0
  let size = minCodeSize + 1
  let next = end + 1
  let previous = -1
  let bitPosition = 0

  const expand = (code: number): void => {
    const length = lengths[code] ?? 0
    let cursor = code
    for (let i = length - 1; i >= 0; i -= 1) {
      if (written + i < pixelCount) out[written + i] = suffix[cursor] ?? 0
      cursor = prefix[cursor] ?? 0
    }
    written += length
  }
  const firstOf = (code: number): number => {
    let cursor = code
    while ((lengths[cursor] ?? 0) > 1) cursor = prefix[cursor] ?? 0
    return suffix[cursor] ?? 0
  }

  for (;;) {
    if (bitPosition + size > stream.length * 8)
      throw new Error('LZW stream ends without an end code')
    let code = 0
    for (let b = 0; b < size; b += 1) {
      const bit = ((stream[(bitPosition + b) >> 3] ?? 0) >> ((bitPosition + b) & 7)) & 1
      code |= bit << b
    }
    bitPosition += size
    if (code === clear) {
      size = minCodeSize + 1
      next = end + 1
      previous = -1
      continue
    }
    if (code === end) {
      break
    }
    if (previous < 0) {
      if (code >= clear) throw new Error('first code after a clear is not a literal')
      expand(code)
      previous = code
      continue
    }
    if (code > next) throw new Error(`code ${code} is beyond the table (${next})`)
    let entry: number
    if (code < next) {
      entry = code
    } else {
      // The KwKwK case: the code being defined right now.
      entry = -1
    }
    if (next < 4096) {
      prefix[next] = previous
      suffix[next] = entry >= 0 ? firstOf(entry) : firstOf(previous)
      lengths[next] = (lengths[previous] ?? 0) + 1
      next += 1
    }
    expand(entry >= 0 ? entry : next - 1)
    previous = entry >= 0 ? entry : next - 1
    if (next === 1 << size && size < 12) size += 1
  }
  if (written !== pixelCount)
    throw new Error(`LZW produced ${written} pixels, expected ${pixelCount}`)
  // Bits after the end code are padding to the byte boundary and must be zero.
  for (let bit = bitPosition; bit < stream.length * 8; bit += 1) {
    if ((((stream[bit >> 3] ?? 0) >> (bit & 7)) & 1) !== 0)
      throw new Error('nonzero padding after the end code')
  }
  if (Math.ceil(bitPosition / 8) !== stream.length) throw new Error('bytes after the end code')
  return out
}

// -------------------------------------------------------------------- GIF

export type ParsedGifFrame = {
  x: number
  y: number
  width: number
  height: number
  disposal: number
  transparentIndex: number | null
  delayCs: number
  indices: Uint8Array
  hasLocalTable: boolean
}

export type ParsedGif = {
  width: number
  height: number
  tableSize: number
  palette: Uint8Array
  loops: number | null
  frames: ParsedGifFrame[]
}

export function parseGif(bytes: Uint8Array): ParsedGif {
  let at = 0
  const need = (count: number, what: string): void => {
    if (at + count > bytes.length) throw new Error(`GIF cut off in ${what} at byte ${at}`)
  }
  const u8 = (what: string): number => {
    need(1, what)
    return bytes[at++] ?? 0
  }
  const u16 = (what: string): number => u8(what) | (u8(what) << 8)
  const text = (count: number): string => {
    need(count, 'text')
    let s = ''
    for (let i = 0; i < count; i += 1) s += String.fromCharCode(bytes[at++] ?? 0)
    return s
  }

  if (text(6) !== 'GIF89a') throw new Error('not a GIF89a')
  const width = u16('width')
  const height = u16('height')
  const packed = u8('packed')
  u8('background')
  u8('aspect')
  if ((packed & 0x80) === 0) throw new Error('no global colour table')
  if (((packed >> 4) & 7) !== 7) throw new Error('colour resolution is not 8 bits')
  if ((packed & 0x08) !== 0) throw new Error('sorted flag is set')
  const tableSize = 2 << (packed & 7)
  need(tableSize * 3, 'global colour table')
  const palette = bytes.slice(at, at + tableSize * 3)
  at += tableSize * 3

  const result: ParsedGif = { width, height, tableSize, palette, loops: null, frames: [] }
  let control: { disposal: number; transparent: number | null; delay: number } | null = null

  const readSubBlocks = (): Uint8Array => {
    const parts: number[] = []
    for (;;) {
      const size = u8('sub-block length')
      if (size === 0) return Uint8Array.from(parts)
      need(size, 'sub-block')
      for (let i = 0; i < size; i += 1) parts.push(bytes[at++] ?? 0)
    }
  }

  for (;;) {
    const introducer = u8('block introducer')
    if (introducer === 0x3b) break
    if (introducer === 0x21) {
      const label = u8('extension label')
      if (label === 0xf9) {
        if (u8('GCE size') !== 4) throw new Error('graphic control block is not 4 bytes')
        const flags = u8('GCE flags')
        if ((flags & 0xe0) !== 0) throw new Error('reserved bits set in the graphic control block')
        const delay = u16('GCE delay')
        const index = u8('GCE transparent index')
        if (u8('GCE terminator') !== 0) throw new Error('graphic control block not terminated')
        if (control !== null) throw new Error('two graphic control blocks in a row')
        control = {
          disposal: (flags >> 2) & 7,
          transparent: (flags & 1) !== 0 ? index : null,
          delay,
        }
      } else if (label === 0xff) {
        const size = u8('application size')
        const id = text(size)
        const data = readSubBlocks()
        if (id === 'NETSCAPE2.0') {
          if (data[0] !== 1 || data.length !== 3) throw new Error('malformed NETSCAPE loop block')
          result.loops = (data[1] ?? 0) | ((data[2] ?? 0) << 8)
        }
      } else {
        readSubBlocks()
      }
      continue
    }
    if (introducer !== 0x2c)
      throw new Error(`unknown block 0x${introducer.toString(16)} at ${at - 1}`)
    const x = u16('x')
    const y = u16('y')
    const w = u16('w')
    const h = u16('h')
    const flags = u8('image flags')
    if ((flags & 0x80) !== 0) throw new Error('local colour tables are not expected here')
    if ((flags & 0x40) !== 0) throw new Error('interlaced')
    if (x + w > width || y + h > height) throw new Error('frame exceeds the screen')
    if (w < 1 || h < 1) throw new Error('empty frame')
    const minCodeSize = u8('min code size')
    const stream = readSubBlocks()
    // Sub-blocks must be full (255) except the last one.
    const indices = lzwDecode(stream, minCodeSize, w * h)
    const limit = 1 << minCodeSize
    if (minCodeSize < Math.max(2, Math.log2(tableSize)))
      throw new Error('min code size too small for the table')
    for (const value of indices) {
      if (value >= tableSize || value >= limit) throw new Error('pixel index outside the table')
    }
    result.frames.push({
      x,
      y,
      width: w,
      height: h,
      disposal: control?.disposal ?? 0,
      transparentIndex: control?.transparent ?? null,
      delayCs: control?.delay ?? 0,
      indices,
      hasLocalTable: false,
    })
    control = null
  }
  if (at !== bytes.length) throw new Error('bytes after the trailer')
  if ((tableSize & (tableSize - 1)) !== 0) throw new Error('table is not a power of two')
  return result
}

/** Composes the frames the way the GIF spec says, giving the screen after each one is drawn. -1 is transparent. */
export function compositeGif(gif: ParsedGif): Int16Array[] {
  const { width, height } = gif
  let screen = new Int16Array(width * height).fill(-1)
  const shown: Int16Array[] = []
  for (const frame of gif.frames) {
    const before = Int16Array.from(screen)
    for (let y = 0; y < frame.height; y += 1) {
      for (let x = 0; x < frame.width; x += 1) {
        const value = frame.indices[y * frame.width + x] ?? 0
        if (value === frame.transparentIndex) continue
        screen[(frame.y + y) * width + frame.x + x] = value
      }
    }
    shown.push(Int16Array.from(screen))
    if (frame.disposal === 2) {
      for (let y = 0; y < frame.height; y += 1) {
        for (let x = 0; x < frame.width; x += 1) screen[(frame.y + y) * width + frame.x + x] = -1
      }
    } else if (frame.disposal === 3) {
      screen = before
    }
  }
  return shown
}

// ------------------------------------------------------------------- APNG

export type ParsedApngFrame = {
  sequence: number
  x: number
  y: number
  width: number
  height: number
  delayNum: number
  delayDen: number
  dispose: number
  blend: number
  /** Raw (unfiltered) pixel bytes of the frame region, one byte per sample after unpacking. */
  samples: Uint8Array
}

export type ParsedApng = {
  width: number
  height: number
  depth: number
  colorType: number
  palette: Uint8Array | null
  transparency: Uint8Array | null
  frameCount: number
  plays: number
  frames: ParsedApngFrame[]
  chunkTypes: string[]
  filtersUsed: Set<number>
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export function referenceCrc(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let k = 0; k < 8; k += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

async function inflate(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

const paethRef = (a: number, b: number, c: number): number => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

export async function parseApng(bytes: Uint8Array): Promise<ParsedApng> {
  if (PNG_SIGNATURE.some((value, i) => bytes[i] !== value)) throw new Error('bad PNG signature')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = 8
  const chunkTypes: string[] = []
  type Raw = { type: string; data: Uint8Array }
  const chunks: Raw[] = []
  let ended = false
  while (at < bytes.length) {
    if (ended) throw new Error('bytes after IEND')
    if (at + 12 > bytes.length) throw new Error('chunk header cut off')
    const length = view.getUint32(at)
    if (length > 0x7fffffff) throw new Error('chunk length too large')
    if (at + 12 + length > bytes.length) throw new Error('chunk longer than the file')
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    if (!/^[A-Za-z]{4}$/.test(type)) throw new Error('chunk type is not four letters')
    const body = bytes.subarray(at + 4, at + 8 + length)
    if (view.getUint32(at + 8 + length) !== referenceCrc(body))
      throw new Error(`bad CRC in ${type}`)
    chunks.push({ type, data: bytes.subarray(at + 8, at + 8 + length) })
    chunkTypes.push(type)
    if (type === 'IEND') ended = true
    at += 12 + length
  }
  if (!ended) throw new Error('no IEND')
  if (chunks[0]?.type !== 'IHDR') throw new Error('first chunk is not IHDR')
  const ihdr = chunks[0].data
  if (ihdr.length !== 13) throw new Error('IHDR is not 13 bytes')
  const ihdrView = new DataView(ihdr.buffer, ihdr.byteOffset, 13)
  const width = ihdrView.getUint32(0)
  const height = ihdrView.getUint32(4)
  const depth = ihdr[8] ?? 0
  const colorType = ihdr[9] ?? 0
  if (ihdr[10] !== 0 || ihdr[11] !== 0 || ihdr[12] !== 0)
    throw new Error('IHDR method/filter/interlace')
  if (colorType === 3 && ![1, 2, 4, 8].includes(depth)) throw new Error('bad indexed depth')
  if (colorType === 6 && depth !== 8) throw new Error('bad RGBA depth')

  const firstOf = (type: string): number => chunkTypes.indexOf(type)
  const actl = chunks[firstOf('acTL')]
  if (actl === undefined || actl.data.length !== 8) throw new Error('missing or malformed acTL')
  if (chunkTypes.filter((t) => t === 'acTL').length !== 1) throw new Error('more than one acTL')
  const frameCount = new DataView(actl.data.buffer, actl.data.byteOffset, 8).getUint32(0)
  const plays = new DataView(actl.data.buffer, actl.data.byteOffset, 8).getUint32(4)
  const firstIdat = firstOf('IDAT')
  if (firstIdat < 0) throw new Error('no IDAT')
  if (firstOf('acTL') > firstIdat) throw new Error('acTL after IDAT')
  let palette: Uint8Array | null = null
  let transparency: Uint8Array | null = null
  if (colorType === 3) {
    const plte = chunks[firstOf('PLTE')]
    if (plte === undefined || firstOf('PLTE') > firstIdat)
      throw new Error('PLTE missing or after IDAT')
    if (plte.data.length % 3 !== 0 || plte.data.length === 0 || plte.data.length > 768)
      throw new Error('bad PLTE length')
    if (plte.data.length / 3 > 1 << depth) throw new Error('PLTE larger than the bit depth allows')
    palette = plte.data
    const trns = firstOf('tRNS')
    if (trns >= 0) {
      if (trns < firstOf('PLTE') || trns > firstIdat) throw new Error('tRNS out of order')
      transparency = chunks[trns]?.data ?? null
      if (transparency !== null && transparency.length > palette.length / 3)
        throw new Error('tRNS longer than PLTE')
    }
  } else if (firstOf('PLTE') >= 0 || firstOf('tRNS') >= 0) {
    throw new Error('PLTE/tRNS in an RGBA image')
  }
  if (chunkTypes[chunkTypes.length - 1] !== 'IEND') throw new Error('IEND is not last')

  // Walk the animation chunks in order, checking the sequence numbers.
  let sequence = 0
  type Pending = { fctl: Uint8Array; data: Uint8Array[]; viaIdat: boolean }
  const pending: Pending[] = []
  let sawIdatForFrame0 = false
  for (const chunk of chunks) {
    if (chunk.type === 'fcTL') {
      if (chunk.data.length !== 26) throw new Error('fcTL is not 26 bytes')
      const n = new DataView(chunk.data.buffer, chunk.data.byteOffset, 4).getUint32(0)
      if (n !== sequence) throw new Error(`fcTL sequence ${n}, expected ${sequence}`)
      sequence += 1
      pending.push({ fctl: chunk.data, data: [], viaIdat: pending.length === 0 })
    } else if (chunk.type === 'IDAT') {
      const frame0 = pending[0]
      if (frame0 === undefined)
        throw new Error('IDAT before the first fcTL (default image is not frame 0)')
      if (pending.length !== 1) throw new Error('IDAT after a later fcTL')
      frame0.data.push(chunk.data)
      sawIdatForFrame0 = true
    } else if (chunk.type === 'fdAT') {
      const last = pending[pending.length - 1]
      if (last === undefined || last.viaIdat) throw new Error('fdAT without its fcTL')
      const n = new DataView(chunk.data.buffer, chunk.data.byteOffset, 4).getUint32(0)
      if (n !== sequence) throw new Error(`fdAT sequence ${n}, expected ${sequence}`)
      sequence += 1
      last.data.push(chunk.data.subarray(4))
    }
  }
  if (!sawIdatForFrame0) throw new Error('no image data for frame 0')
  if (pending.length !== frameCount)
    throw new Error(`acTL says ${frameCount} frames, found ${pending.length}`)

  const bitsPerPixel = colorType === 3 ? depth : 32
  const bpp = Math.max(1, bitsPerPixel >> 3)
  const filtersUsed = new Set<number>()
  const frames: ParsedApngFrame[] = []
  for (const entry of pending) {
    const f = new DataView(entry.fctl.buffer, entry.fctl.byteOffset, 26)
    const frame = {
      sequence: f.getUint32(0),
      width: f.getUint32(4),
      height: f.getUint32(8),
      x: f.getUint32(12),
      y: f.getUint32(16),
      delayNum: f.getUint16(20),
      delayDen: f.getUint16(22),
      dispose: entry.fctl[24] ?? 0,
      blend: entry.fctl[25] ?? 0,
    }
    if (frame.width < 1 || frame.height < 1) throw new Error('empty frame')
    if (frame.x + frame.width > width || frame.y + frame.height > height)
      throw new Error('frame exceeds the canvas')
    if (
      frames.length === 0 &&
      (frame.x !== 0 || frame.y !== 0 || frame.width !== width || frame.height !== height)
    ) {
      throw new Error('the first frame does not cover the canvas')
    }
    if (frame.dispose > 2 || frame.blend > 1) throw new Error('bad dispose or blend op')
    const total = entry.data.reduce((sum, part) => sum + part.length, 0)
    const joined = new Uint8Array(total)
    let offset = 0
    for (const part of entry.data) {
      joined.set(part, offset)
      offset += part.length
    }
    const raw = await inflate(joined)
    const rowBytes = Math.ceil((frame.width * bitsPerPixel) / 8)
    if (raw.length !== (rowBytes + 1) * frame.height) {
      throw new Error(`inflated ${raw.length} bytes, expected ${(rowBytes + 1) * frame.height}`)
    }
    const rows = new Uint8Array(rowBytes * frame.height)
    for (let y = 0; y < frame.height; y += 1) {
      const filter = raw[y * (rowBytes + 1)] ?? 0
      if (filter > 4) throw new Error(`bad filter type ${filter}`)
      filtersUsed.add(filter)
      for (let x = 0; x < rowBytes; x += 1) {
        const value = raw[y * (rowBytes + 1) + 1 + x] ?? 0
        const left = x >= bpp ? (rows[y * rowBytes + x - bpp] ?? 0) : 0
        const up = y > 0 ? (rows[(y - 1) * rowBytes + x] ?? 0) : 0
        const upLeft = x >= bpp && y > 0 ? (rows[(y - 1) * rowBytes + x - bpp] ?? 0) : 0
        const predictor = [0, left, up, (left + up) >> 1, paethRef(left, up, upLeft)][filter] ?? 0
        rows[y * rowBytes + x] = (value + predictor) & 0xff
      }
    }
    let samples: Uint8Array
    if (colorType === 3 && depth < 8) {
      samples = new Uint8Array(frame.width * frame.height)
      const perByte = 8 / depth
      for (let y = 0; y < frame.height; y += 1) {
        for (let x = 0; x < frame.width; x += 1) {
          const byte = rows[y * rowBytes + Math.floor(x / perByte)] ?? 0
          const shift = 8 - depth * ((x % perByte) + 1)
          samples[y * frame.width + x] = (byte >> shift) & ((1 << depth) - 1)
        }
      }
    } else {
      samples = rows
    }
    frames.push({ ...frame, samples })
  }
  return {
    width,
    height,
    depth,
    colorType,
    palette,
    transparency,
    frameCount,
    plays,
    frames,
    chunkTypes,
    filtersUsed,
  }
}

/** The RGBA screen after each frame, applying dispose and blend as the APNG spec says. */
export function compositeApng(apng: ParsedApng): Uint8ClampedArray[] {
  const { width, height } = apng
  let canvas = new Uint8ClampedArray(width * height * 4)
  const shown: Uint8ClampedArray[] = []
  for (const frame of apng.frames) {
    const before = new Uint8ClampedArray(canvas)
    for (let y = 0; y < frame.height; y += 1) {
      for (let x = 0; x < frame.width; x += 1) {
        const source = y * frame.width + x
        let rgba: number[]
        if (apng.colorType === 3) {
          const index = frame.samples[source] ?? 0
          const alpha = apng.transparency?.[index] ?? 255
          rgba = [
            apng.palette?.[index * 3] ?? 0,
            apng.palette?.[index * 3 + 1] ?? 0,
            apng.palette?.[index * 3 + 2] ?? 0,
            alpha,
          ]
        } else {
          rgba = [
            frame.samples[source * 4] ?? 0,
            frame.samples[source * 4 + 1] ?? 0,
            frame.samples[source * 4 + 2] ?? 0,
            frame.samples[source * 4 + 3] ?? 0,
          ]
        }
        const target = ((frame.y + y) * width + frame.x + x) * 4
        if (frame.blend === 0) {
          canvas.set(rgba, target)
        } else {
          const alpha = rgba[3] ?? 0
          if (alpha === 255) canvas.set(rgba, target)
          else if (alpha > 0) {
            const back = canvas[target + 3] ?? 0
            const outAlpha = alpha + (back * (255 - alpha)) / 255
            for (let c = 0; c < 3; c += 1) {
              canvas[target + c] =
                ((rgba[c] ?? 0) * alpha +
                  ((canvas[target + c] ?? 0) * back * (255 - alpha)) / 255) /
                outAlpha
            }
            canvas[target + 3] = outAlpha
          }
        }
      }
    }
    shown.push(new Uint8ClampedArray(canvas))
    if (frame.dispose === 1) {
      for (let y = 0; y < frame.height; y += 1) {
        canvas.fill(
          0,
          ((frame.y + y) * width + frame.x) * 4,
          ((frame.y + y) * width + frame.x + frame.width) * 4,
        )
      }
    } else if (frame.dispose === 2) {
      canvas = before
    }
  }
  return shown
}

// ---------------------------------------------------------------- scenarios

/** The animations every browser check runs on: [name, frames, maxColors]. */
export function animationScenarios(): Array<[string, Frame[], number]> {
  const still = movingSquare(9, 7, 1)
  const first = still[0] as Frame
  const onePixel = [cloneFrame(first), cloneFrame(first), cloneFrame(first)]
  setPixel(onePixel[1] as Frame, 4, 3, [1, 2, 3, 255])
  setPixel(onePixel[2] as Frame, 4, 3, [1, 2, 3, 255])
  setPixel(onePixel[2] as Frame, 0, 0, [9, 9, 9, 255])
  // Opaque becomes transparent and back: the case that needs disposal 2.
  const blink = [
    solidFrame(5, 5, [200, 0, 0, 255]),
    solidFrame(5, 5, [200, 0, 0, 255]),
    solidFrame(5, 5, [200, 0, 0, 255]),
    solidFrame(5, 5, [200, 0, 0, 255]),
  ]
  setPixel(blink[1] as Frame, 2, 2, [0, 0, 0, 0])
  setPixel(blink[2] as Frame, 0, 0, [0, 0, 0, 0])
  setPixel(blink[2] as Frame, 2, 2, [0, 200, 0, 255])
  return [
    ['moving square', movingSquare(16, 12, 12), 256],
    ['transparent border', movingSquare(16, 12, 6, { transparentBorder: true }), 256],
    ['blinking transparency', blink, 256],
    ['identical frames', [cloneFrame(first), cloneFrame(first), cloneFrame(first)], 256],
    ['a single changed pixel', onePixel, 256],
    ['1x1', [solidFrame(1, 1, [5, 6, 7, 255]), solidFrame(1, 1, [7, 6, 5, 255])], 256],
    ['odd size', movingSquare(13, 5, 4), 256],
    ['one frame', still, 256],
    ['two colours', noiseFrames(10, 10, 4, 2), 2],
    ['256 colours', noiseFrames(60, 60, 3, 256), 256],
    ['noise merged to 8 colours', noiseFrames(20, 20, 3, 200), 8],
  ]
}
