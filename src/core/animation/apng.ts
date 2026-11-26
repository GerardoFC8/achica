import { err, ok, type Result } from '../result'
import { createByteWriter } from './bytes'
import { crc32 } from './crc32'
import { changedRect, type Rect } from './diff'
import { quantizeAnimation, type QuantizeOptions } from './quantize'
import type { AnimationEncoding, EncodeError, Frame, IndexedAnimation } from './types'
import { validateFrames, validateIndexed } from './validate'

/**
 * APNG writer.
 *
 * Layout: signature, IHDR, acTL, PLTE and tRNS (indexed only), then for each
 * frame an fcTL followed by its pixels. The first frame's pixels are IDAT, so
 * a viewer that does not know APNG shows the first frame; later frames are
 * fdAT. fcTL and fdAT share one sequence counter that starts at 0.
 *
 * Two pixel modes, because every APNG frame shares one IHDR:
 * - indexed: colour type 3 with one palette for the whole animation. Bit
 *   depth shrinks with the palette (1, 2, 4 or 8) because fewer bits per
 *   pixel is fewer bytes before compression too.
 * - rgba: colour type 6, 8 bit, nothing is quantised and alpha is kept.
 *
 * Frame differencing writes only the rectangle that changed, with
 * blend_op SOURCE and dispose_op NONE. SOURCE replaces the rectangle outright
 * (transparent pixels included), so the composite is exactly the next frame
 * whatever the alpha is, with no case analysis. The cost is that unchanged
 * pixels inside the rectangle are rewritten instead of being left blank, so
 * differencing helps little when the change is spread over the frame (a
 * zoom changes every pixel) and a lot when it is local. Measured, not assumed.
 * Delays are written as given and browsers do not all honour short ones:
 * Firefox plays 10 ms as 100 ms, so callers should keep APNG delays at 20 ms
 * or more, as for GIF.
 *
 * Compression is the platform's CompressionStream('deflate'), which is zlib
 * format as PNG requires. It is asynchronous, which is why encoding is.
 * Delays are exact: delay_num milliseconds over delay_den 1000.
 */

export type ApngOptions = {
  readonly mode?: 'indexed' | 'rgba'
  /** Crop each frame to what changed. */
  readonly optimize?: boolean
  /**
   * Row filters. 'adaptive' tries the five PNG filters per row and keeps the
   * one with the smallest sum of absolute values; 'none' writes filter 0.
   * The default is 'adaptive' for rgba and 'none' for indexed: the heuristic
   * assumes pixel values that are numbers, and palette indices are labels, so
   * on indexed frames it picked worse rows (measured: 20 % larger files, which
   * is also what the PNG specification advises).
   */
  readonly filters?: 'adaptive' | 'none'
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const MAX_CHUNK_DATA = 1 << 16

type Chunk = { type: string; data: Uint8Array }

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

/** Applies a PNG filter to every row. `bpp` is bytes per pixel, at least 1. */
function filterRows(
  raw: Uint8Array,
  rowBytes: number,
  rows: number,
  bpp: number,
  adaptive: boolean,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array((rowBytes + 1) * rows)
  if (!adaptive) {
    for (let y = 0; y < rows; y += 1) {
      out.set(raw.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1)
    }
    return out
  }
  const zero = new Uint8Array(rowBytes)
  const candidates = [0, 1, 2, 3, 4].map(() => new Uint8Array(rowBytes))
  for (let y = 0; y < rows; y += 1) {
    const row = raw.subarray(y * rowBytes, (y + 1) * rowBytes)
    const up = y > 0 ? raw.subarray((y - 1) * rowBytes, y * rowBytes) : zero
    const scores = [0, 0, 0, 0, 0]
    for (let x = 0; x < rowBytes; x += 1) {
      const value = row[x] ?? 0
      const left = x >= bpp ? (row[x - bpp] ?? 0) : 0
      const above = up[x] ?? 0
      const upLeft = x >= bpp ? (up[x - bpp] ?? 0) : 0
      const filtered = [
        value,
        value - left,
        value - above,
        value - ((left + above) >> 1),
        value - paeth(left, above, upLeft),
      ]
      for (let f = 0; f < 5; f += 1) {
        const byte = (filtered[f] ?? 0) & 0xff
        const target = candidates[f]
        if (target !== undefined) target[x] = byte
        // Sum of absolute values, reading each byte as signed.
        scores[f] = (scores[f] ?? 0) + (byte < 128 ? byte : 256 - byte)
      }
    }
    let best = 0
    for (let f = 1; f < 5; f += 1) if ((scores[f] ?? 0) < (scores[best] ?? 0)) best = f
    const base = y * (rowBytes + 1)
    out[base] = best
    out.set(candidates[best] ?? zero, base + 1)
  }
  return out
}

async function deflate(data: Uint8Array<ArrayBuffer>): Promise<Result<Uint8Array, EncodeError>> {
  if (typeof CompressionStream === 'undefined') {
    return err({ code: 'compression-unavailable', detail: 'CompressionStream is not available' })
  }
  try {
    const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'))
    return ok(new Uint8Array(await new Response(stream).arrayBuffer()))
  } catch (error) {
    return err({
      code: 'compression-failed',
      detail: error instanceof Error ? error.message : 'deflate failed',
    })
  }
}

function bitDepthFor(colors: number): 1 | 2 | 4 | 8 {
  if (colors <= 2) return 1
  if (colors <= 4) return 2
  if (colors <= 16) return 4
  return 8
}

/** The rows of a rectangle of indices, packed at `depth` bits per pixel. */
function packIndices(
  indices: Uint8Array,
  stride: number,
  rect: Rect,
  depth: 1 | 2 | 4 | 8,
): { raw: Uint8Array; rowBytes: number } {
  const rowBytes = Math.ceil((rect.width * depth) / 8)
  const raw = new Uint8Array(rowBytes * rect.height)
  const perByte = 8 / depth
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      const value = indices[(rect.y + y) * stride + rect.x + x] ?? 0
      const shift = 8 - depth * ((x % perByte) + 1)
      const at = y * rowBytes + Math.floor(x / perByte)
      raw[at] = (raw[at] ?? 0) | (value << shift)
    }
  }
  return { raw, rowBytes }
}

function packRgba(
  data: Uint8ClampedArray,
  stride: number,
  rect: Rect,
): { raw: Uint8Array; rowBytes: number } {
  const rowBytes = rect.width * 4
  const raw = new Uint8Array(rowBytes * rect.height)
  for (let y = 0; y < rect.height; y += 1) {
    const from = ((rect.y + y) * stride + rect.x) * 4
    raw.set(data.subarray(from, from + rowBytes), y * rowBytes)
  }
  return { raw, rowBytes }
}

type Source = {
  width: number
  height: number
  delaysMs: readonly number[]
  count: number
  unit: number
  /** Pixel buffer of frame k, compared byte by byte. */
  buffer(k: number): ArrayLike<number> & Uint8Array
  pack(k: number, rect: Rect): { raw: Uint8Array; rowBytes: number }
  bpp: number
}

async function write(
  source: Source,
  header: { colorType: 3 | 6; depth: number },
  extra: Chunk[],
  options: ApngOptions,
): Promise<
  Result<
    { bytes: Uint8Array<ArrayBuffer>; empty: number; delays: number[]; adjusted: number },
    EncodeError
  >
> {
  const out = createByteWriter(1 << 16)
  const putChunk = (type: string, data: Uint8Array): void => {
    const body = new Uint8Array(4 + data.length)
    for (let i = 0; i < 4; i += 1) body[i] = type.charCodeAt(i)
    body.set(data, 4)
    out.u32be(data.length)
    out.bytes(body)
    out.u32be(crc32(body))
  }
  const u32 = (...values: number[]): Uint8Array => {
    const bytes = new Uint8Array(values.length * 4)
    const view = new DataView(bytes.buffer)
    values.forEach((value, i) => view.setUint32(i * 4, value))
    return bytes
  }

  out.bytes(SIGNATURE)
  const ihdr = new Uint8Array(13)
  ihdr.set(u32(source.width, source.height))
  ihdr[8] = header.depth
  ihdr[9] = header.colorType
  putChunk('IHDR', ihdr)
  putChunk('acTL', u32(source.count, 0)) // 0 plays: loop forever
  for (const chunk of extra) putChunk(chunk.type, chunk.data)

  const adaptive =
    (options.filters ?? (header.colorType === 3 ? 'none' : 'adaptive')) === 'adaptive'
  let sequence = 0
  let empty = 0
  let adjusted = 0
  const delays: number[] = []
  const full: Rect = { x: 0, y: 0, width: source.width, height: source.height }

  for (let k = 0; k < source.count; k += 1) {
    let rect: Rect = full
    if (options.optimize === true && k > 0) {
      const changed = changedRect(
        source.buffer(k - 1),
        source.buffer(k),
        source.width,
        source.height,
        source.unit,
      )
      if (changed === null) {
        // Nothing changed: still a frame, so the timing and the count survive.
        empty += 1
        rect = { x: 0, y: 0, width: 1, height: 1 }
      } else {
        rect = changed
      }
    }

    const requested = source.delaysMs[k] ?? 0
    const delay = Math.min(0xffff, Math.round(requested))
    if (delay !== requested) adjusted += 1
    delays.push(delay)

    const fctl = new Uint8Array(26)
    const view = new DataView(fctl.buffer)
    view.setUint32(0, sequence)
    view.setUint32(4, rect.width)
    view.setUint32(8, rect.height)
    view.setUint32(12, rect.x)
    view.setUint32(16, rect.y)
    view.setUint16(20, delay)
    view.setUint16(22, 1000)
    fctl[24] = 0 // dispose_op NONE
    fctl[25] = 0 // blend_op SOURCE
    sequence += 1
    putChunk('fcTL', fctl)

    const { raw, rowBytes } = source.pack(k, rect)
    const filtered = filterRows(raw, rowBytes, rect.height, source.bpp, adaptive)
    const compressed = await deflate(filtered)
    if (!compressed.ok) return compressed
    const stream = compressed.value
    for (let start = 0; start < stream.length; start += MAX_CHUNK_DATA) {
      const piece = stream.subarray(start, Math.min(stream.length, start + MAX_CHUNK_DATA))
      if (k === 0) {
        putChunk('IDAT', piece)
      } else {
        const data = new Uint8Array(4 + piece.length)
        new DataView(data.buffer).setUint32(0, sequence)
        data.set(piece, 4)
        sequence += 1
        putChunk('fdAT', data)
      }
    }
  }
  putChunk('IEND', new Uint8Array(0))
  return ok({ bytes: out.finish(), empty, delays, adjusted })
}

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0)

/** Writes an already quantised animation as indexed APNG. */
export async function encodeApngIndexed(
  animation: IndexedAnimation,
  options: Omit<ApngOptions, 'mode'> = {},
): Promise<Result<AnimationEncoding, EncodeError>> {
  const valid = validateIndexed(animation)
  if (!valid.ok) return valid
  const { width, height, palette, transparentIndex, frames } = animation
  const colors = palette.length / 3
  const depth = bitDepthFor(colors)

  const extra: Chunk[] = [{ type: 'PLTE', data: palette }]
  if (transparentIndex !== null) {
    // One alpha byte per entry up to the transparent one; later entries are opaque.
    const alpha = new Uint8Array(transparentIndex + 1).fill(255)
    alpha[transparentIndex] = 0
    extra.push({ type: 'tRNS', data: alpha })
  }

  const written = await write(
    {
      width,
      height,
      delaysMs: frames.map((frame) => frame.delayMs),
      count: frames.length,
      unit: 1,
      buffer: (k) => frames[k]?.indices ?? new Uint8Array(0),
      pack: (k, rect) => packIndices(frames[k]?.indices ?? new Uint8Array(0), width, rect, depth),
      bpp: 1,
    },
    { colorType: 3, depth },
    extra,
    options,
  )
  if (!written.ok) return written
  const usesTransparency =
    transparentIndex !== null && frames.some((frame) => frame.indices.includes(transparentIndex))
  const requested = sum(frames.map((frame) => frame.delayMs))
  return ok({
    format: 'apng',
    bytes: written.value.bytes,
    frameCount: frames.length,
    width,
    height,
    report: {
      paletteColors: colors - (transparentIndex !== null ? 1 : 0),
      exactPalette: null,
      transparent: usesTransparency,
      dithered: false,
      optimized: options.optimize === true,
      emptyFrames: written.value.empty,
      delaysAdjusted: written.value.adjusted,
      delaysRaisedToMinimum: 0,
      writtenDelaysMs: written.value.delays,
      requestedDurationMs: requested,
      writtenDurationMs: sum(written.value.delays),
    },
  })
}

/** Quantises (indexed mode) or not (rgba mode) and writes. */
export async function encodeApng(
  frames: readonly Frame[],
  options: ApngOptions & QuantizeOptions = {},
): Promise<Result<AnimationEncoding, EncodeError>> {
  if (options.mode === 'rgba') {
    const size = validateFrames(frames)
    if (!size.ok) return size
    const { width, height } = size.value
    const written = await write(
      {
        width,
        height,
        delaysMs: frames.map((frame) => frame.delayMs),
        count: frames.length,
        unit: 4,
        buffer: (k) => {
          const data = frames[k]?.data
          return data === undefined
            ? new Uint8Array(0)
            : new Uint8Array(data.buffer, data.byteOffset, data.length)
        },
        pack: (k, rect) => packRgba(frames[k]?.data ?? new Uint8ClampedArray(0), width, rect),
        bpp: 4,
      },
      { colorType: 6, depth: 8 },
      [],
      options,
    )
    if (!written.ok) return written
    return ok({
      format: 'apng',
      bytes: written.value.bytes,
      frameCount: frames.length,
      width,
      height,
      report: {
        paletteColors: null,
        exactPalette: null,
        transparent: frames.some((frame) => {
          for (let at = 3; at < frame.data.length; at += 4)
            if ((frame.data[at] ?? 255) < 255) return true
          return false
        }),
        dithered: false,
        optimized: options.optimize === true,
        emptyFrames: written.value.empty,
        delaysAdjusted: written.value.adjusted,
        delaysRaisedToMinimum: 0,
        writtenDelaysMs: written.value.delays,
        requestedDurationMs: sum(frames.map((frame) => frame.delayMs)),
        writtenDurationMs: sum(written.value.delays),
      },
    })
  }
  if (options.mode !== undefined && options.mode !== 'indexed') {
    return err({ code: 'bad-option', detail: 'mode must be "indexed" or "rgba"' })
  }
  const quantized = quantizeAnimation(frames, options)
  if (!quantized.ok) return quantized
  const encoded = await encodeApngIndexed(quantized.value.animation, options)
  if (!encoded.ok) return encoded
  const { report } = quantized.value
  return ok({
    ...encoded.value,
    report: {
      ...encoded.value.report,
      paletteColors: report.colors,
      exactPalette: report.exact,
      dithered: report.dithered,
    },
  })
}
