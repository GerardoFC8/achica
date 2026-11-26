import { err, ok, type Result } from '../result'
import { scaleBy, type Dimensions } from '../resize'
import { encodeApng } from './apng'
import { resizeImage } from './fit'
import { encodeGif } from './gif'
import type {
  AnimationEncoding,
  AnimationError,
  AnimationFormat,
  EncodeError,
  Frame,
} from './types'

/**
 * Finding the animation that fits a byte budget, giving up as little as
 * possible.
 *
 * The levers, from least to most visible, are a fixed ordered list (the
 * "ladder") and every rung includes everything the rungs before it gave up:
 *
 *   a. keep every frame and 256 colours (APNG: lossless RGBA first, when small)
 *   b. fewer colours: 128, 64, 32
 *   c. fewer frames per second, never below 4
 *   c'. then 16 colours, the most visible palette step
 *   d. emoji only: smaller dimensions, 0.9 down to 0.5
 *   e. sticker only, when the plan allows it: a 256 px canvas instead of 320
 *
 * The search is a bisection over that list, with a hard cap on encodes: one
 * encode of a 320 x 320, 45 frame animation costs 1 to 3 seconds, so the
 * budget of this module is the number of encodes, not the number of rungs.
 *
 * Monotonicity is only approximate, and this is where the bisection can be
 * wrong. A rung is assumed to be no larger than the one before it, which fails
 * when (1) differencing gets worse as frames drift apart, so dropping frames
 * can grow a file that was cropped to its changes (measured: a zoomed photo
 * at 4-6 fps was 440 KB cropped against 403 KB whole), (2) fewer colours move
 * LZW and deflate away from long runs by a few percent, and (3) a palette
 * change reshuffles which pixels are "unchanged". The consequence is bounded:
 * the answer is still a rung that was measured to fit, it may just be one rung
 * more aggressive than the least aggressive that fits. It never reports a fit
 * it did not measure.
 *
 * Two things are decided on the final candidate only, to save encodes:
 * whether cropping to the changed area helps (it does not always), and nothing
 * else. Dithering is never used here: it adds weight and defeats cropping, and
 * this search exists to remove weight.
 *
 * Dropping frames keeps the total duration. The frames that stay take the
 * delays of the ones that leave, by sampling the timeline at the target rate
 * (which frame is on screen at each tick), so 15 fps to 10 fps works although
 * the ratio is not an integer.
 */

export type BudgetPlan = {
  readonly format: AnimationFormat
  readonly layout: 'sticker' | 'emoji'
  readonly maxBytes: number
  /** Sticker only: allow the 256 px canvas as the last resort. Default false. */
  readonly allowCanvasReduction?: boolean
  /** Cap on encodes for the whole search. Default 12. */
  readonly maxEncodes?: number
}

/** What a rung asks of the encoder. `colors: null` is lossless RGBA APNG. */
export type EncodeSettings = {
  readonly format: AnimationFormat
  readonly colors: number | null
  readonly optimise: boolean
}

export type LadderDeps = {
  /** Replaces the real GIF/APNG writers; lets Node tests search with invented sizes. */
  readonly encode?: (
    frames: readonly Frame[],
    settings: EncodeSettings,
  ) => Promise<Result<AnimationEncoding, EncodeError>>
  /** Replaces the lanczos resampler. */
  readonly resize?: (frame: Frame, target: Dimensions) => Promise<Frame>
}

export type Step =
  | { readonly kind: 'palette'; readonly colors: number }
  | { readonly kind: 'fps'; readonly from: number; readonly to: number }
  | { readonly kind: 'scale'; readonly to: number }
  | { readonly kind: 'canvas'; readonly to: number }
  | { readonly kind: 'optimise'; readonly on: boolean }

export type BudgetOutcome = {
  readonly encoding: AnimationEncoding
  /** False when nothing fit: `encoding` is then the smallest that was produced. */
  readonly withinBudget: boolean
  /** What was given up, in ladder order. Empty when the first try fit. */
  readonly steps: readonly Step[]
  readonly encodes: number
  readonly width: number
  readonly height: number
  readonly frameCount: number
  readonly durationMs: number
  /** Frames per second of the result, one decimal. */
  readonly fps: number
  /** Palette size, or null for lossless RGBA. */
  readonly colors: number | null
}

export const LADDER = {
  maxEncodes: 12,
  palettes: [256, 128, 64, 32],
  /**
   * The last palette step comes after the frame-rate steps, not before. On a
   * photo at 16 colours the banding is worse than a lower frame rate, and the
   * measured case that fits (about 4 fps) did so at 32 colours.
   */
  lastPalette: 16,
  /** Candidate rates; only those clearly below the source rate become rungs. */
  fps: [24, 20, 15, 12, 10, 8, 6, 5, 4],
  minFps: 4,
  emojiScales: [0.9, 0.8, 0.7, 0.6, 0.5],
  reducedCanvas: 256,
  /** A GIF delay under 20 ms plays as 100 ms in browsers. */
  minDelayMs: 20,
  /**
   * Lossless RGBA APNG is only tried when the raw pixels are this small:
   * deflating 18 MB (320 x 320 x 45 frames) costs about 3 s for a file that
   * measured around 900 KB, which almost never fits.
   */
  rgbaMaxRawBytes: 6 * 2 ** 20,
} as const

type Rung = {
  /** Null: lossless RGBA. */
  readonly colors: number | null
  /** Target rate, or null for every frame. */
  readonly fps: number | null
  readonly scale: number
  readonly canvas: number | null
}

type Sampled = { readonly index: number; readonly delayMs: number }

/**
 * Merges every frame shorter than the minimum into the one before it, so the
 * duration is unchanged and no frame is raised afterwards. A short first frame
 * has nothing before it and stays; the GIF writer raises that one.
 */
export function mergeShortDelays(frames: readonly Frame[], minMs = LADDER.minDelayMs): Frame[] {
  const out: Frame[] = []
  for (const frame of frames) {
    const previous = out[out.length - 1]
    if (previous !== undefined && frame.delayMs < minMs) {
      out[out.length - 1] = { ...previous, delayMs: previous.delayMs + frame.delayMs }
    } else {
      out.push(frame)
    }
  }
  return out
}

/**
 * The frames kept when playing at `fps`, and the delay each one takes so the
 * total duration is preserved. At each tick of the target rate the frame on
 * screen is kept; the same frame twice in a row is kept once.
 */
export function sampleAtRate(frames: readonly Frame[], fps: number): Sampled[] {
  const starts: number[] = []
  let total = 0
  for (const frame of frames) {
    starts.push(total)
    total += frame.delayMs
  }
  const interval = 1000 / fps
  const kept: number[] = []
  let at = 0
  for (let tick = 0; tick * interval < total; tick += 1) {
    const time = tick * interval + 1e-6
    while (at + 1 < frames.length && (starts[at + 1] ?? Infinity) <= time) at += 1
    if (kept[kept.length - 1] !== at) kept.push(at)
  }
  return kept.map((index, k) => {
    const next = kept[k + 1]
    const end = next === undefined ? total : (starts[next] ?? total)
    return { index, delayMs: end - (starts[index] ?? 0) }
  })
}

const durationOf = (frames: readonly { readonly delayMs: number }[]): number =>
  frames.reduce((sum, frame) => sum + frame.delayMs, 0)

const roundFps = (value: number): number => Math.round(value * 10) / 10

function buildRungs(
  frames: readonly Frame[],
  plan: BudgetPlan,
): { rungs: Rung[]; rgba: boolean; sourceFps: number } {
  const first = frames[0]
  const rungs: Rung[] = []
  const raw = first === undefined ? 0 : first.width * first.height * 4 * frames.length
  const rgba = plan.format === 'apng' && raw <= LADDER.rgbaMaxRawBytes
  if (rgba) rungs.push({ colors: null, fps: null, scale: 1, canvas: null })
  for (const colors of LADDER.palettes) rungs.push({ colors, fps: null, scale: 1, canvas: null })

  const kept = LADDER.palettes[LADDER.palettes.length - 1] ?? 32
  const total = durationOf(frames)
  const sourceFps = total > 0 ? (frames.length / total) * 1000 : 0
  let previousCount = frames.length
  for (const fps of LADDER.fps) {
    // Only rates that visibly differ from the source's, and never under the floor.
    if (fps > sourceFps * 0.85 || fps < LADDER.minFps) continue
    const sampled = sampleAtRate(frames, fps)
    const achieved = total > 0 ? (sampled.length / total) * 1000 : 0
    if (sampled.length >= previousCount || achieved < LADDER.minFps - 0.01) continue
    previousCount = sampled.length
    rungs.push({ colors: kept, fps, scale: 1, canvas: null })
  }
  const lowest = LADDER.lastPalette
  rungs.push({
    colors: lowest,
    fps: rungs[rungs.length - 1]?.fps ?? null,
    scale: 1,
    canvas: null,
  })

  const lastFps = rungs[rungs.length - 1]?.fps ?? null
  if (plan.layout === 'emoji') {
    for (const scale of LADDER.emojiScales) {
      rungs.push({ colors: lowest, fps: lastFps, scale, canvas: null })
    }
  } else if (plan.allowCanvasReduction === true) {
    rungs.push({ colors: lowest, fps: lastFps, scale: 1, canvas: LADDER.reducedCanvas })
  }
  return { rungs, rgba, sourceFps }
}

async function defaultEncode(
  frames: readonly Frame[],
  settings: EncodeSettings,
): Promise<Result<AnimationEncoding, EncodeError>> {
  if (settings.format === 'gif') {
    return encodeGif(frames, { maxColors: settings.colors ?? 256, optimize: settings.optimise })
  }
  if (settings.colors === null) {
    return encodeApng(frames, { mode: 'rgba', optimize: settings.optimise })
  }
  return encodeApng(frames, {
    mode: 'indexed',
    maxColors: settings.colors,
    optimize: settings.optimise,
  })
}

async function defaultResize(frame: Frame, target: Dimensions): Promise<Frame> {
  const image = new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height)
  const resized = await resizeImage(image, target)
  return {
    data: resized.data,
    width: resized.width,
    height: resized.height,
    delayMs: frame.delayMs,
  }
}

type Probe = {
  readonly rung: number
  readonly optimise: boolean
  readonly encoding: AnimationEncoding
  readonly bytes: number
  readonly frameCount: number
  readonly durationMs: number
}

export async function fitAnimationToBudget(
  input: readonly Frame[],
  plan: BudgetPlan,
  deps: LadderDeps = {},
): Promise<Result<BudgetOutcome, AnimationError>> {
  const encode = deps.encode ?? defaultEncode
  const resize = deps.resize ?? defaultResize
  const first = input[0]
  if (first === undefined) return err({ code: 'no-frames', detail: 'the animation has no frames' })

  const frames = mergeShortDelays(input)
  const base: Dimensions = { width: first.width, height: first.height }
  const { rungs, rgba, sourceFps } = buildRungs(frames, plan)
  const maxEncodes = Math.max(2, plan.maxEncodes ?? LADDER.maxEncodes)
  const resized = new Map<string, Frame>()

  const sizeFor = (rung: Rung): Dimensions => {
    if (rung.canvas !== null) {
      return scaleBy(base, rung.canvas / Math.max(base.width, base.height))
    }
    return rung.scale < 1 ? scaleBy(base, rung.scale) : base
  }

  /** The frames of a rung: sampled at its rate, then resized (once per frame and size). */
  async function framesFor(rung: Rung): Promise<Frame[] | AnimationError> {
    const sampled =
      rung.fps === null
        ? frames.map((frame, index) => ({ index, delayMs: frame.delayMs }))
        : sampleAtRate(frames, rung.fps)
    const target = sizeFor(rung)
    const same = target.width === base.width && target.height === base.height
    const out: Frame[] = []
    for (const { index, delayMs } of sampled) {
      const source = frames[index]
      if (source === undefined) continue
      if (same) {
        out.push({ ...source, delayMs })
        continue
      }
      const key = `${index}|${target.width}x${target.height}`
      let scaled = resized.get(key)
      if (scaled === undefined) {
        try {
          scaled = await resize(source, target)
        } catch (error) {
          return {
            code: 'resize-failed',
            detail: error instanceof Error ? error.message : 'resampling failed',
          }
        }
        resized.set(key, scaled)
      }
      out.push({ ...scaled, delayMs })
    }
    return out
  }

  let encodes = 0
  // Assigned inside probe(); the cast stops control-flow analysis narrowing it to null.
  let smallest = null as Probe | null

  async function probe(index: number, optimise: boolean): Promise<Result<Probe, AnimationError>> {
    const rung = rungs[index]
    if (rung === undefined) return err({ code: 'bad-option', detail: `no rung ${index}` })
    const selected = await framesFor(rung)
    if (!Array.isArray(selected)) return err(selected as AnimationError)
    encodes += 1
    const encoded = await encode(selected, { format: plan.format, colors: rung.colors, optimise })
    if (!encoded.ok) return encoded
    const result: Probe = {
      rung: index,
      optimise,
      encoding: encoded.value,
      bytes: encoded.value.bytes.length,
      frameCount: selected.length,
      durationMs: durationOf(selected),
    }
    if (smallest === null || result.bytes < smallest.bytes) smallest = result
    return ok(result)
  }

  const fits = (candidate: Probe): boolean => candidate.bytes <= plan.maxBytes

  function finish(chosen: Probe): Result<BudgetOutcome, AnimationError> {
    const rung = rungs[chosen.rung]
    const steps: Step[] = []
    const frameCount = chosen.frameCount
    const fps = chosen.durationMs > 0 ? roundFps((frameCount / chosen.durationMs) * 1000) : 0
    if (rung !== undefined) {
      if (rung.colors !== null && (rung.colors < 256 || rgba)) {
        steps.push({ kind: 'palette', colors: rung.colors })
      }
      if (rung.fps !== null) steps.push({ kind: 'fps', from: roundFps(sourceFps), to: fps })
      if (rung.canvas !== null) steps.push({ kind: 'canvas', to: rung.canvas })
      else if (rung.scale < 1) steps.push({ kind: 'scale', to: rung.scale })
    }
    // Cropping is the default; only turning it off is a departure worth telling.
    if (!chosen.optimise) steps.push({ kind: 'optimise', on: false })
    const { width, height } = chosen.encoding
    return ok({
      encoding: chosen.encoding,
      withinBudget: fits(chosen),
      steps,
      encodes,
      width,
      height,
      frameCount,
      durationMs: chosen.durationMs,
      fps,
      colors: rung?.colors ?? null,
    })
  }

  /** The lighter of a candidate and the same rung without cropping. */
  async function withBestCropping(candidate: Probe): Promise<Result<Probe, AnimationError>> {
    if (encodes >= maxEncodes) return ok(candidate)
    const other = await probe(candidate.rung, !candidate.optimise)
    if (!other.ok) return other
    return ok(other.value.bytes < candidate.bytes ? other.value : candidate)
  }

  // Everything the user keeps if it already fits: no search, no comparison.
  const top = await probe(0, true)
  if (!top.ok) return top
  if (fits(top.value)) return finish(top.value)

  const last = rungs.length - 1
  if (last === 0) {
    const best = await withBestCropping(top.value)
    return best.ok ? finish(best.value) : best
  }

  const bottom = await probe(last, true)
  if (!bottom.ok) return bottom
  if (!fits(bottom.value)) {
    // Nothing fits. Say so, with the smallest thing that was actually made.
    const other = await withBestCropping(bottom.value)
    if (!other.ok) return other
    return finish(smallest ?? other.value)
  }

  let low = 0
  let high = last
  let fitting = bottom.value
  while (high - low > 1 && encodes < maxEncodes - 1) {
    const middle = (low + high) >> 1
    const middleProbe = await probe(middle, true)
    if (!middleProbe.ok) return middleProbe
    if (fits(middleProbe.value)) {
      high = middle
      fitting = middleProbe.value
    } else {
      low = middle
    }
  }
  const best = await withBestCropping(fitting)
  return best.ok ? finish(best.value) : best
}
