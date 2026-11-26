import { err, ok, type Result } from '../result'
import type { EncodeError, Frame, IndexedAnimation } from './types'
import { validateFrames, validateMaxColors } from './validate'

/**
 * One global palette for a whole animation, by median cut.
 *
 * Decisions that are not obvious:
 *
 * - Alpha is binary. A pixel with alpha below ALPHA_THRESHOLD (128) is
 *   transparent and every other pixel is opaque. GIF cannot express more, and
 *   in APNG indexed mode a single tRNS entry keeps all frames on one palette.
 *   The RGBA APNG mode is the one that preserves partial alpha.
 * - The transparent entry, when there is one, is index 0, so a PNG tRNS chunk
 *   is a single byte. It counts against `maxColors`.
 * - The palette is built from a deterministic hash-based sample of the pixels
 *   (at most SAMPLE_CAP), not from every pixel: a 300-frame animation would
 *   otherwise build a histogram of millions of entries. Small inputs are not
 *   sampled at all, so their palette is exact when it fits.
 * - Median cut splits the box with the largest weighted squared error, along
 *   its widest channel, at the weighted median. Plain and deterministic; it
 *   is not the best quantiser that exists, and it does not need to be, since
 *   the byte budget is met by lowering colours, frames and size.
 * - Dithering (Floyd-Steinberg, left to right) is optional because it costs
 *   bytes: noise does not compress, and it defeats frame differencing.
 */

export const ALPHA_THRESHOLD = 128

const SAMPLE_CAP = 1 << 19
const CACHE_BITS = 16

export type QuantizeOptions = {
  /** 2 to 256, the transparent entry included. Default 256. */
  readonly maxColors?: number
  readonly dither?: boolean
  /** Keep an index free for transparency even if no pixel needs it (frame differencing needs one). */
  readonly reserveTransparent?: boolean
}

export type QuantizeReport = {
  /** Palette colours, the transparent entry not counted. */
  readonly colors: number
  /** True when every distinct sampled colour got its own entry. */
  readonly exact: boolean
  readonly transparent: boolean
  readonly dithered: boolean
}

export type Quantized = { readonly animation: IndexedAnimation; readonly report: QuantizeReport }

type Entries = {
  readonly r: Uint8Array
  readonly g: Uint8Array
  readonly b: Uint8Array
  readonly weight: Float64Array
  readonly count: number
}

function collectEntries(frames: readonly Frame[], width: number, height: number): Entries {
  const pixels = width * height
  const total = pixels * frames.length
  const step = Math.max(1, Math.ceil(total / SAMPLE_CAP))
  const counts = new Map<number, number>()
  let global = 0
  for (const frame of frames) {
    const data = frame.data
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      const index = global + pixel
      // Hash sampling, so a stride cannot line up with the image width.
      if (step > 1 && ((Math.imul(index, 2654435761) >>> 0) >>> 3) % step !== 0) continue
      const at = pixel * 4
      if ((data[at + 3] ?? 0) < ALPHA_THRESHOLD) continue
      const key = ((data[at] ?? 0) << 16) | ((data[at + 1] ?? 0) << 8) | (data[at + 2] ?? 0)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    global += pixels
  }
  const count = counts.size
  const r = new Uint8Array(count)
  const g = new Uint8Array(count)
  const b = new Uint8Array(count)
  const weight = new Float64Array(count)
  let at = 0
  for (const [key, n] of counts) {
    r[at] = key >>> 16
    g[at] = (key >>> 8) & 0xff
    b[at] = key & 0xff
    weight[at] = n
    at += 1
  }
  return { r, g, b, weight, count }
}

type Box = { start: number; end: number; error: number }

function medianCut(entries: Entries, budget: number): Uint8Array {
  const { r, g, b, weight, count } = entries
  const channels = [r, g, b]
  const order = new Uint32Array(count)
  for (let i = 0; i < count; i += 1) order[i] = i

  const measure = (start: number, end: number): number => {
    let total = 0
    let sr = 0
    let sg = 0
    let sb = 0
    for (let i = start; i < end; i += 1) {
      const e = order[i] ?? 0
      const w = weight[e] ?? 0
      total += w
      sr += w * (r[e] ?? 0)
      sg += w * (g[e] ?? 0)
      sb += w * (b[e] ?? 0)
    }
    if (total === 0) return 0
    const mr = sr / total
    const mg = sg / total
    const mb = sb / total
    let error = 0
    for (let i = start; i < end; i += 1) {
      const e = order[i] ?? 0
      const w = weight[e] ?? 0
      error += w * ((mr - (r[e] ?? 0)) ** 2 + (mg - (g[e] ?? 0)) ** 2 + (mb - (b[e] ?? 0)) ** 2)
    }
    return error
  }

  const boxes: Box[] = [{ start: 0, end: count, error: measure(0, count) }]
  while (boxes.length < budget) {
    let pick = -1
    let best = 0
    for (let i = 0; i < boxes.length; i += 1) {
      const box = boxes[i]
      if (box === undefined || box.end - box.start < 2) continue
      if (pick < 0 || box.error > best) {
        pick = i
        best = box.error
      }
    }
    const box = boxes[pick]
    if (box === undefined) break

    // Widest channel of this box.
    let channel = 0
    let widest = -1
    for (let c = 0; c < 3; c += 1) {
      const values = channels[c]
      let low = 255
      let high = 0
      for (let i = box.start; i < box.end; i += 1) {
        const v = values?.[order[i] ?? 0] ?? 0
        if (v < low) low = v
        if (v > high) high = v
      }
      if (high - low > widest) {
        widest = high - low
        channel = c
      }
    }
    const values = channels[channel] ?? r
    const second = channels[(channel + 1) % 3] ?? g
    const third = channels[(channel + 2) % 3] ?? b
    order.subarray(box.start, box.end).sort((a, c) => {
      return (
        (values[a] ?? 0) - (values[c] ?? 0) ||
        (second[a] ?? 0) - (second[c] ?? 0) ||
        (third[a] ?? 0) - (third[c] ?? 0)
      )
    })

    // Split where the two halves have the least squared error left, which is
    // the weighted median when the box is balanced and isolates a small,
    // distant cluster when it is not (a plain median would bury it).
    const n = box.end - box.start
    const w = new Float64Array(n + 1)
    const sums = [new Float64Array(n + 1), new Float64Array(n + 1), new Float64Array(n + 1)]
    const squares = [new Float64Array(n + 1), new Float64Array(n + 1), new Float64Array(n + 1)]
    for (let i = 0; i < n; i += 1) {
      const e = order[box.start + i] ?? 0
      const weightOf = weight[e] ?? 0
      w[i + 1] = (w[i] ?? 0) + weightOf
      for (let c = 0; c < 3; c += 1) {
        const v = channels[c]?.[e] ?? 0
        const sum = sums[c]
        const square = squares[c]
        if (sum !== undefined) sum[i + 1] = (sum[i] ?? 0) + weightOf * v
        if (square !== undefined) square[i + 1] = (square[i] ?? 0) + weightOf * v * v
      }
    }
    const spread = (from: number, to: number): number => {
      const mass = (w[to] ?? 0) - (w[from] ?? 0)
      if (mass === 0) return 0
      let error = 0
      for (let c = 0; c < 3; c += 1) {
        const sum = (sums[c]?.[to] ?? 0) - (sums[c]?.[from] ?? 0)
        error += (squares[c]?.[to] ?? 0) - (squares[c]?.[from] ?? 0) - (sum * sum) / mass
      }
      return error
    }
    let cut = 1
    let least = Infinity
    for (let i = 1; i < n; i += 1) {
      const total = spread(0, i) + spread(i, n)
      if (total < least) {
        least = total
        cut = i
      }
    }
    const split = box.start + cut
    const left: Box = { start: box.start, end: split, error: measure(box.start, split) }
    const right: Box = { start: split, end: box.end, error: measure(split, box.end) }
    boxes[pick] = left
    boxes.push(right)
  }

  const palette = new Uint8Array(boxes.length * 3)
  boxes.forEach((box, index) => {
    let total = 0
    let sr = 0
    let sg = 0
    let sb = 0
    for (let i = box.start; i < box.end; i += 1) {
      const e = order[i] ?? 0
      const w = weight[e] ?? 0
      total += w
      sr += w * (r[e] ?? 0)
      sg += w * (g[e] ?? 0)
      sb += w * (b[e] ?? 0)
    }
    palette[index * 3] = Math.round(sr / total)
    palette[index * 3 + 1] = Math.round(sg / total)
    palette[index * 3 + 2] = Math.round(sb / total)
  })
  return palette
}

/** Nearest-palette lookup with a small direct-mapped cache of exact colours. */
function createMatcher(
  palette: Uint8Array,
  first: number,
): (r: number, g: number, b: number) => number {
  const size = palette.length / 3
  const pr = new Int32Array(size)
  const pg = new Int32Array(size)
  const pb = new Int32Array(size)
  for (let i = 0; i < size; i += 1) {
    pr[i] = palette[i * 3] ?? 0
    pg[i] = palette[i * 3 + 1] ?? 0
    pb[i] = palette[i * 3 + 2] ?? 0
  }
  const slots = 1 << CACHE_BITS
  const keys = new Int32Array(slots).fill(-1)
  const values = new Uint8Array(slots)
  return (r, g, b) => {
    const key = (r << 16) | (g << 8) | b
    const slot = Math.imul(key, 2654435761) >>> (32 - CACHE_BITS)
    if (keys[slot] === key) return values[slot] ?? first
    let best = first
    let bestDistance = Infinity
    for (let i = first; i < size; i += 1) {
      const dr = r - (pr[i] ?? 0)
      const dg = g - (pg[i] ?? 0)
      const db = b - (pb[i] ?? 0)
      const distance = dr * dr + dg * dg + db * db
      if (distance < bestDistance) {
        bestDistance = distance
        best = i
        if (distance === 0) break
      }
    }
    keys[slot] = key
    values[slot] = best
    return best
  }
}

export function quantizeAnimation(
  frames: readonly Frame[],
  options: QuantizeOptions = {},
): Result<Quantized, EncodeError> {
  const size = validateFrames(frames)
  if (!size.ok) return size
  const maxColors = validateMaxColors(options.maxColors)
  if (!maxColors.ok) return maxColors
  const { width, height } = size.value
  const pixels = width * height

  let needsTransparent = options.reserveTransparent === true
  for (const frame of frames) {
    if (needsTransparent) break
    for (let at = 3; at < frame.data.length; at += 4) {
      if ((frame.data[at] ?? 255) < ALPHA_THRESHOLD) {
        needsTransparent = true
        break
      }
    }
  }
  const first = needsTransparent ? 1 : 0
  const budget = maxColors.value - first

  const entries = collectEntries(frames, width, height)
  const exact = entries.count <= budget
  let colors: Uint8Array
  if (entries.count === 0) {
    colors = new Uint8Array(needsTransparent ? 0 : 3)
  } else if (exact) {
    colors = new Uint8Array(entries.count * 3)
    for (let i = 0; i < entries.count; i += 1) {
      colors[i * 3] = entries.r[i] ?? 0
      colors[i * 3 + 1] = entries.g[i] ?? 0
      colors[i * 3 + 2] = entries.b[i] ?? 0
    }
  } else {
    colors = medianCut(entries, budget)
  }

  const palette = new Uint8Array(first * 3 + colors.length)
  palette.set(colors, first * 3)
  const paletteSize = palette.length / 3
  const match = createMatcher(palette, first)
  const dither = options.dither === true
  const transparentIndex = needsTransparent ? 0 : null

  const indexed = frames.map((frame) => {
    const indices = new Uint8Array(pixels)
    const data = frame.data
    if (!dither || paletteSize - first < 2) {
      for (let pixel = 0; pixel < pixels; pixel += 1) {
        const at = pixel * 4
        if ((data[at + 3] ?? 0) < ALPHA_THRESHOLD) {
          indices[pixel] = 0
        } else {
          indices[pixel] = match(data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0)
        }
      }
      return { indices, delayMs: frame.delayMs }
    }

    // Floyd-Steinberg. Error rows carry three channels with one pixel of
    // padding on each side so the diffusion needs no bounds checks.
    const stride = (width + 2) * 3
    let current = new Float32Array(stride)
    let next = new Float32Array(stride)
    for (let y = 0; y < height; y += 1) {
      next.fill(0)
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x
        const at = pixel * 4
        if ((data[at + 3] ?? 0) < ALPHA_THRESHOLD) {
          indices[pixel] = 0
          continue
        }
        const e = (x + 1) * 3
        const r = Math.min(255, Math.max(0, Math.round((data[at] ?? 0) + (current[e] ?? 0))))
        const g = Math.min(
          255,
          Math.max(0, Math.round((data[at + 1] ?? 0) + (current[e + 1] ?? 0))),
        )
        const b = Math.min(
          255,
          Math.max(0, Math.round((data[at + 2] ?? 0) + (current[e + 2] ?? 0))),
        )
        const chosen = match(r, g, b)
        indices[pixel] = chosen
        const errors = [
          r - (palette[chosen * 3] ?? 0),
          g - (palette[chosen * 3 + 1] ?? 0),
          b - (palette[chosen * 3 + 2] ?? 0),
        ]
        for (let c = 0; c < 3; c += 1) {
          const error = errors[c] ?? 0
          current[e + 3 + c] = (current[e + 3 + c] ?? 0) + (error * 7) / 16
          next[e - 3 + c] = (next[e - 3 + c] ?? 0) + (error * 3) / 16
          next[e + c] = (next[e + c] ?? 0) + (error * 5) / 16
          next[e + 3 + c] = (next[e + 3 + c] ?? 0) + error / 16
        }
      }
      const swap = current
      current = next
      next = swap
    }
    return { indices, delayMs: frame.delayMs }
  })

  // An index is only "transparent" if a pixel uses it or the caller asked to
  // reserve it; both were folded into needsTransparent above.
  if (paletteSize < 1) return err({ code: 'bad-option', detail: 'the palette came out empty' })

  return ok({
    animation: { width, height, palette, transparentIndex, frames: indexed },
    report: {
      colors: paletteSize - first,
      exact,
      transparent: needsTransparent,
      dithered: dither,
    },
  })
}
