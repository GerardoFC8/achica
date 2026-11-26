import { err, ok, type Result } from '../result'
import { decodeAnimation } from './decode'
import type { FitMode } from './fit'
import { fitAnimationToBudget, type LadderDeps, type Step } from './ladder'
import type { AnimationError, AnimationFormat, Frame } from './types'
import type { ClipInfo } from './video-segment'

/**
 * Decode, reframe, then search for the settings that fit the byte budget.
 *
 * Standalone on purpose: nothing here knows about the single-image pipeline,
 * the worker or the interface. Naming the output file is the caller's job
 * (an APNG is a `.png`, by convention, whatever this module calls it).
 */

export type AnimationLayout = Exclude<FitMode, { kind: 'none' }>

export type AnimationPlan = {
  /** Sticker: a square canvas, enlarged and padded. Emoji: shrunk to fit, never enlarged. */
  readonly layout: AnimationLayout
  readonly format: AnimationFormat
  readonly maxBytes: number
  /** Sticker only: may fall back to a 256 px canvas as a last resort. Default false. */
  readonly allowCanvasReduction?: boolean
}

export type AnimationOutcome = {
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly format: AnimationFormat
  readonly width: number
  readonly height: number
  readonly frames: number
  readonly durationMs: number
  readonly fps: number
  /** Palette size; null for lossless RGBA APNG. */
  readonly colors: number | null
  /** What was given up to fit, in the order it was given up. */
  readonly steps: readonly Step[]
  /** False when nothing fit: `bytes` is then the smallest that was produced. */
  readonly withinBudget: boolean
  readonly bytesBefore: number
  readonly encodes: number
  /** Set only when the frames came from a video: which part of it was kept. */
  readonly clip?: ClipInfo
}

export async function processAnimation(
  input: Uint8Array | ArrayBuffer,
  plan: AnimationPlan,
  deps: LadderDeps = {},
): Promise<Result<AnimationOutcome, AnimationError>> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const decoded = await decodeAnimation(bytes, { fit: plan.layout })
  if (!decoded.ok) return err(decoded.error)

  return fitFrames(decoded.value.frames, plan, { bytesBefore: bytes.length }, deps)
}

/** What the caller knows about frames that were made somewhere else. */
export type FramesContext = {
  /** The weight of the file the frames came from. */
  readonly bytesBefore: number
  /** For a video: which part of it the frames are. */
  readonly clip?: ClipInfo
}

/**
 * The same search, over frames that are already decoded and already at their
 * final size (the video extractor makes them on the main thread). Nothing is
 * decoded here. A budget that cannot be met is still a success, marked
 * `withinBudget: false`.
 */
export function processFrames(
  frames: readonly Frame[],
  plan: AnimationPlan,
  context: FramesContext,
  deps: LadderDeps = {},
): Promise<Result<AnimationOutcome, AnimationError>> {
  return fitFrames(frames, plan, context, deps)
}

async function fitFrames(
  frames: readonly Frame[],
  plan: AnimationPlan,
  context: FramesContext,
  deps: LadderDeps,
): Promise<Result<AnimationOutcome, AnimationError>> {
  const fitted = await fitAnimationToBudget(
    frames,
    {
      format: plan.format,
      layout: plan.layout.kind,
      maxBytes: plan.maxBytes,
      ...(plan.allowCanvasReduction === undefined
        ? {}
        : { allowCanvasReduction: plan.allowCanvasReduction }),
    },
    deps,
  )
  if (!fitted.ok) return err(fitted.error)

  const outcome = fitted.value
  return ok({
    bytes: outcome.encoding.bytes,
    format: plan.format,
    width: outcome.width,
    height: outcome.height,
    frames: outcome.frameCount,
    durationMs: outcome.durationMs,
    fps: outcome.fps,
    colors: outcome.colors,
    steps: outcome.steps,
    withinBudget: outcome.withinBudget,
    bytesBefore: context.bytesBefore,
    encodes: outcome.encodes,
    ...(context.clip === undefined ? {} : { clip: context.clip }),
  })
}
