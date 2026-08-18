import { describe, expect, it } from 'vitest'
import type { OutputPlan } from '../core/pipeline'
import { createPool, poolConcurrency } from './pool'
import type { EncodeJob, JobEvent, JobId, JobReport, Runner } from './protocol'

/**
 * The pool is scheduling, and scheduling is the part that has to be right
 * before a single pixel is encoded: how many files run at once, what happens
 * to the other 199 when one of them is corrupt, and what "cancel" actually
 * stops.
 *
 * All of it is faked here, and that is the point. A real worker cannot be
 * asked to hang forever, and it is exactly the hanging case — a worker
 * terminated mid-encode whose promise never settles — that would freeze the
 * queue in front of a user. A fake reaches it in a millisecond.
 */

const PLAN: OutputPlan = { format: 'jpeg' }

const DONE: JobReport = {
  ok: true,
  value: {
    ms: 1,
    outcome: {
      output: new Uint8Array([1]),
      format: 'jpeg',
      bytesBefore: 10,
      bytesAfter: 1,
      width: 1,
      height: 1,
      quality: 75,
      withinBudget: true,
      shrunkForBudget: null,
      encodes: 1,
    },
  },
}

const CORRUPT: JobReport = {
  ok: false,
  error: { code: 'decode-failed', format: 'jpeg', detail: 'invalid marker' },
}

function job(id: string): EncodeJob {
  return { id, file: new File([new Uint8Array([1, 2, 3])], `${id}.jpg`), plan: PLAN }
}

/** Lets a microtask chain settle: a job finishing pumps the queue, not the test. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

class FakeRunner implements Runner {
  readonly started: JobId[] = []
  terminated = false
  private readonly waiting = new Map<JobId, (report: JobReport) => void>()
  private readonly failing = new Map<JobId, (cause: unknown) => void>()

  run(job: EncodeJob): Promise<JobReport> {
    this.started.push(job.id)
    return new Promise<JobReport>((resolve, reject) => {
      this.waiting.set(job.id, resolve)
      this.failing.set(job.id, reject)
    })
  }

  terminate(): void {
    this.terminated = true
    // A terminated worker never answers again. Dropping the resolvers models
    // that exactly, and leaves the pool holding a promise that stays pending
    // forever — which is the situation worth testing.
    this.waiting.clear()
    this.failing.clear()
  }

  finish(id: JobId, report: JobReport = DONE): void {
    const resolve = this.waiting.get(id)
    if (resolve === undefined) throw new Error(`runner is not holding job ${id}`)
    this.waiting.delete(id)
    this.failing.delete(id)
    resolve(report)
  }

  crash(id: JobId, cause: unknown): void {
    const reject = this.failing.get(id)
    if (reject === undefined) throw new Error(`runner is not holding job ${id}`)
    this.waiting.delete(id)
    this.failing.delete(id)
    reject(cause)
  }

  get holding(): JobId[] {
    return [...this.waiting.keys()]
  }
}

function harness(concurrency = 2) {
  const runners: FakeRunner[] = []
  const events: JobEvent[] = []

  const pool = createPool({
    concurrency,
    createRunner: () => {
      const runner = new FakeRunner()
      runners.push(runner)
      return runner
    },
    onEvent: (event) => events.push(event),
  })

  const holderOf = (id: JobId): FakeRunner => {
    const runner = runners.find((candidate) => candidate.holding.includes(id))
    if (runner === undefined) throw new Error(`no runner is holding job ${id}`)
    return runner
  }

  const idsWith = (type: JobEvent['type']): JobId[] =>
    events.filter((event) => event.type === type).map((event) => event.id)

  return { pool, runners, events, holderOf, idsWith }
}

describe('pool scheduling', () => {
  it('never runs more jobs at once than the concurrency allows', () => {
    const { pool } = harness(2)

    pool.enqueue([job('a'), job('b'), job('c'), job('d')])

    expect(pool.stats()).toEqual({ running: 2, queued: 2 })
  })

  it('spawns a worker per job in flight and not one more', () => {
    const { pool, runners } = harness(4)

    pool.enqueue([job('a')])

    // Spawning the full fleet for a single dropped file would pay for four
    // wasm instantiations to do one file's work.
    expect(runners).toHaveLength(1)
  })

  it('reuses an idle worker instead of spawning another', async () => {
    const { pool, runners, holderOf } = harness(2)
    pool.enqueue([job('a'), job('b'), job('c')])

    holderOf('a').finish('a')
    await flush()

    expect(runners).toHaveLength(2)
    expect(runners[0]?.started).toEqual(['a', 'c'])
  })

  it('starts jobs in the order they were enqueued', async () => {
    const { pool, holderOf, idsWith } = harness(1)
    pool.enqueue([job('a'), job('b'), job('c')])

    holderOf('a').finish('a')
    await flush()
    holderOf('b').finish('b')
    await flush()

    expect(idsWith('started')).toEqual(['a', 'b', 'c'])
  })

  it('accepts more work while the queue is already running', async () => {
    const { pool, holderOf, idsWith } = harness(1)
    pool.enqueue([job('a')])

    pool.enqueue([job('b')])
    holderOf('a').finish('a')
    await flush()

    expect(idsWith('started')).toEqual(['a', 'b'])
  })
})

describe('pool failures', () => {
  it('reports the failed file and keeps the rest of the batch running', async () => {
    const { pool, events, holderOf, idsWith } = harness(1)
    pool.enqueue([job('a'), job('b')])

    holderOf('a').finish('a', CORRUPT)
    await flush()

    expect(events).toContainEqual({ type: 'settled', id: 'a', report: CORRUPT })
    expect(idsWith('started')).toEqual(['a', 'b'])
  })

  it('turns a crashed worker into a typed failure instead of an unhandled rejection', async () => {
    const { pool, events, holderOf, idsWith } = harness(1)
    pool.enqueue([job('a'), job('b')])

    holderOf('a').crash('a', new Error('out of memory'))
    await flush()

    const settled = events.find((event) => event.type === 'settled')
    expect(settled?.report.ok).toBe(false)
    expect(settled?.report.ok === false && settled.report.error.code).toBe('worker-crashed')
    expect(idsWith('started')).toEqual(['a', 'b'])
  })

  it('gives every enqueued job exactly one terminal event', async () => {
    const { pool, events, holderOf } = harness(2)
    pool.enqueue([job('a'), job('b'), job('c')])

    holderOf('a').finish('a')
    holderOf('b').finish('b', CORRUPT)
    await flush()
    holderOf('c').crash('c', 'boom')
    await flush()

    const terminal = events.filter((event) => event.type !== 'started').map((event) => event.id)
    expect(terminal.toSorted()).toEqual(['a', 'b', 'c'])
  })

  it('resolves whenIdle once the queue has drained', async () => {
    const { pool, holderOf } = harness(2)
    pool.enqueue([job('a'), job('b')])

    const idle = pool.whenIdle()
    holderOf('a').finish('a')
    holderOf('b').finish('b')

    await expect(idle).resolves.toBeUndefined()
  })
})

describe('pool cancellation', () => {
  it('drops queued work and reports it cancelled', () => {
    const { pool, idsWith } = harness(1)
    pool.enqueue([job('a'), job('b')])

    pool.cancel('b')

    expect(idsWith('cancelled')).toEqual(['b'])
    expect(pool.stats()).toEqual({ running: 1, queued: 0 })
  })

  it('terminates the worker running a job, because a wasm encode cannot be interrupted', () => {
    const { pool, holderOf } = harness(1)
    pool.enqueue([job('a')])
    const runner = holderOf('a')

    pool.cancel('a')

    expect(runner.terminated).toBe(true)
  })

  it('replaces the terminated worker so the files behind it still run', async () => {
    const { pool, runners, idsWith } = harness(1)
    pool.enqueue([job('a'), job('b')])

    pool.cancel('a')
    await flush()

    expect(runners).toHaveLength(2)
    expect(runners[0]?.terminated).toBe(true)
    expect(idsWith('started')).toEqual(['a', 'b'])
  })

  it('does not stall when the terminated worker never answers', async () => {
    const { pool } = harness(2)
    pool.enqueue([job('a'), job('b')])

    const idle = pool.whenIdle()
    pool.cancelAll()

    await expect(idle).resolves.toBeUndefined()
    expect(pool.stats()).toEqual({ running: 0, queued: 0 })
  })

  it('cancels everything once, in flight and queued alike', () => {
    const { pool, idsWith } = harness(2)
    pool.enqueue([job('a'), job('b'), job('c')])

    pool.cancelAll()

    expect(idsWith('cancelled').toSorted()).toEqual(['a', 'b', 'c'])
  })

  it('starts nothing new after a cancel-all', async () => {
    const { pool, idsWith } = harness(1)
    pool.enqueue([job('a'), job('b'), job('c')])

    pool.cancelAll()
    await flush()

    expect(idsWith('started')).toEqual(['a'])
  })

  it('stays usable after a cancel-all, because cancelling is not closing', async () => {
    const { pool, holderOf, idsWith } = harness(1)
    pool.enqueue([job('a')])
    pool.cancelAll()

    pool.enqueue([job('b')])
    holderOf('b').finish('b')
    await flush()

    expect(idsWith('started')).toEqual(['a', 'b'])
    expect(idsWith('settled')).toEqual(['b'])
  })

  it('ignores a late answer from a job that was already cancelled', async () => {
    const { pool, events, runners } = harness(1)
    pool.enqueue([job('a')])
    const runner = runners[0]

    pool.cancel('a')
    // A worker that was already answering when the kill arrived. The pool has
    // reported the job cancelled; a second terminal event would double-count
    // it in the queue's totals.
    expect(() => runner?.finish('a')).toThrow()
    await flush()

    expect(events.filter((event) => event.id === 'a' && event.type !== 'started')).toHaveLength(1)
  })
})

describe('poolConcurrency', () => {
  it('leaves a core for the main thread', () => {
    expect(poolConcurrency(4)).toBe(3)
  })

  it('caps at four however many cores the machine reports', () => {
    expect(poolConcurrency(16)).toBe(4)
  })

  it('still runs on a single-core machine', () => {
    expect(poolConcurrency(1)).toBe(1)
  })

  it('falls back when the browser does not report cores', () => {
    expect(poolConcurrency(undefined)).toBe(2)
  })

  it('ignores nonsense values', () => {
    expect(poolConcurrency(0)).toBe(2)
    expect(poolConcurrency(Number.NaN)).toBe(2)
    expect(poolConcurrency(-3)).toBe(2)
  })
})
