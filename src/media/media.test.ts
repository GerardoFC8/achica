import { describe, expect, it } from 'vitest'
import { createSerialQueue } from './serial-queue'
import { sniffVideoContainer } from './sniff'
import {
  createNearestSelector,
  frameDelays,
  MAX_CLIP_FRAMES,
  MAX_CLIP_SECONDS,
  nearestFrameIndices,
  planClip,
  targetTimes,
} from './timeline'

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values)
const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0))
const ftyp = (brand: string): Uint8Array =>
  bytes(0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii(brand), 0, 0, 0, 0)

describe('sniffVideoContainer', () => {
  it('accepts ISO-BMFF video brands, including QuickTime and audio-only M4A', () => {
    for (const brand of ['isom', 'mp42', 'qt  ', 'M4V ', 'M4A ']) {
      expect(sniffVideoContainer(ftyp(brand))).toBe('iso-bmff')
    }
  })
  it('accepts the EBML magic of Matroska and WebM', () => {
    expect(sniffVideoContainer(bytes(0x1a, 0x45, 0xdf, 0xa3, 1, 2))).toBe('matroska')
  })
  it('refuses image files that share the ftyp box, and anything else', () => {
    for (const brand of ['avif', 'heic', 'mif1', 'avis']) {
      expect(sniffVideoContainer(ftyp(brand))).toBeNull()
    }
    expect(sniffVideoContainer(bytes())).toBeNull()
    expect(sniffVideoContainer(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBeNull()
    expect(sniffVideoContainer(bytes(0x1a, 0x45, 0xdf, 0x00))).toBeNull()
    expect(sniffVideoContainer(bytes(0, 0, 0, 0x18, ...ascii('ftyp')))).toBeNull()
  })
})

describe('planClip', () => {
  const base = { durationSeconds: 60, startSeconds: 0, lengthSeconds: 5, fps: 15 }
  it('gives fps x length frames', () => {
    const plan = planClip(base)
    expect(plan.ok && plan.value).toEqual({ startSeconds: 0, lengthSeconds: 5, frameCount: 75 })
  })
  it('clips to what is left of the video', () => {
    const plan = planClip({ ...base, durationSeconds: 10, startSeconds: 8, lengthSeconds: 5 })
    expect(plan.ok && plan.value).toEqual({ startSeconds: 8, lengthSeconds: 2, frameCount: 30 })
  })
  it('caps at 15 s and at 225 frames', () => {
    const long = planClip({ ...base, lengthSeconds: 40 })
    expect(long.ok && long.value.lengthSeconds).toBe(MAX_CLIP_SECONDS)
    expect(long.ok && long.value.frameCount).toBe(225)
    const fast = planClip({ ...base, lengthSeconds: 40, fps: 30 })
    expect(fast.ok && fast.value.frameCount).toBe(MAX_CLIP_FRAMES)
    expect(fast.ok && fast.value.lengthSeconds).toBe(7.5)
  })
  it('rejects what cannot work', () => {
    for (const bad of [
      { fps: 0 },
      { fps: Number.NaN },
      { startSeconds: -1 },
      { lengthSeconds: 0 },
      { durationSeconds: Infinity },
      { durationSeconds: 0 },
      { startSeconds: 60 },
      { startSeconds: 70 },
    ]) {
      const plan = planClip({ ...base, ...bad })
      expect(plan.ok).toBe(false)
      expect(!plan.ok && plan.error.code).toBe('bad-options')
    }
  })
  it('always yields at least one frame', () => {
    const plan = planClip({ ...base, lengthSeconds: 0.01 })
    expect(plan.ok && plan.value.frameCount).toBe(1)
  })
})

describe('targetTimes and frameDelays', () => {
  it('samples start + k / fps', () => {
    expect(targetTimes(1, 4, 3)).toEqual([1, 1.25, 1.5])
  })
  it('carries the rounding so the delays add up to the clip length', () => {
    const delays = frameDelays(15, 1)
    expect(delays.reduce((a, b) => a + b, 0)).toBe(1000)
    expect(delays.every((d) => d === 66 || d === 67)).toBe(true)
    for (const [count, length] of [
      [75, 5],
      [225, 15],
      [7, 0.9],
      [1, 0.033],
    ] as const) {
      const sum = frameDelays(count, length).reduce((a, b) => a + b, 0)
      expect(sum).toBe(Math.round(length * 1000))
    }
  })
  it('never gives a delay under 1 ms', () => {
    expect(frameDelays(10, 0.001).every((d) => d >= 1)).toBe(true)
  })
})

describe('nearest frame selection', () => {
  it('picks the nearest, the earlier one on a tie', () => {
    expect(nearestFrameIndices([0, 0.1, 0.2], [0, 0.125, 0.25])).toEqual([0, 1, 2])
    expect(nearestFrameIndices([0.5], [0, 1])).toEqual([0])
  })

  function stream(targets: number[], times: number[]): number[] {
    const selector = createNearestSelector(targets)
    const chosen: number[] = []
    let previous = -1
    times.forEach((time, index) => {
      const fed = selector.feed(time)
      if (fed.skip) return
      for (let i = 0; i < fed.served; i += 1) chosen.push(previous)
      previous = index
    })
    for (let i = selector.flush(); i > 0; i -= 1) chosen.push(previous)
    return chosen
  }

  it('agrees with the reference on random timelines, duplicates for slow sources included', () => {
    let seed = 12345
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }
    for (let round = 0; round < 200; round += 1) {
      const fps = 1 + Math.floor(random() * 30)
      const start = random() * 3
      const count = 1 + Math.floor(random() * 40)
      const targets = targetTimes(start, fps, count)
      const times: number[] = []
      let time = start + (random() - 0.5) * 0.05
      while (time < (targets[count - 1] ?? 0) + 0.5) {
        times.push(time)
        time += (1 / (5 + random() * 55)) * (0.5 + random())
      }
      expect(stream(targets, times)).toEqual(nearestFrameIndices(targets, times))
    }
  })

  it('ignores a frame whose media time does not advance', () => {
    const selector = createNearestSelector([0, 1])
    expect(selector.feed(0).skip).toBe(false)
    expect(selector.feed(0).skip).toBe(true)
    expect(selector.feed(-1).skip).toBe(true)
  })

  it('serves nothing until a second frame arrives, and flush gives the rest to the last', () => {
    const selector = createNearestSelector([0, 1, 2])
    expect(selector.flush()).toBe(0)
    selector.feed(0.1)
    expect(selector.done).toBe(false)
    expect(selector.flush()).toBe(3)
    expect(selector.done).toBe(true)
  })
})

describe('serial queue', () => {
  const deferred = (): { promise: Promise<void>; resolve: () => void } => {
    let resolve!: () => void
    const promise = new Promise<void>((r) => (resolve = r))
    return { promise, resolve }
  }

  it('runs one job at a time, in order', async () => {
    const queue = createSerialQueue()
    const log: string[] = []
    const gates = [deferred(), deferred(), deferred()]
    const jobs = gates.map((gate, i) =>
      queue.run(
        async () => {
          log.push(`start ${i}`)
          await gate.promise
          log.push(`end ${i}`)
          return i
        },
        { whenAborted: () => -1 },
      ),
    )
    await Promise.resolve()
    expect(log).toEqual(['start 0'])
    for (const gate of gates) gate.resolve()
    expect(await Promise.all(jobs)).toEqual([0, 1, 2])
    expect(log).toEqual(['start 0', 'end 0', 'start 1', 'end 1', 'start 2', 'end 2'])
    expect(queue.size).toBe(0)
  })

  it('lets a waiting job leave on abort without running it, and keeps going', async () => {
    const queue = createSerialQueue()
    const gate = deferred()
    let ranSecond = false
    const first = queue.run(() => gate.promise.then(() => 'a'), { whenAborted: () => 'x' })
    const controller = new AbortController()
    const second = queue.run(
      async () => {
        ranSecond = true
        return 'b'
      },
      { signal: controller.signal, whenAborted: () => 'aborted' },
    )
    const third = queue.run(async () => 'c', { whenAborted: () => 'x' })
    controller.abort()
    // It leaves at once, while the first job is still running.
    expect(await second).toBe('aborted')
    gate.resolve()
    expect(await first).toBe('a')
    expect(await third).toBe('c')
    expect(ranSecond).toBe(false)
  })

  it('does not run a job whose signal is already aborted', async () => {
    const queue = createSerialQueue()
    let ran = false
    const result = await queue.run(
      async () => {
        ran = true
        return 1
      },
      { signal: AbortSignal.abort(), whenAborted: () => 0 },
    )
    expect(result).toBe(0)
    expect(ran).toBe(false)
  })

  it('survives a job that throws', async () => {
    const queue = createSerialQueue()
    const failing = queue.run(() => Promise.reject(new Error('boom')), { whenAborted: () => 0 })
    await expect(failing).rejects.toThrow('boom')
    expect(await queue.run(async () => 7, { whenAborted: () => 0 })).toBe(7)
  })
})
