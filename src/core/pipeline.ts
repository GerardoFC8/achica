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
import { fitWithin, isSameSize, resampleImage, scaleBy, type Dimensions } from './resize'
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

export type OutputPlan = {
  /** `keep` means whatever the input turned out to be, decided by its bytes. */
  readonly format: OutputFormat | 'keep'
  readonly maxBytes?: number
  readonly maxWidth?: number
  readonly maxHeight?: number
  readonly minQuality?: number
  /** Used only when there is no budget to search against. */
  readonly quality?: number
}

export type PipelineOutcome = {
  readonly output: EncodedBytes
  readonly format: OutputFormat
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
  readonly encodes: number
}

export type PipelineError = DetectionError | DecodeError | EncodeError

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

export async function processImage(
  bytes: ArrayBuffer,
  plan: OutputPlan,
): Promise<Result<PipelineOutcome, PipelineError>> {
  const bytesBefore = bytes.byteLength

  const detected = detectSupportedFormat(new Uint8Array(bytes))
  if (!detected.ok) return err(detected.error)

  const decoded = await decodeImage(detected.value, bytes)
  if (!decoded.ok) return err(decoded.error)

  const format: OutputFormat = plan.format === 'keep' ? detected.value : plan.format

  // The plan's own dimension limits apply first. Anything past this point is
  // the budget loop choosing to go smaller than was asked for.
  let image = decoded.value
  const requested = fitWithin(image, plan)
  if (!isSameSize(image, requested)) image = await resampleImage(image, requested)

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
    encodes,
  })

  try {
    if (plan.maxBytes === undefined) {
      const quality = plan.quality ?? DEFAULT_QUALITY
      const output = await encode(image, quality)

      return ok(describe({ withinBudget: true, output, bytes: output.length, quality }, null))
    }

    /*
     * The source size is a ceiling of its own.
     *
     * A budget is a limit, not a target. Asked for "under 500 KB" with a
     * 352 KB photo in hand, the search will happily find the highest quality
     * that fits and hand back 495 KB — bigger than what it was given. That is
     * absurd from a tool whose entire purpose is to make files smaller, and it
     * is the kind of absurdity a user only notices after uploading.
     */
    const maxBytes = Math.min(plan.maxBytes, bytesBefore)
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
