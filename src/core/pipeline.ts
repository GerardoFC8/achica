import { flattenOnWhite, hasTransparency } from './alpha'
import {
  processAnimation,
  processFrames,
  type AnimationLayout,
  type AnimationOutcome,
  type AnimationPlan,
  type ClipInfo,
  type FramesContext,
  type Step,
  type VideoFailureReason,
  type VideoSegment,
} from './animation'
import type { AnimationError, AnimationFormat, Frame } from './animation/types'
import { searchQualityForBudget } from './budget'
import { decodeImage, type DecodeError } from './codecs/decode'
import {
  encodeImage,
  isLossy,
  type EncodedBytes,
  type EncodeError,
  type OutputFormat,
} from './codecs/encode'
import { detectSupportedFormat, type DetectionError } from './detect'
import { stripMetadata, type RemovedMetadata, type StripError } from './metadata'
import { isSameSize, resampleImage, resolveTargetSize, scaleBy, type Dimensions } from './resize'
import type { OutputKind } from './output-kind'
import { err, ok, type Result } from './result'

/**
 * One file, start to finish: detect, decode, orient, resize, encode.
 *
 * Every step already exists and is tested on its own. What lives here is the
 * order they run in, and the single decision that needs judgement — what to do
 * when a weight budget cannot be met by quality alone.
 *
 * No timing is taken here. The worker that runs the job owns scheduling and is
 * the honest place to measure elapsed milliseconds; putting a clock in this
 * layer would make it untestable and buy nothing.
 */

/**
 * An animated destination (sticker, emoji). `OutputPlan.maxBytes` is its
 * budget, and `OutputPlan.format` is ignored.
 */
export type AnimationRequest = {
  /** Sticker: a square canvas, enlarged and padded. Emoji: shrunk to fit, never enlarged. */
  readonly layout: AnimationLayout
  readonly format: AnimationFormat
  /** Sticker only: may fall back to a 256 px canvas as a last resort. Default false. */
  readonly allowCanvasReduction?: boolean
  /**
   * Which part of a VIDEO becomes the animation. Present, a file whose bytes
   * are an MP4 or WebM is read as a video (the runner extracts its frames on
   * the main thread); any other file takes the animation route as always.
   * The interface sets it on the plan; a profile never does.
   */
  readonly video?: VideoSegment
}

/** What the budget search did to an animation, for the row to say. */
export type AnimationSummary = {
  readonly frames: number
  readonly durationMs: number
  readonly fps: number
  /** Palette size; null for lossless RGBA APNG. */
  readonly colors: number | null
  /** What was given up to fit, in the order it was given up. */
  readonly steps: readonly Step[]
  /** Set only for a video: which part of it was kept. */
  readonly clip?: ClipInfo
}

export type OutputPlan = {
  /** `keep` means whatever the input turned out to be, decided by its bytes. */
  readonly format: OutputFormat | 'keep'
  readonly maxBytes?: number
  readonly maxWidth?: number
  readonly maxHeight?: number
  /**
   * Factor in (0, 1) applied to the decoded size before the limits above.
   * Never enlarges; see `resolveTargetSize` for how invalid values behave.
   */
  readonly scale?: number
  readonly minQuality?: number
  /** Used only when there is no budget to search against. */
  readonly quality?: number
  /**
   * Where a lossless file goes when it cannot meet the budget as it is.
   *
   * PNG has no quality to search, so under a ceiling its only lever is
   * shrinking the picture. Set, a file that would come out lossless and miss
   * the budget is encoded in this format instead, at full size, and reaches
   * the budget by quality. Unset, it stays lossless and shrinks (D21). A file
   * that already fits keeps its format either way (D53).
   */
  readonly losslessUnderBudget?: OutputFormat
  /**
   * Remove the metadata from the container bytes and return the same image:
   * no decode, no resize, no encode. Every other field is ignored. Not to be
   * confused with `Profile.stripMetadata`, which describes the recompress path.
   */
  readonly stripOnly?: boolean
  /**
   * Treat the file as an animation: no still-image detection, no still
   * decoder, no still encoder. `maxBytes` is required and is the budget; the
   * rest of the plan (format, dimensions, quality) does not apply. A budget
   * that cannot be met is not an error: see `withinBudget`.
   */
  readonly animation?: AnimationRequest
}

export type PipelineOutcome = {
  readonly output: EncodedBytes
  /** What the file is. An animation is `gif` or `apng`, never one of the still formats. */
  readonly format: OutputKind
  readonly bytesBefore: number
  readonly bytesAfter: number
  readonly width: number
  readonly height: number
  /** Null for a lossless format, which has no quality to report. */
  readonly quality: number | null
  /** False when the budget could not be met even after shrinking. */
  readonly withinBudget: boolean
  /** Set when the pipeline shrank the image further than the plan asked for. */
  readonly shrunkForBudget: Dimensions | null
  /** True when the format changed only because the budget asked for it. */
  readonly convertedForBudget: boolean
  readonly encodes: number
  /** Set only by a strip-only plan: what was removed from the file. */
  readonly metadata?: RemovedMetadata
  /** Set only by an animation plan: what the file is and what was given up to fit. */
  readonly animation?: AnimationSummary
}

/**
 * An animation could not be read, framed or written. Wrapped under one code
 * instead of spread into the union, because its codes (`corrupt`,
 * `unsupported-format`, `empty-file`) collide with still-image errors that
 * carry other fields.
 */
export type AnimationFailure = {
  readonly code: 'animation-failed'
  readonly reason: AnimationError['code']
  /** For logs, never for the interface. */
  readonly detail: string
}

/**
 * A video could not be turned into frames (before any encoding). Its own code
 * and not `worker-crashed`: nothing crashed, and the reasons have their own
 * advice (HEVC, a hidden tab, audio only).
 */
export type VideoFailure = {
  readonly code: 'video-failed'
  readonly reason: VideoFailureReason
  /** For logs, never for the interface. */
  readonly detail: string
}

export type PipelineError =
  DetectionError | DecodeError | EncodeError | StripError | AnimationFailure | VideoFailure

const DEFAULT_QUALITY = 75

/** Shrink rounds allowed after the quality search has bottomed out. */
const MAX_SHRINK_ROUNDS = 3

/**
 * A cap on encodes for the whole file, not per search.
 *
 * The spec warns AVIF can take seconds per image. Four budget searches of
 * eight attempts each would be thirty-two encodes for one photo, which across
 * a queue of two hundred is the difference between minutes and an afternoon.
 */
const MAX_TOTAL_ENCODES = 16

/**
 * How much smaller to go when the budget is out of reach.
 *
 * Encoded size tracks pixel count closely enough that the ratio of target to
 * actual gives a usable linear scale. Halving blindly overshoots on a small
 * miss and undershoots on a large one; this lands near the answer in one
 * round. The estimate is nudged down because it is optimistic, and clamped so
 * a round always makes progress without collapsing the image.
 */
export function nextScaleForBudget(currentBytes: number, maxBytes: number): number {
  if (currentBytes <= 0 || maxBytes <= 0) return 0.5

  const estimate = Math.sqrt(maxBytes / currentBytes) * 0.9
  return Math.min(0.95, Math.max(0.1, estimate))
}

type SizedAttempt = {
  readonly withinBudget: boolean
  readonly output: EncodedBytes
  readonly bytes: number
  readonly quality: number
}

type Encoder = (image: ImageData, quality: number) => Promise<EncodedBytes>

/**
 * The best this image can do at its current dimensions.
 *
 * A lossless format has no quality to search, so it gets one encode and a
 * verdict. That is what sends a PNG with a weight budget into the shrink loop
 * rather than failing it outright: dimensions are the only lever the format
 * leaves, and using it beats telling the user the request is impossible.
 */
async function bestAtCurrentSize(
  format: OutputFormat,
  image: ImageData,
  maxBytes: number,
  plan: OutputPlan,
  encode: Encoder,
  maxIterations: number,
): Promise<SizedAttempt> {
  if (!isLossy(format)) {
    const output = await encode(image, DEFAULT_QUALITY)
    return {
      withinBudget: output.length <= maxBytes,
      output,
      bytes: output.length,
      quality: DEFAULT_QUALITY,
    }
  }

  const outcome = await searchQualityForBudget(
    async (quality) => {
      const output = await encode(image, quality)
      return { output, bytes: output.length }
    },
    {
      maxBytes,
      ...(plan.minQuality === undefined ? {} : { minQuality: plan.minQuality }),
      maxIterations,
    },
  )

  return {
    withinBudget: outcome.withinBudget,
    output: outcome.output,
    bytes: outcome.bytes,
    quality: outcome.quality,
  }
}

/** The strip-only path: container surgery, so none of the codec bookkeeping applies. */
function stripOnly(bytes: ArrayBuffer): Result<PipelineOutcome, PipelineError> {
  const stripped = stripMetadata(new Uint8Array(bytes))
  if (!stripped.ok) return err(stripped.error)

  const { value } = stripped
  return ok({
    output: value.bytes,
    format: value.format,
    bytesBefore: bytes.byteLength,
    bytesAfter: value.bytes.length,
    width: value.width,
    height: value.height,
    quality: null,
    withinBudget: true,
    shrunkForBudget: null,
    convertedForBudget: false,
    encodes: 0,
    metadata: value.removed,
  })
}

/**
 * The animation path: its own module does the work, this only translates.
 *
 * A budget that cannot be met is still a success (`withinBudget: false` with
 * the smallest file that was produced), because the user can still use that
 * file and the row says it did not fit. Only a file that cannot be read or
 * written at all is an error.
 */
async function processAnimated(
  bytes: ArrayBuffer,
  request: AnimationRequest,
  maxBytes: number | undefined,
): Promise<Result<PipelineOutcome, PipelineError>> {
  if (maxBytes === undefined) {
    return err({
      code: 'animation-failed',
      reason: 'bad-option',
      detail: 'an animation plan needs maxBytes',
    })
  }

  const result = await processAnimation(new Uint8Array(bytes), animationPlan(request, maxBytes))
  return describeAnimation(result, bytes.byteLength)
}

const animationPlan = (request: AnimationRequest, maxBytes: number): AnimationPlan => ({
  layout: request.layout,
  format: request.format,
  maxBytes,
  ...(request.allowCanvasReduction === undefined
    ? {}
    : { allowCanvasReduction: request.allowCanvasReduction }),
})

function describeAnimation(
  result: Result<AnimationOutcome, AnimationError>,
  bytesBefore: number,
): Result<PipelineOutcome, PipelineError> {
  if (!result.ok) {
    return err({ code: 'animation-failed', reason: result.error.code, detail: result.error.detail })
  }

  const { value } = result
  return ok({
    output: value.bytes,
    format: value.format,
    bytesBefore,
    bytesAfter: value.bytes.length,
    width: value.width,
    height: value.height,
    quality: null,
    withinBudget: value.withinBudget,
    shrunkForBudget: null,
    convertedForBudget: false,
    encodes: value.encodes,
    animation: {
      frames: value.frames,
      durationMs: value.durationMs,
      fps: value.fps,
      colors: value.colors,
      steps: value.steps,
      ...(value.clip === undefined ? {} : { clip: value.clip }),
    },
  })
}

/**
 * The video route: frames already extracted at their final size (by
 * `extractVideoFrames`, on the main thread) go straight to the budget search.
 * `bytesBefore` is the video file's own weight, so the row's saving is about
 * the file the user dropped.
 */
export async function processVideoFrames(
  frames: readonly Frame[],
  plan: OutputPlan,
  context: FramesContext,
): Promise<Result<PipelineOutcome, PipelineError>> {
  if (plan.animation === undefined || plan.maxBytes === undefined) {
    return err({
      code: 'animation-failed',
      reason: 'bad-option',
      detail: 'a video plan needs an animation request and maxBytes',
    })
  }
  const result = await processFrames(frames, animationPlan(plan.animation, plan.maxBytes), context)
  return describeAnimation(result, context.bytesBefore)
}

export async function processImage(
  bytes: ArrayBuffer,
  plan: OutputPlan,
): Promise<Result<PipelineOutcome, PipelineError>> {
  const bytesBefore = bytes.byteLength

  if (plan.stripOnly === true) return stripOnly(bytes)
  if (plan.animation !== undefined) return processAnimated(bytes, plan.animation, plan.maxBytes)

  const detected = detectSupportedFormat(new Uint8Array(bytes))
  if (!detected.ok) return err(detected.error)

  const decoded = await decodeImage(detected.value, bytes)
  if (!decoded.ok) return err(decoded.error)

  // Not const: a lossless file may still switch to plan.losslessUnderBudget.
  let format: OutputFormat = plan.format === 'keep' ? detected.value : plan.format
  let convertedForBudget = false

  // The plan's own dimension limits apply first. Anything past this point is
  // the budget loop choosing to go smaller than was asked for.
  let image = decoded.value
  const requested = resolveTargetSize(image, plan)
  if (!isSameSize(image, requested)) image = await resampleImage(image, requested)

  /*
   * JPEG cannot hold transparency, so an image headed there is composited on
   * white once, here, and not inside the encode callback: the budget search
   * encodes the same pixels many times and flattening each attempt would be
   * pure waste. It runs after the resize because that is fewer pixels, and the
   * shrink loop further down resamples the flattened image, which stays opaque.
   * Called again when a lossless file switches to the fallback format, since
   * that format may be JPEG too. Every other output keeps its alpha.
   */
  const flattenForJpeg = (): void => {
    if (format === 'jpeg' && hasTransparency(image)) image = flattenOnWhite(image)
  }
  flattenForJpeg()

  let encodes = 0
  let encodeFailure: EncodeError | null = null

  const encode: Encoder = async (source, quality) => {
    encodes += 1
    const result = await encodeImage(format, source, quality)
    if (!result.ok) {
      encodeFailure = result.error
      throw result.error
    }
    return result.value
  }

  const describe = (attempt: SizedAttempt, shrunk: Dimensions | null): PipelineOutcome => ({
    output: attempt.output,
    format,
    bytesBefore,
    bytesAfter: attempt.bytes,
    width: image.width,
    height: image.height,
    quality: isLossy(format) ? attempt.quality : null,
    withinBudget: attempt.withinBudget,
    shrunkForBudget: shrunk,
    convertedForBudget,
    encodes,
  })

  try {
    if (plan.maxBytes === undefined) {
      const quality = plan.quality ?? DEFAULT_QUALITY
      const output = await encode(image, quality)

      return ok(describe({ withinBudget: true, output, bytes: output.length, quality }, null))
    }

    const maxBytes = plan.maxBytes

    /*
     * A lossless file gets one honest try in its own format first. A PNG of
     * a screenshot often packs under the budget as it is, and turning it into
     * a WebP would change its name for nothing. Only when that try misses does
     * the format change, and from then on the budget search below runs on the
     * lossy format like any other photo.
     */
    const fallback = plan.losslessUnderBudget
    if (!isLossy(format) && fallback !== undefined && isLossy(fallback)) {
      const output = await encode(image, DEFAULT_QUALITY)
      if (output.length <= maxBytes) {
        return ok(
          describe(
            { withinBudget: true, output, bytes: output.length, quality: DEFAULT_QUALITY },
            null,
          ),
        )
      }

      format = fallback
      convertedForBudget = true
      flattenForJpeg()
    }

    /*
     * A budget the file already meets is not a target.
     *
     * The search maximises quality against its ceiling, so pointing it at a
     * budget the source already fits returns the source size back: asked for
     * "under 300 KB" with a 252 KB photo, it handed back 249 KB — a 1% saving
     * paid for with a full quality pass. Worse for a small image, where the
     * ceiling became the file's own 167 bytes, no JPEG header fits inside
     * that, and the shrink loop ground a 32x32 picture down to 9x9 chasing a
     * limit that was never in the way.
     *
     * So when the budget is already met, the target is the profile's quality —
     * which is what the user chose a destination for. One encode, no search,
     * and a real saving instead of a rounding error.
     */
    if (bytesBefore <= maxBytes) {
      const quality = plan.quality ?? DEFAULT_QUALITY
      const output = await encode(image, quality)

      if (output.length <= maxBytes) {
        return ok(describe({ withinBudget: true, output, bytes: output.length, quality }, null))
      }
      // Converting to a heavier format can overshoot a budget the source met.
      // That is a real budget problem, so it goes to the search below.
    }

    let shrunkForBudget: Dimensions | null = null

    for (let round = 0; round <= MAX_SHRINK_ROUNDS; round += 1) {
      const remaining = MAX_TOTAL_ENCODES - encodes
      if (remaining <= 0) break

      const attempt = await bestAtCurrentSize(
        format,
        image,
        maxBytes,
        plan,
        encode,
        Math.min(8, remaining),
      )

      const outOfRounds = round === MAX_SHRINK_ROUNDS || MAX_TOTAL_ENCODES - encodes <= 0
      if (attempt.withinBudget || outOfRounds) return ok(describe(attempt, shrunkForBudget))

      const smaller = scaleBy(image, nextScaleForBudget(attempt.bytes, maxBytes))
      if (isSameSize(image, smaller)) return ok(describe(attempt, shrunkForBudget))

      image = await resampleImage(image, smaller)
      shrunkForBudget = { width: image.width, height: image.height }
    }
  } catch {
    // The encoder records its own typed error before throwing; the throw only
    // exists to unwind the budget search, which has no way to return one.
    if (encodeFailure !== null) return err(encodeFailure)
  }

  return err({ code: 'encode-failed', format, detail: 'budget search made no progress' })
}
