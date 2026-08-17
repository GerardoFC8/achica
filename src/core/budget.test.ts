import { describe, expect, it } from 'vitest'
import { searchQualityForBudget, type Attempt } from './budget'

/**
 * The encoder is faked here on purpose. Bisection does not care what is
 * producing the bytes, and a fake makes the awkward cases — a format with no
 * quality knob, a budget nothing can reach — reachable in milliseconds instead
 * of minutes of real AVIF encoding.
 */

/** Bytes fall as quality falls, which is what bisection assumes of a codec. */
function linearEncoder(bytesAtFullQuality: number) {
  const calls: number[] = []

  const attempt = async (quality: number): Promise<Attempt<string>> => {
    calls.push(quality)
    const bytes = Math.round((bytesAtFullQuality * quality) / 100)
    return { output: `q${quality}`, bytes }
  }

  return { attempt, calls }
}

describe('searchQualityForBudget', () => {
  it('finds the highest quality that still fits', async () => {
    const { attempt } = linearEncoder(100_000)

    const outcome = await searchQualityForBudget(attempt, { maxBytes: 60_000 })

    expect(outcome.withinBudget).toBe(true)
    expect(outcome.bytes).toBeLessThanOrEqual(60_000)
    // The linear fake puts the true answer at 60; anything much lower means
    // the search is leaving quality on the table.
    expect(outcome.quality).toBeGreaterThanOrEqual(58)
    expect(outcome.quality).toBeLessThanOrEqual(60)
  })

  it('returns the output it measured, not just a number', async () => {
    const { attempt } = linearEncoder(100_000)

    const outcome = await searchQualityForBudget(attempt, { maxBytes: 60_000 })

    expect(outcome.output).toBe(`q${outcome.quality}`)
  })

  it('never spends more encodes than it is allowed', async () => {
    const { attempt, calls } = linearEncoder(100_000)

    const outcome = await searchQualityForBudget(attempt, {
      maxBytes: 1,
      maxIterations: 4,
      convergence: 0,
    })

    expect(calls.length).toBeLessThanOrEqual(4)
    expect(outcome.attempts).toBe(calls.length)
  })

  it('reports the floor instead of failing when nothing fits', async () => {
    // Not an error: the caller's next move is to reduce dimensions, and it
    // needs to know how far off the smallest possible output was.
    const { attempt } = linearEncoder(100_000)

    const outcome = await searchQualityForBudget(attempt, { maxBytes: 1_000, minQuality: 40 })

    expect(outcome.withinBudget).toBe(false)
    expect(outcome.quality).toBe(40)
    expect(outcome.bytes).toBe(40_000)
  })

  it('does try the lowest acceptable quality before declaring defeat', async () => {
    const { attempt, calls } = linearEncoder(100_000)

    await searchQualityForBudget(attempt, { maxBytes: 1_000, minQuality: 40 })

    expect(calls).toContain(40)
  })

  it('keeps searching while nothing fits, even when sizes barely move', async () => {
    /*
     * The regression this guards. Reading the spec's early exit literally —
     * stop when two consecutive attempts land within 3% — lets the search bail
     * while every attempt is still over budget, reporting "impossible" when
     * simply going lower would have worked. This encoder is nearly flat at the
     * top and drops off a cliff at the bottom.
     */
    const attempt = async (quality: number): Promise<Attempt<number>> => {
      const bytes = quality >= 50 ? 100_000 - quality : 5_000
      return { output: quality, bytes }
    }

    const outcome = await searchQualityForBudget(attempt, { maxBytes: 10_000, minQuality: 40 })

    expect(outcome.withinBudget).toBe(true)
    expect(outcome.bytes).toBe(5_000)
  })

  it('stops immediately when quality changes nothing, as with a lossless format', async () => {
    const calls: number[] = []
    const attempt = async (quality: number): Promise<Attempt<string>> => {
      calls.push(quality)
      return { output: 'png', bytes: 250_000 }
    }

    const outcome = await searchQualityForBudget(attempt, { maxBytes: 100_000, maxIterations: 8 })

    // Two encodes are enough to learn the knob is not connected to anything.
    expect(calls.length).toBe(2)
    expect(outcome.withinBudget).toBe(false)
  })

  it('accepts a result that is close enough rather than chasing the last bytes', async () => {
    const { attempt, calls } = linearEncoder(100_000)

    // 70% of the budget is reachable exactly, so the search should settle fast
    // once it lands inside the closeEnough band instead of bisecting to the
    // last integer.
    const outcome = await searchQualityForBudget(attempt, {
      maxBytes: 70_000,
      closeEnough: 0.9,
    })

    expect(outcome.withinBudget).toBe(true)
    expect(outcome.bytes).toBeGreaterThanOrEqual(63_000)
    expect(calls.length).toBeLessThan(8)
  })

  it('respects a raised quality floor', async () => {
    const { attempt, calls } = linearEncoder(100_000)

    await searchQualityForBudget(attempt, { maxBytes: 10_000, minQuality: 70 })

    expect(Math.min(...calls)).toBeGreaterThanOrEqual(70)
  })

  it('spends a single encode when full quality already fits', async () => {
    // The common case: a 500 KB limit against a photo that is 200 KB at full
    // quality. Bisecting towards the ceiling would cost six encodes to
    // discover nothing had to be given up.
    const { attempt, calls } = linearEncoder(1_000)

    const outcome = await searchQualityForBudget(attempt, { maxBytes: 10_000 })

    expect(outcome.withinBudget).toBe(true)
    expect(outcome.quality).toBe(100)
    expect(calls).toEqual([100])
  })

  it('never returns an output it did not actually measure', async () => {
    const seen = new Map<number, number>()
    const attempt = async (quality: number): Promise<Attempt<number>> => {
      const bytes = 200_000 - quality * 1_500
      seen.set(quality, bytes)
      return { output: quality, bytes }
    }

    const outcome = await searchQualityForBudget(attempt, { maxBytes: 90_000 })

    expect(seen.get(outcome.quality)).toBe(outcome.bytes)
  })
})
