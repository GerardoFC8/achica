/**
 * Finds the highest quality whose output still fits a weight budget.
 *
 * "Leave them all under 100 KB" is the operation this product is built
 * around, so this search is a first-class piece of logic rather than a helper.
 *
 * The encoder is injected. That keeps the algorithm pure and testable in Node
 * without a browser, and it is also the honest shape: bisection does not care
 * whether it is driving MozJPEG or a lookup table, and the search should not
 * be rewritten the day a codec changes.
 *
 * We optimise for size, not for a perceptual metric. Butteraugli or SSIM would
 * multiply the cost of every image by a large constant, and the user's actual
 * constraint is a number a government portal put in a form.
 */

export type Attempt<T> = {
  readonly output: T
  readonly bytes: number
}

export type BudgetOptions = {
  /** The hard ceiling the output must come in under. */
  readonly maxBytes: number
  /** Quality below which the result stops being worth delivering. */
  readonly minQuality?: number
  readonly maxQuality?: number
  /** Hard cap on encodes. Each one costs real time, AVIF especially. */
  readonly maxIterations?: number
  /**
   * Stop once a fitting result reaches this share of the budget. At 0.97 a
   * result using 97% of the allowance is accepted rather than spending two
   * more encodes to gain a few hundred bytes nobody will notice.
   */
  readonly closeEnough?: number
  /**
   * Stop when two consecutive encodes differ by less than this share. Catches
   * a stalled search, and also a format where quality changes nothing at all.
   */
  readonly convergence?: number
}

export type BudgetOutcome<T> = {
  /** False when even the lowest acceptable quality overshot the budget. */
  readonly withinBudget: boolean
  readonly output: T
  readonly bytes: number
  readonly quality: number
  /** How many encodes it cost. Worth reporting: it is the expensive part. */
  readonly attempts: number
}

const DEFAULTS = {
  minQuality: 40,
  maxQuality: 100,
  maxIterations: 8,
  closeEnough: 0.97,
  convergence: 0.03,
} as const

function relativeChange(a: number, b: number): number {
  const largest = Math.max(a, b)
  return largest === 0 ? 0 : Math.abs(a - b) / largest
}

/**
 * Bisects the quality range for the largest value that still fits.
 *
 * When nothing fits — not even the lowest acceptable quality — the result
 * comes back with `withinBudget: false` and the smallest output found. That is
 * deliberately not an error: the caller's next move is to reduce the
 * dimensions and search again, and it needs the floor to decide by how much.
 * Deciding to resize is not this function's business.
 */
export async function searchQualityForBudget<T>(
  attempt: (quality: number) => Promise<Attempt<T>>,
  options: BudgetOptions,
): Promise<BudgetOutcome<T>> {
  const { maxBytes } = options
  const minQuality = options.minQuality ?? DEFAULTS.minQuality
  const maxQuality = options.maxQuality ?? DEFAULTS.maxQuality
  const maxIterations = options.maxIterations ?? DEFAULTS.maxIterations
  const closeEnough = options.closeEnough ?? DEFAULTS.closeEnough
  const convergence = options.convergence ?? DEFAULTS.convergence

  type Measured = Attempt<T> & { quality: number }

  let attempts = 0
  let best: Measured | null = null

  /*
   * Try the ceiling first.
   *
   * A generous budget is the common case — a 500 KB limit against a photo that
   * is 200 KB at full quality — and bisecting towards it costs six encodes to
   * discover nothing had to be given up. One encode answers it. When it does
   * not fit, the attempt is not wasted either: it establishes the ceiling the
   * bisection below is working down from.
   */
  const ceiling = await attempt(maxQuality)
  attempts += 1

  let smallest: Measured = { ...ceiling, quality: maxQuality }

  if (ceiling.bytes <= maxBytes) {
    return {
      withinBudget: true,
      output: ceiling.output,
      bytes: ceiling.bytes,
      quality: maxQuality,
      attempts,
    }
  }

  let previousBytes = ceiling.bytes
  let low = minQuality
  let high = maxQuality - 1

  while (low <= high && attempts < maxIterations) {
    const quality = Math.floor((low + high) / 2)
    const result = await attempt(quality)
    attempts += 1

    if (result.bytes < smallest.bytes) {
      smallest = { ...result, quality }
    }

    const fits = result.bytes <= maxBytes

    if (fits && (best === null || quality > best.quality)) {
      best = { ...result, quality }
      // Close enough to the ceiling that more encodes cannot buy much.
      if (result.bytes >= maxBytes * closeEnough) break
    }

    // Quality is moving nothing at all: a lossless format, or a degenerate
    // image. There is no search to run.
    if (result.bytes === previousBytes) break

    /*
     * A stalled search is only worth abandoning once something already fits.
     *
     * The spec asks to stop when two consecutive attempts land within 3% of
     * each other, and taken literally that can fire while every attempt is
     * still over budget — reporting "this cannot fit, go resize" when simply
     * going lower would have worked. The early exit is there to save encodes
     * once the answer is good enough, not to give up before there is one.
     */
    if (best !== null && relativeChange(result.bytes, previousBytes) < convergence) break

    previousBytes = result.bytes

    if (fits) low = quality + 1
    else high = quality - 1
  }

  const chosen = best ?? smallest

  return {
    withinBudget: best !== null,
    output: chosen.output,
    bytes: chosen.bytes,
    quality: chosen.quality,
    attempts,
  }
}
