import { describe, expect, it } from 'vitest'
import type { OutputPlan } from '../core/pipeline'
import { createPool, poolConcurrency } from './pool'
import type { EncodeJob, JobEvent, JobReport } from './protocol'
import { createWorkerRunner } from './runner'

/**
 * The pool is tested against a fake runner, where nothing can encode. This is
 * the other half: a real worker, a real photo, and the questions a fake cannot
 * answer — does the job actually cross the boundary, does a corrupt file leave
 * the worker usable for the next one, and does terminating it really stop work
 * that is already running.
 */

const FIXTURE_URLS = import.meta.glob('../../test/fixtures/**/*.{jpg,png}', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

async function fixtureFile(name: string): Promise<File> {
  const key = Object.keys(FIXTURE_URLS).find((path) => path.endsWith(`/${name}`))
  if (key === undefined) throw new Error(`fixture not found: ${name}`)

  const url = FIXTURE_URLS[key]
  if (url === undefined) throw new Error(`fixture url missing: ${name}`)

  const bytes = await (await fetch(url)).arrayBuffer()
  return new File([bytes], name)
}

/** Small enough to keep the suite quick, real enough to exercise resize. */
const PLAN: OutputPlan = { format: 'jpeg', maxWidth: 640, quality: 70 }

async function job(id: string, fixture: string, plan: OutputPlan = PLAN): Promise<EncodeJob> {
  return { id, file: await fixtureFile(fixture), plan }
}

const settledIn = async (ms: number, promise: Promise<JobReport>): Promise<boolean> =>
  Promise.race([
    promise.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ])

/**
 * A PNG written the ordinary way: valid and badly packed.
 *
 * `@jsquash/png/encode` is what most tools' output looks like, and it is the
 * file a user actually drops in. Built here rather than kept as a fixture
 * because the point is the packing, not the picture.
 */
async function wastefulPngFile(): Promise<File> {
  const { default: naiveEncode } = await import('@jsquash/png/encode')
  const { decodeImage } = await import('../core/codecs/decode')

  const source = await fixtureFile('Landscape_6.jpg')
  const decoded = await decodeImage('jpeg', await source.arrayBuffer())
  if (!decoded.ok) throw new Error('fixture failed to decode')

  return new File([await naiveEncode(decoded.value)], 'wasteful.png')
}

describe('worker runner', () => {
  it('packs a PNG losslessly inside the worker, where oxipng runs multi-threaded', async () => {
    /*
     * The configuration production actually ships, and the one no other test
     * reaches. oxipng only starts its rayon thread pool when it finds itself in
     * a Worker on a machine with more than one core; everywhere else it falls
     * back to the single-threaded build. Every unit test runs on the main
     * thread, so without this the shipped path would be the untested one (D50).
     */
    const runner = createWorkerRunner()

    const report = await runner.run({
      id: 'png',
      file: await wastefulPngFile(),
      plan: { format: 'keep', maxWidth: 2000 },
    })
    runner.terminate()

    expect(report.ok).toBe(true)
    if (!report.ok) return

    // Kept as a PNG, and genuinely smaller: the only compression a lossless
    // format can offer.
    expect(report.value.outcome.format).toBe('png')
    expect(report.value.outcome.bytesAfter).toBeLessThan(report.value.outcome.bytesBefore)
  })

  it('compresses a real photo off the main thread', async () => {
    const runner = createWorkerRunner()

    const report = await runner.run(await job('a', 'Landscape_6.jpg'))
    runner.terminate()

    expect(report.ok).toBe(true)
    if (!report.ok) return

    expect(report.value.outcome.width).toBeLessThanOrEqual(640)
    expect(report.value.outcome.bytesAfter).toBeLessThan(report.value.outcome.bytesBefore)
    // The pipeline takes no clock on purpose; the worker is where the honest
    // measurement lives, and the interface promises to show it.
    expect(report.value.ms).toBeGreaterThan(0)
  })

  it('reports a corrupt file as a typed failure and stays usable afterwards', async () => {
    const runner = createWorkerRunner()

    const failure = await runner.run(await job('bad', 'xd0n2c08.png'))
    const recovered = await runner.run(await job('good', 'Landscape_6.jpg'))
    runner.terminate()

    expect(failure.ok).toBe(false)
    if (!failure.ok) expect(failure.error.code).toBe('decode-failed')
    // One bad file in three hundred must cost that file, not the worker.
    expect(recovered.ok).toBe(true)
  })

  it('stops a job that is already running when the worker is terminated', async () => {
    const runner = createWorkerRunner()

    const running = runner.run(await job('a', 'Landscape_6.jpg'))
    runner.terminate()

    // This is the whole reason cancellation kills the worker: a terminated
    // one never answers, which is exactly what stopping work in flight means.
    await expect(settledIn(400, running)).resolves.toBe(false)
  })
})

describe('pool driving real workers', () => {
  it('runs a batch to completion and reports every file once', async () => {
    const events: JobEvent[] = []
    const pool = createPool({
      concurrency: 2,
      createRunner: createWorkerRunner,
      onEvent: (event) => events.push(event),
    })

    pool.enqueue([
      await job('a', 'Landscape_6.jpg'),
      await job('b', 'Portrait_6.jpg'),
      await job('c', 'basn6a08.png'),
    ])
    await pool.whenIdle()
    pool.dispose()

    const settled = events.filter((event) => event.type === 'settled')
    expect(settled.map((event) => event.id).toSorted()).toEqual(['a', 'b', 'c'])
    expect(settled.every((event) => event.report.ok)).toBe(true)
  })

  it('cancels a batch that is already encoding', async () => {
    const events: JobEvent[] = []
    const pool = createPool({
      concurrency: 2,
      createRunner: createWorkerRunner,
      onEvent: (event) => events.push(event),
    })

    pool.enqueue([
      await job('a', 'Landscape_6.jpg'),
      await job('b', 'Portrait_6.jpg'),
      await job('c', 'Landscape_6.jpg'),
    ])
    const idle = pool.whenIdle()
    pool.cancelAll()
    await idle
    pool.dispose()

    const cancelled = events.filter((event) => event.type === 'cancelled')
    expect(cancelled.map((event) => event.id).toSorted()).toEqual(['a', 'b', 'c'])
    expect(pool.stats()).toEqual({ running: 0, queued: 0 })
  })
})

describe('poolConcurrency against the real browser', () => {
  it('reads a plausible core count', () => {
    const concurrency = poolConcurrency(navigator.hardwareConcurrency)

    expect(concurrency).toBeGreaterThanOrEqual(1)
    expect(concurrency).toBeLessThanOrEqual(4)
  })
})
