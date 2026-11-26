import { err, ok, type Result } from '../result'
import { decodeAnimation } from './decode'
import type { FitMode } from './fit'
import { fitAnimationToBudget, type LadderDeps, type Step } from './ladder'
import type { AnimationError, AnimationFormat } from './types'

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
}

export async function processAnimation(
  input: Uint8Array | ArrayBuffer,
  plan: AnimationPlan,
  deps: LadderDeps = {},
): Promise<Result<AnimationOutcome, AnimationError>> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const decoded = await decodeAnimation(bytes, { fit: plan.layout })
  if (!decoded.ok) return err(decoded.error)

  const fitted = await fitAnimationToBudget(
    decoded.value.frames,
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
    bytesBefore: bytes.length,
    encodes: outcome.encodes,
  })
}
