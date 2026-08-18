import { describe, expect, it } from 'vitest'
import type { OutputPlan } from '../core/pipeline'
import { benchFiles, runQueueBench, slowdownOf } from './queue-bench'

/**
 * Phase 2's acceptance criterion as a regression guard: two hundred images
 * through the real store, the real pool and real workers.
 *
 * Memory is not asserted here, because no gauge reachable from inside the page
 * tells the truth about it — the note in queue-bench.ts lists the three that
 * were tried. `npm run bench` measures it from outside, as the resident size
 * of the Chrome process tree, and those are the figures in the README.
 *
 * What is asserted is that every file finishes and that the batch keeps a
 * steady rate. A queue that hoards what it processes ends up fighting the
 * collector, and its last files take far longer than its middle ones.
 */

const FIXTURE_URLS = import.meta.glob('../../test/fixtures/**/*.jpg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

async function fixtureBytes(name: string): Promise<ArrayBuffer> {
  const key = Object.keys(FIXTURE_URLS).find((path) => path.endsWith(`/${name}`))
  if (key === undefined) throw new Error(`fixture not found: ${name}`)

  const url = FIXTURE_URLS[key]
  if (url === undefined) throw new Error(`fixture url missing: ${name}`)

  return (await fetch(url)).arrayBuffer()
}

/**
 * One encode per file, not a budget search.
 *
 * The search re-encodes the same bitmap up to eight times, which triples the
 * run without changing what is being watched: decode and resize are what
 * allocate, and they happen once either way. `npm run bench` uses the budget
 * profile, which is the realistic one.
 */
const PLAN: OutputPlan = { format: 'webp', maxWidth: 1280, quality: 75 }

const FILES = 200

/**
 * Generous on purpose. A machine sharing its cores with a CI runner will
 * produce uneven stretches; a queue drowning in its own garbage produces
 * stretches an order of magnitude apart.
 */
const MAX_SLOWDOWN = 5

describe('queue bench', () => {
  it('processes two hundred images at a steady rate', { timeout: 300_000 }, async () => {
    const bytes = await fixtureBytes('Landscape_6.jpg')

    const report = await runQueueBench({
      files: benchFiles(bytes, FILES),
      plan: PLAN,
      sampleEvery: 25,
    })

    expect(report.firstError).toBeNull()
    expect(report.done).toBe(FILES)
    expect(report.failed).toBe(0)
    expect(report.bytesAfter).toBeLessThan(report.bytesBefore)
    expect(report.slowdown).not.toBeNull()
    expect(report.slowdown ?? Infinity).toBeLessThan(MAX_SLOWDOWN)
  })
})

describe('slowdownOf', () => {
  it('reports a steady batch as near one', () => {
    const samples = [0, 100, 200, 300, 400, 500].map((ms, index) => ({ settled: index * 25, ms }))

    expect(slowdownOf(samples) ?? 0).toBeCloseTo(1)
  })

  it('ignores the first stretch, which pays for spawning the workers', () => {
    // 5000 ms of warm-up followed by four even stretches: the batch itself ran
    // steadily, and measuring against the warm-up would say so backwards.
    const samples = [0, 5000, 5100, 5200, 5300, 5400].map((ms, index) => ({
      settled: index * 25,
      ms,
    }))

    expect(slowdownOf(samples) ?? 0).toBeCloseTo(1)
  })

  it('catches a batch whose last stretch collapses', () => {
    const samples = [0, 100, 200, 300, 400, 4000].map((ms, index) => ({ settled: index * 25, ms }))

    expect(slowdownOf(samples) ?? 0).toBeGreaterThan(10)
  })
})
