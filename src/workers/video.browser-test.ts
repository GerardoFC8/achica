import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Frame } from '../core/animation'
import { mimeTypeOfKind } from '../core/output-kind'
import type { OutputPlan } from '../core/pipeline'
import { DISCORD_PERFILES, toOutputPlan, type ExternalProfile } from '../core/profiles'
import { err, ok } from '../core/result'
import type { VideoError } from '../media/video-frames'
import { createQueueStore, type QueueItem } from '../state/queue'
import { loadFixture } from '../../test/helpers/animation-fixtures'
import { createPool } from './pool'
import type { JobReport } from './protocol'
import { createWorkerRunner, type VideoExtractor } from './runner'

/**
 * A video through the real thing: a `File`, the `Runner`, the real extractor
 * playing the real <video> on the main thread, the real worker and the real
 * encoders. The output is read again with a bare `ImageDecoder`, so the checks
 * are about the bytes a person would upload.
 *
 * What cannot be checked here: that Discord accepts the file, HEVC (no fixture
 * the browsers in CI can play), and Safari.
 */

const profileOf = (id: string): ExternalProfile => {
  const profile = DISCORD_PERFILES.find((candidate) => candidate.id === id)
  if (profile === undefined) throw new Error(`no profile ${id}`)
  return profile
}

type Segment = { startSeconds: number; lengthSeconds: number; fps: number }

/** The profile's plan with the segment the interface would put on it. */
function videoPlan(id: string, video: Segment): OutputPlan {
  const profile = profileOf(id)
  return { ...toOutputPlan(profile), animation: { ...profile.animation, video } }
}

async function fileOf(name: string): Promise<File> {
  return new File([await loadFixture(name)], name)
}

async function runOnce(file: File, plan: OutputPlan, extract?: VideoExtractor): Promise<JobReport> {
  const runner = createWorkerRunner(extract)
  try {
    return await runner.run({ id: file.name, file, plan })
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

const GRAY_STEPS: Segment = { startSeconds: 0, lengthSeconds: 2, fps: 8 }

afterEach(() => {
  vi.restoreAllMocks()
})

describe('a WebM through the real runner and worker', () => {
  it('comes out as a 320x320 sticker, decodable, with a coherent clip and verdict', async () => {
    const file = await fileOf('video-gray-steps.webm')
    const profile = profileOf('discord-sticker-gif')
    const report = await runOnce(file, videoPlan('discord-sticker-gif', GRAY_STEPS))

    expect(report.ok, JSON.stringify(!report.ok && report.error)).toBe(true)
    if (!report.ok) return
    const { outcome } = report.value

    expect(outcome.format).toBe('gif')
    expect([outcome.width, outcome.height]).toEqual([320, 320])
    // The weight "before" is the video file the user dropped.
    expect(outcome.bytesBefore).toBe(file.size)
    expect(outcome.bytesAfter).toBe(outcome.output.length)
    expect(outcome.withinBudget).toBe(outcome.bytesAfter <= profile.maxBytes)
    expect(outcome.animation?.frames).toBeGreaterThan(1)

    const clip = outcome.animation?.clip
    expect(clip?.startSeconds).toBe(0)
    expect(clip?.lengthSeconds).toBeCloseTo(2, 1)
    expect(clip?.sourceDurationSeconds).toBeCloseTo(2, 1)

    const seen = await inspect(outcome.output, mimeTypeOfKind(outcome.format))
    expect([seen.width, seen.height]).toEqual([320, 320])
    expect(seen.frames).toBe(outcome.animation?.frames)
  })

  it('comes out as an emoji of at most 128 px, never enlarged', async () => {
    const profile = profileOf('discord-emoji-gif')
    const report = await runOnce(
      await fileOf('video-gray-steps.webm'),
      videoPlan('discord-emoji-gif', GRAY_STEPS),
    )

    expect(report.ok).toBe(true)
    if (!report.ok) return
    const { outcome } = report.value

    expect(outcome.width).toBeLessThanOrEqual(128)
    expect(outcome.height).toBeLessThanOrEqual(128)
    expect(outcome.withinBudget).toBe(outcome.bytesAfter <= profile.maxBytes)
    const seen = await inspect(outcome.output, 'image/gif')
    expect([seen.width, seen.height]).toEqual([outcome.width, outcome.height])
    expect(seen.frames).toBeGreaterThan(1)
  })

  it('writes an APNG when the profile asks for one', async () => {
    const report = await runOnce(
      await fileOf('video-gray-steps.webm'),
      videoPlan('discord-sticker-apng', GRAY_STEPS),
    )

    expect(report.ok).toBe(true)
    if (!report.ok) return
    expect(report.value.outcome.format).toBe('apng')
    const seen = await inspect(report.value.outcome.output, 'image/apng')
    expect([seen.width, seen.height]).toEqual([320, 320])
  })

  it('keeps only the segment asked for, and says which one', async () => {
    const report = await runOnce(
      await fileOf('video-colors.webm'),
      videoPlan('discord-emoji-gif', { startSeconds: 1, lengthSeconds: 1, fps: 8 }),
    )

    expect(report.ok).toBe(true)
    if (!report.ok) return
    expect(report.value.outcome.animation?.clip).toMatchObject({ startSeconds: 1 })
    expect(report.value.outcome.animation?.clip?.lengthSeconds).toBeCloseTo(1, 1)
  })

  it('a video that would not fit is a marked success, not an error', async () => {
    // A budget of 100 bytes cannot be met by any GIF.
    const plan = { ...videoPlan('discord-emoji-gif', GRAY_STEPS), maxBytes: 100 }
    const report = await runOnce(await fileOf('video-gray-steps.webm'), plan)

    expect(report.ok).toBe(true)
    if (report.ok) expect(report.value.outcome.withinBudget).toBe(false)
  })
})

describe('an MP4 (H.264)', () => {
  const canPlay = document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E"')
  if (canPlay === '') {
    console.warn(
      'SKIPPED: this browser cannot play H.264 in MP4 (canPlayType is empty), so the MP4 runner test does not run here.',
    )
  }

  it.skipIf(canPlay === '')('goes through the same route as a WebM', async () => {
    const report = await runOnce(
      await fileOf('video-gray-steps.mp4'),
      videoPlan('discord-sticker-gif', GRAY_STEPS),
    )

    expect(report.ok).toBe(true)
    if (!report.ok) return
    expect([report.value.outcome.width, report.value.outcome.height]).toEqual([320, 320])
    expect(report.value.outcome.animation?.clip?.sourceDurationSeconds).toBeCloseTo(2, 1)
  })
})

describe('the route is chosen by the bytes, not by the plan alone', () => {
  it('an animated GIF still works the same with a video segment on the plan', async () => {
    const withSegment = await runOnce(
      await fileOf('anim-opaque.gif'),
      videoPlan('discord-sticker-gif', GRAY_STEPS),
    )
    const plain = await runOnce(
      await fileOf('anim-opaque.gif'),
      toOutputPlan(profileOf('discord-sticker-gif')),
    )

    expect(withSegment.ok && plain.ok).toBe(true)
    if (!withSegment.ok || !plain.ok) return
    expect(withSegment.value.outcome.animation?.clip).toBeUndefined()
    expect(withSegment.value.outcome.bytesBefore).toBe(plain.value.outcome.bytesBefore)
    expect(withSegment.value.outcome.output).toEqual(plain.value.outcome.output)
  })

  it('bytes that are not a video take the animation route and its own typed error', async () => {
    // Not a video container, so the extractor never sees it (its own
    // `unsupported-video` is covered by the extractor tests and by the fakes below).
    const report = await runOnce(
      await fileOf('not-video.bin'),
      videoPlan('discord-sticker-gif', GRAY_STEPS),
    )

    expect(report.ok).toBe(false)
    if (!report.ok) {
      expect(report.error).toMatchObject({ code: 'animation-failed', reason: 'unsupported-format' })
    }
  })

  it('an audio-only file is a typed video error, not a crashed worker', async () => {
    const aac = document.createElement('audio').canPlayType('audio/mp4; codecs="mp4a.40.2"') !== ''
    const report = await runOnce(
      await fileOf('audio-only.m4a'),
      videoPlan('discord-sticker-gif', GRAY_STEPS),
    )

    expect(report.ok).toBe(false)
    if (report.ok) return
    expect(report.error).toMatchObject({
      code: 'video-failed',
      reason: aac ? 'no-video-track' : 'codec-unsupported',
    })
  })
})

describe('a failed extraction is a report, never a rejection', () => {
  const failing =
    (code: VideoError['code']): VideoExtractor =>
    () =>
      Promise.resolve(err({ code, message: `fake ${code}` }))

  it.each([
    'unsupported-video',
    'codec-unsupported',
    'no-video-track',
    'corrupt',
    'stalled',
    'aborted',
    'bad-options',
    'internal',
  ] as const)('%s', async (code) => {
    const report = await runOnce(
      await fileOf('video-gray-steps.webm'),
      videoPlan('discord-sticker-gif', GRAY_STEPS),
      failing(code),
    )

    expect(report).toEqual({
      ok: false,
      error: { code: 'video-failed', reason: code, detail: `fake ${code}` },
    })
  })

  it('passes the normalized segment and the layout to the extractor', async () => {
    const calls: Array<Parameters<VideoExtractor>[1]> = []
    const spy: VideoExtractor = (_file, options) => {
      calls.push(options)
      return Promise.resolve(err({ code: 'internal', message: 'stop' }))
    }
    await runOnce(
      await fileOf('video-gray-steps.webm'),
      videoPlan('discord-emoji-gif', { startSeconds: -3, lengthSeconds: 999, fps: 15 }),
      spy,
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ startSeconds: 0, lengthSeconds: 15, fps: 15 })
    expect(calls[0]?.fit).toEqual({ kind: 'emoji', maxSide: 128 })
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('terminate() aborts the extraction and the run settles instead of hanging', async () => {
    let seen: AbortSignal | undefined
    const waiting: VideoExtractor = (_file, options) =>
      new Promise((resolve) => {
        seen = options.signal
        options.signal?.addEventListener('abort', () =>
          resolve(err({ code: 'aborted', message: 'Cancelled.' })),
        )
      })
    const runner = createWorkerRunner(waiting)
    const running = runner.run({
      id: 'x',
      file: await fileOf('video-gray-steps.webm'),
      plan: videoPlan('discord-sticker-gif', GRAY_STEPS),
    })
    await vi.waitFor(() => expect(seen).toBeDefined())
    expect(seen?.aborted).toBe(false)

    runner.terminate()

    expect(seen?.aborted).toBe(true)
    await expect(running).resolves.toMatchObject({ error: { reason: 'aborted' } })
  })
})

describe('memory: the frames leave the main thread', () => {
  it('transfers 75 frames of 320x320 to the worker instead of cloning them', async () => {
    const side = 320
    const frames: Frame[] = Array.from({ length: 75 }, (_, k) => {
      const data = new Uint8ClampedArray(side * side * 4)
      for (let at = 0; at < data.length; at += 4) {
        data[at] = (k * 3 + (at >> 8)) & 255
        data[at + 1] = 90
        data[at + 2] = 160
        data[at + 3] = 255
      }
      return { data, width: side, height: side, delayMs: 66 }
    })
    const before = frames.reduce((sum, frame) => sum + frame.data.byteLength, 0)
    expect(before).toBe(75 * 320 * 320 * 4)

    const extract: VideoExtractor = () =>
      Promise.resolve(
        ok({
          frames,
          width: side,
          height: side,
          repeatedFrames: 0,
          source: { durationSeconds: 5, width: 1920, height: 1080 },
          clip: { startSeconds: 0, lengthSeconds: 5 },
        }),
      )
    const report = await runOnce(
      await fileOf('video-gray-steps.webm'),
      videoPlan('discord-sticker-gif', { startSeconds: 0, lengthSeconds: 5, fps: 15 }),
      extract,
    )

    expect(report.ok, JSON.stringify(!report.ok && report.error)).toBe(true)
    // A transferred buffer is detached: 30 MB that the main thread no longer
    // holds (a clone would have left every one of them at full length).
    const after = frames.reduce((sum, frame) => sum + frame.data.byteLength, 0)
    expect(after).toBe(0)
    if (report.ok) expect(report.value.outcome.animation?.frames).toBeGreaterThan(1)
  }, 60_000)
})

describe('cancelling in the real queue', () => {
  function realStore() {
    return createQueueStore({
      createPool: (onEvent) =>
        createPool({ concurrency: 2, createRunner: () => createWorkerRunner(), onEvent }),
      newId: () => crypto.randomUUID(),
    })
  }

  const statusOf = (items: readonly QueueItem[], name: string): string | undefined =>
    items.find((item) => item.name === name)?.status

  it('stops an extraction halfway: the <video> is released, the URL revoked, the pool is not stuck', async () => {
    const created: string[] = []
    const revoked: string[] = []
    const create = URL.createObjectURL.bind(URL)
    const revoke = URL.revokeObjectURL.bind(URL)
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      const url = create(blob)
      created.push(url)
      return url
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
      revoked.push(url)
      revoke(url)
    })

    const store = realStore()
    const video = await fileOf('video-colors.webm')
    const gif = await fileOf('anim-opaque.gif')
    store.getState().add([video])
    const [item] = store.getState().items
    if (item === undefined) throw new Error('no row')

    // 3 s of clip: the extraction plays for about 3 s.
    store
      .getState()
      .start(videoPlan('discord-sticker-gif', { startSeconds: 0, lengthSeconds: 3, fps: 10 }))
    await vi.waitFor(() => expect(created).toHaveLength(1), { timeout: 5000 })
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(statusOf(store.getState().items, video.name)).toBe('running')

    const cancelledAt = performance.now()
    store.getState().cancel(item.id)
    expect(statusOf(store.getState().items, video.name)).toBe('cancelled')

    // The element is let go long before the 3 s clip would have ended.
    await vi.waitFor(() => expect(revoked).toEqual(created), { timeout: 2000 })
    expect(performance.now() - cancelledAt).toBeLessThan(1500)
    expect(document.querySelectorAll('video')).toHaveLength(0)

    // A cancelled job never reports afterwards, even once its clip would have ended.
    await new Promise((resolve) => setTimeout(resolve, 3000))
    expect(statusOf(store.getState().items, video.name)).toBe('cancelled')

    // The queue is not stuck: a new file runs to the end.
    store.getState().add([gif])
    const second = store.getState().items.find((row) => row.name === gif.name)
    if (second === undefined) throw new Error('no second row')
    store.getState().requeue([second.id], toOutputPlan(profileOf('discord-emoji-gif')))
    await vi.waitFor(() => expect(statusOf(store.getState().items, gif.name)).toBe('done'), {
      timeout: 30_000,
    })
    store.getState().clear()
  }, 60_000)

  it('cancelling a video that waits its turn never starts it', async () => {
    const store = realStore()
    const first = new File([await loadFixture('video-colors.webm')], 'uno.webm')
    const second = new File([await loadFixture('video-gray-steps.webm')], 'dos.webm')
    store.getState().add([first, second])
    const played: string[] = []
    const create = URL.createObjectURL.bind(URL)
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      played.push(blob instanceof File ? blob.name : '?')
      return create(blob)
    })

    store
      .getState()
      .start(videoPlan('discord-sticker-gif', { startSeconds: 0, lengthSeconds: 2, fps: 10 }))
    // Both rows are running (concurrency 2), but only one plays. Which one is
    // decided by who reads its first bytes first, so the test asks.
    await vi.waitFor(() => expect(played).toHaveLength(1), { timeout: 5000 })
    const playing = played[0] ?? ''
    const waitingName = playing === 'uno.webm' ? 'dos.webm' : 'uno.webm'
    const waiting = store.getState().items.find((row) => row.name === waitingName)
    if (waiting === undefined) throw new Error('no row')
    store.getState().cancel(waiting.id)

    await vi.waitFor(() => expect(statusOf(store.getState().items, playing)).toBe('done'), {
      timeout: 30_000,
    })
    // The cancelled one never made its own URL.
    expect(played).toEqual([playing])
    expect(statusOf(store.getState().items, waitingName)).toBe('cancelled')
    store.getState().clear()
  }, 60_000)

  it('plays one video at a time even when the pool runs several jobs at once', async () => {
    let open = 0
    let most = 0
    const create = URL.createObjectURL.bind(URL)
    const revoke = URL.revokeObjectURL.bind(URL)
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      open += 1
      most = Math.max(most, open)
      return create(blob)
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
      open -= 1
      revoke(url)
    })

    const store = realStore()
    const files = [
      new File([await loadFixture('video-gray-steps.webm')], 'a.webm'),
      new File([await loadFixture('video-gray-steps.webm')], 'b.webm'),
    ]
    store.getState().add(files)
    store
      .getState()
      .start(videoPlan('discord-emoji-gif', { startSeconds: 0, lengthSeconds: 1, fps: 8 }))

    await vi.waitFor(
      () => {
        expect(statusOf(store.getState().items, 'a.webm')).toBe('done')
        expect(statusOf(store.getState().items, 'b.webm')).toBe('done')
      },
      { timeout: 30_000 },
    )
    expect(most).toBe(1)
    store.getState().clear()
  }, 60_000)
})
