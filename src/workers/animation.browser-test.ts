import { describe, expect, it } from 'vitest'
import { encodeGif } from '../core/animation'
import { mimeTypeOfKind } from '../core/output-kind'
import { DISCORD_PERFILES, toOutputPlan, type ExternalProfile } from '../core/profiles'
import { loadFixture } from '../../test/helpers/animation-fixtures'
import { createPool } from './pool'
import type { EncodeJob, JobEvent, JobReport } from './protocol'
import { createWorkerRunner } from './runner'

/**
 * An animation through the real thing: a `File`, the `Runner`, a real worker,
 * `processImage`, and back. What the unit tests cannot say is whether
 * `ImageDecoder` and `OffscreenCanvas` exist where the worker runs, and
 * whether the result that crosses the boundary is what a viewer plays.
 *
 * The output is read again with a bare `ImageDecoder`, so the checks are about
 * the bytes a person would upload, not about what the pipeline believes.
 */

const profileOf = (id: string): ExternalProfile => {
  const profile = DISCORD_PERFILES.find((candidate) => candidate.id === id)
  if (profile === undefined) throw new Error(`no profile ${id}`)
  return profile
}

async function fileOf(name: string): Promise<File> {
  return new File([await loadFixture(name)], name)
}

async function runOnce(file: File, profile: ExternalProfile): Promise<JobReport> {
  const runner = createWorkerRunner()
  try {
    return await runner.run({ id: file.name, file, plan: toOutputPlan(profile) })
  } finally {
    runner.terminate()
  }
}

async function inspect(
  bytes: Uint8Array<ArrayBuffer>,
  type: string,
): Promise<{ width: number; height: number; frames: number }> {
  const decoder = new ImageDecoder({ data: bytes, type })
  await decoder.completed
  await decoder.tracks.ready
  const frames = decoder.tracks.selectedTrack?.frameCount ?? 0
  const { image } = await decoder.decode({ frameIndex: 0, completeFramesOnly: true })
  const size = { width: image.displayWidth, height: image.displayHeight, frames }
  image.close()
  decoder.close()
  return size
}

/**
 * Noise: every pixel random and every frame different, so nothing in it
 * compresses. Long and big enough that even the lowest frame rate and the
 * smallest palette cannot get it under a sticker's budget.
 */
async function noiseFile(): Promise<File> {
  const side = 320
  let state = 987_654_321
  const frames = Array.from({ length: 24 }, () => {
    const data = new Uint8ClampedArray(side * side * 4)
    for (let at = 0; at < data.length; at += 4) {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      data[at] = state >>> 24
      data[at + 1] = (state >>> 16) & 255
      data[at + 2] = (state >>> 8) & 255
      data[at + 3] = 255
    }
    return { data, width: side, height: side, delayMs: 160 }
  })
  const encoded = encodeGif(frames, { maxColors: 256 })
  if (!encoded.ok) throw new Error(encoded.error.detail)
  return new File([encoded.value.bytes], 'ruido.gif')
}

const SOURCES = ['anim-opaque.gif', 'anim-wide.gif', 'anim.apng', 'anim.webp'] as const

describe('an animation through the worker', () => {
  it('finds ImageDecoder and OffscreenCanvas where the worker runs', async () => {
    // The worker is the only place the animation path runs in production, and
    // an unsupported browser is a typed error, so the absence would not throw.
    const runner = createWorkerRunner()
    const report = await runner.run({
      id: 'probe',
      file: await fileOf('anim-opaque.gif'),
      plan: toOutputPlan(profileOf('discord-emoji-gif')),
    })
    runner.terminate()

    expect(report.ok).toBe(true)
    if (!report.ok && report.error.code === 'animation-failed') {
      expect(report.error.reason).not.toBe('animation-unsupported')
    }
  })

  describe.each(['discord-sticker-gif', 'discord-sticker-apng'] as const)('%s', (id) => {
    it.each(SOURCES)('%s comes out 320x320, decodable, with a true verdict', async (name) => {
      const profile = profileOf(id)
      const report = await runOnce(await fileOf(name), profile)

      expect(report.ok).toBe(true)
      if (!report.ok) return
      const { outcome } = report.value

      expect(outcome.format).toBe(profile.animation.format)
      expect([outcome.width, outcome.height]).toEqual([320, 320])
      expect(outcome.quality).toBeNull()
      expect(outcome.convertedForBudget).toBe(false)
      expect(outcome.shrunkForBudget).toBeNull()
      expect(outcome.bytesAfter).toBe(outcome.output.length)
      expect(outcome.withinBudget).toBe(outcome.bytesAfter <= profile.maxBytes)
      // The limit the verdict was reached against travels with the result.
      expect(outcome.animation?.limitBytes).toBe(profile.maxBytes)
      expect(outcome.animation?.frames).toBeGreaterThan(1)

      const seen = await inspect(outcome.output, mimeTypeOfKind(outcome.format))
      expect([seen.width, seen.height]).toEqual([320, 320])
      expect(seen.frames).toBe(outcome.animation?.frames)
    })
  })

  describe('discord-emoji-gif', () => {
    it.each(SOURCES)('%s fits in 128 px without being enlarged', async (name) => {
      const profile = profileOf('discord-emoji-gif')
      const report = await runOnce(await fileOf(name), profile)

      expect(report.ok).toBe(true)
      if (!report.ok) return
      const { outcome } = report.value

      expect(outcome.format).toBe('gif')
      expect(outcome.width).toBeLessThanOrEqual(128)
      expect(outcome.height).toBeLessThanOrEqual(128)
      expect(outcome.withinBudget).toBe(outcome.bytesAfter <= profile.maxBytes)

      const seen = await inspect(outcome.output, 'image/gif')
      expect([seen.width, seen.height]).toEqual([outcome.width, outcome.height])
      expect(seen.frames).toBeGreaterThan(1)
    })
  })

  it('answers an animation that cannot be compressed with a marked success, not an error', async () => {
    const profile = profileOf('discord-sticker-gif')
    const report = await runOnce(await noiseFile(), profile)

    expect(report.ok).toBe(true)
    if (!report.ok) return
    const { outcome } = report.value

    expect(outcome.withinBudget).toBe(false)
    expect(outcome.bytesAfter).toBeGreaterThan(profile.maxBytes)
    expect(outcome.output.length).toBe(outcome.bytesAfter)
    // The best it could do is still a playable file at the right size.
    const seen = await inspect(outcome.output, 'image/gif')
    expect([seen.width, seen.height]).toEqual([320, 320])
    expect(outcome.animation?.steps.length).toBeGreaterThan(0)
  }, 120_000)

  it.each([
    ['static.png', 'not-animated'],
    ['single-frame.gif', 'not-animated'],
    ['orientation-1.jpg', 'unsupported-format'],
  ] as const)('%s is the typed error %s', async (name, reason) => {
    const report = await runOnce(await fileOf(name), profileOf('discord-sticker-gif'))

    expect(report.ok).toBe(false)
    if (report.ok) return
    expect(report.error).toMatchObject({ code: 'animation-failed', reason })
  })

  it('reports an empty file as an animation failure', async () => {
    const empty = new File([], 'vacio.gif')
    const report = await runOnce(empty, profileOf('discord-sticker-gif'))

    expect(report.ok).toBe(false)
    if (!report.ok) expect(report.error).toMatchObject({ reason: 'empty-file' })
  })

  describe('cancelling', () => {
    const settledIn = async (ms: number, promise: Promise<JobReport>): Promise<boolean> =>
      Promise.race([
        promise.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
      ])

    it('stops an animation that is already running when the worker is terminated', async () => {
      const runner = createWorkerRunner()
      const running = runner.run({
        id: 'noise',
        file: await noiseFile(),
        plan: toOutputPlan(profileOf('discord-sticker-gif')),
      })
      runner.terminate()

      await expect(settledIn(400, running)).resolves.toBe(false)
    })

    it('does not leave the pool hanging, and the next animation still runs', async () => {
      const events: JobEvent[] = []
      const pool = createPool({
        concurrency: 1,
        createRunner: createWorkerRunner,
        onEvent: (event) => events.push(event),
      })
      const plan = toOutputPlan(profileOf('discord-emoji-gif'))
      const noise: EncodeJob = { id: 'noise', file: await noiseFile(), plan }

      pool.enqueue([noise])
      pool.cancel('noise')
      await pool.whenIdle()
      expect(events.some((event) => event.type === 'cancelled' && event.id === 'noise')).toBe(true)

      pool.enqueue([{ id: 'after', file: await fileOf('anim-opaque.gif'), plan }])
      await pool.whenIdle()
      pool.dispose()

      const settled = events.find((event) => event.type === 'settled' && event.id === 'after')
      expect(settled?.type === 'settled' && settled.report.ok).toBe(true)
    }, 60_000)
  })
})
