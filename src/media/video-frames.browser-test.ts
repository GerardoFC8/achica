import { afterEach, describe, expect, it, vi } from 'vitest'
import { grayOfSourceFrame, loadVideoBlob, pixelAt } from '../../test/helpers/video-fixtures'
import { extractVideoFrames, type ExtractedVideo, type ExtractOptions } from './video-frames'

/*
 * The oracle is independent of the extractor: video-gray-steps has a flat gray
 * of level 8 + 16k in source frame k (8 fps, 16 frames), so the pixel value of
 * an extracted frame says which SOURCE frame it came from. A shift by one
 * frame is 16 levels; the tolerance for lossy coding is 6.
 */

const TOLERANCE = 6
const STICKER = { kind: 'sticker', size: 320 } as const

type Spies = { readonly created: string[]; readonly revoked: string[] }

/** Records every object URL made and revoked, and restores them afterwards. */
function spyOnObjectUrls(): Spies {
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
  return { created, revoked }
}

function expectClean(spies: Spies): void {
  expect(spies.revoked).toEqual(spies.created)
  expect(document.querySelectorAll('video')).toHaveLength(0)
}

afterEach(() => {
  vi.restoreAllMocks()
})

async function extractOk(
  name: string,
  options: Partial<ExtractOptions> = {},
): Promise<ExtractedVideo> {
  const result = await extractVideoFrames(await loadVideoBlob(name), {
    startSeconds: 0,
    lengthSeconds: 2,
    fps: 8,
    fit: STICKER,
    ...options,
  })
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.value
}

/** The gray at the centre of a frame, and the source frame it corresponds to. */
function centreGray(video: ExtractedVideo, index: number): number {
  const frame = video.frames[index]
  if (frame === undefined) throw new Error(`no frame ${index}`)
  return pixelAt(frame.data, frame.width, frame.width >> 1, frame.height >> 1)[0]
}

function expectSourceFrames(video: ExtractedVideo, sources: readonly number[]): void {
  expect(video.frames).toHaveLength(sources.length)
  sources.forEach((source, index) => {
    const gray = centreGray(video, index)
    expect(
      Math.abs(gray - grayOfSourceFrame(source)),
      `extracted frame ${index} should be source frame ${source} (gray ${grayOfSourceFrame(source)}), got gray ${gray}`,
    ).toBeLessThanOrEqual(TOLERANCE)
  })
}

const range = (from: number, count: number, step = 1): number[] =>
  Array.from({ length: count }, (_, i) => from + i * step)

describe('extractVideoFrames, WebM (VP9)', () => {
  it('gives every source frame once, in order, with no shift (8 fps over an 8 fps video)', async () => {
    const spies = spyOnObjectUrls()
    const video = await extractOk('video-gray-steps.webm')
    expectSourceFrames(video, range(0, 16))
    expectClean(spies)
  })

  it('takes every other source frame at 4 fps', async () => {
    const video = await extractOk('video-gray-steps.webm', { fps: 4 })
    expectSourceFrames(video, range(0, 8, 2))
  })

  it('starts at the requested second, without skipping or repeating the first frame', async () => {
    const video = await extractOk('video-gray-steps.webm', { startSeconds: 1, lengthSeconds: 1 })
    expectSourceFrames(video, range(8, 8))
    expect(video.clip).toEqual({ startSeconds: 1, lengthSeconds: 1 })
  })

  it('clips the length to what is left of the video', async () => {
    const video = await extractOk('video-gray-steps.webm', { startSeconds: 1.5, lengthSeconds: 5 })
    expect(video.clip.startSeconds).toBe(1.5)
    expect(video.clip.lengthSeconds).toBeCloseTo(0.5, 2)
    expectSourceFrames(video, range(12, 4))
    expect(video.source.durationSeconds).toBeCloseTo(2, 1)
    expect(video.source.width).toBe(160)
    expect(video.source.height).toBe(90)
  })

  it('repeats a frame when the target rate is above the source rate, still in order', async () => {
    const video = await extractOk('video-gray-steps.webm', { fps: 16, lengthSeconds: 1 })
    expect(video.frames).toHaveLength(16)
    const grays = video.frames.map((_, i) => centreGray(video, i))
    for (let i = 1; i < grays.length; i += 1) {
      expect(grays[i] ?? 0).toBeGreaterThanOrEqual((grays[i - 1] ?? 0) - TOLERANCE)
    }
    expect(Math.abs((grays[15] ?? 0) - grayOfSourceFrame(7))).toBeLessThanOrEqual(TOLERANCE)
  })

  it('delays come from the timeline and add up to the extracted length', async () => {
    const video = await extractOk('video-gray-steps.webm', { fps: 10 })
    expect(video.frames).toHaveLength(20)
    const total = video.frames.reduce((sum, frame) => sum + frame.delayMs, 0)
    expect(total).toBe(Math.round(video.clip.lengthSeconds * 1000))
    expect(video.frames.every((frame) => frame.delayMs === 100)).toBe(true)
  })

  it('reports progress up to the total', async () => {
    const calls: Array<[number, number]> = []
    await extractOk('video-gray-steps.webm', {
      lengthSeconds: 1,
      onProgress: (done, total) => calls.push([done, total]),
    })
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.at(-1)).toEqual([8, 8])
  })

  it('frames a wide video into the sticker canvas with transparent padding', async () => {
    const video = await extractOk('video-gray-steps.webm', { lengthSeconds: 0.5 })
    expect([video.width, video.height]).toEqual([320, 320])
    const frame = video.frames[0]
    if (frame === undefined) throw new Error('no frame')
    // 160x90 into 320: content 320x180, offset (0, 70).
    expect(pixelAt(frame.data, 320, 160, 10)[3]).toBe(0)
    expect(pixelAt(frame.data, 320, 160, 310)[3]).toBe(0)
    expect(pixelAt(frame.data, 320, 160, 160)[3]).toBe(255)
    expect(pixelAt(frame.data, 320, 2, 72)[3]).toBe(255)
    expect(frame.data.length).toBe(320 * 320 * 4)
  })

  it('frames a portrait video: sticker padded at the sides, emoji reduced and never enlarged', async () => {
    const sticker = await extractOk('video-portrait.webm', { lengthSeconds: 0.5 })
    expect([sticker.width, sticker.height]).toEqual([320, 320])
    const frame = sticker.frames[0]
    if (frame === undefined) throw new Error('no frame')
    // 90x160 into 320: content 180x320, offset (70, 0).
    expect(pixelAt(frame.data, 320, 10, 160)[3]).toBe(0)
    expect(pixelAt(frame.data, 320, 160, 160)[3]).toBe(255)

    const small = await extractOk('video-portrait.webm', {
      lengthSeconds: 0.5,
      fit: { kind: 'emoji', maxSide: 128 },
    })
    expect([small.width, small.height]).toEqual([72, 128])
    expect(small.frames[0]?.data.length).toBe(72 * 128 * 4)

    const never = await extractOk('video-portrait.webm', {
      lengthSeconds: 0.5,
      fit: { kind: 'emoji', maxSide: 512 },
    })
    expect([never.width, never.height]).toEqual([90, 160])
  })

  it('extracts only the requested segment: second 1 of red, green, blue is green', async () => {
    const video = await extractOk('video-colors.webm', { startSeconds: 1, lengthSeconds: 1 })
    expect(video.frames).toHaveLength(8)
    for (const frame of video.frames) {
      const [r, g, b] = pixelAt(frame.data, frame.width, frame.width >> 1, frame.height >> 1)
      // ffmpeg's "green" is (0, 128, 0), not full-intensity green.
      expect(g).toBeGreaterThan(90)
      expect(r).toBeLessThan(50)
      expect(b).toBeLessThan(50)
    }
  })

  it('leaves nothing behind after a success either', async () => {
    const spies = spyOnObjectUrls()
    await extractOk('video-colors.webm', { lengthSeconds: 0.5 })
    expect(spies.created).toHaveLength(1)
    expectClean(spies)
  })
})

describe('extractVideoFrames, MP4 (H.264)', () => {
  const canPlay = document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E"')
  if (canPlay === '') {
    console.warn(
      'SKIPPED: this browser cannot play H.264 in MP4 (canPlayType is empty), so the MP4 extraction test does not run here.',
    )
  }
  it.skipIf(canPlay === '')('gives every source frame once, in order', async () => {
    const video = await extractOk('video-gray-steps.mp4')
    expectSourceFrames(video, range(0, 16))
  })
  it.skipIf(canPlay === '')('starts at the requested second', async () => {
    const video = await extractOk('video-gray-steps.mp4', { startSeconds: 1, lengthSeconds: 1 })
    expectSourceFrames(video, range(8, 8))
  })
})

describe('extractVideoFrames, failures are typed values', () => {
  const base = { startSeconds: 0, lengthSeconds: 1, fps: 8, fit: STICKER } as const

  it('refuses bytes that are not a video, whatever the name or type says', async () => {
    const spies = spyOnObjectUrls()
    const noise = await loadVideoBlob('not-video.bin')
    const typed = new Blob([noise], { type: 'video/mp4' })
    for (const blob of [noise, typed]) {
      const result = await extractVideoFrames(blob, base)
      expect(!result.ok && result.error.code).toBe('unsupported-video')
    }
    expect(spies.created).toHaveLength(0)
  })

  it('refuses an empty blob', async () => {
    const result = await extractVideoFrames(new Blob([]), base)
    expect(!result.ok && result.error.code).toBe('unsupported-video')
  })

  it('an audio-only file is reported as having no video track (when the browser can play the audio)', async () => {
    const audio = document.createElement('audio')
    const canPlayAac = audio.canPlayType('audio/mp4; codecs="mp4a.40.2"') !== ''
    if (!canPlayAac) {
      console.warn('This browser cannot play AAC: audio-only files report codec-unsupported here.')
    }
    for (const name of ['audio-only.m4a', 'audio-only.mp4']) {
      const spies = spyOnObjectUrls()
      const result = await extractVideoFrames(await loadVideoBlob(name), base)
      expect(result.ok).toBe(false)
      expect(!result.ok && result.error.code).toBe(
        canPlayAac ? 'no-video-track' : 'codec-unsupported',
      )
      expectClean(spies)
      vi.restoreAllMocks()
    }
  })

  it('rejects options that cannot work', async () => {
    const blob = await loadVideoBlob('video-gray-steps.webm')
    for (const bad of [{ fps: 0 }, { startSeconds: 99 }, { lengthSeconds: -1 }]) {
      const spies = spyOnObjectUrls()
      const result = await extractVideoFrames(blob, { ...base, ...bad })
      expect(!result.ok && result.error.code).toBe('bad-options')
      expectClean(spies)
      vi.restoreAllMocks()
    }
  })

  it('cancels at once when the signal is already aborted', async () => {
    const result = await extractVideoFrames(await loadVideoBlob('video-gray-steps.webm'), {
      ...base,
      signal: AbortSignal.abort(),
    })
    expect(!result.ok && result.error.code).toBe('aborted')
  })

  it('stops the loop when aborted halfway, and leaves the page clean', async () => {
    const spies = spyOnObjectUrls()
    const controller = new AbortController()
    const started = performance.now()
    const run = extractVideoFrames(await loadVideoBlob('video-colors.webm'), {
      ...base,
      lengthSeconds: 3,
      signal: controller.signal,
      onProgress: (done) => {
        if (done === 4) controller.abort()
      },
    })
    const result = await run
    expect(!result.ok && result.error.code).toBe('aborted')
    // Aborting at about 0.5 s of a 3 s clip must not wait for the clip to end.
    expect(performance.now() - started).toBeLessThan(2500)
    expect(spies.created).toHaveLength(1)
    expectClean(spies)
    // And the element really stopped: nothing keeps presenting frames afterwards.
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(document.querySelectorAll('video')).toHaveLength(0)
  })

  it('reports stalled, naming the visible tab, when no frame is ever presented', async () => {
    // A player that never advances: play() resolves and nothing is presented,
    // which is what a hidden tab does to requestVideoFrameCallback.
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
    const spies = spyOnObjectUrls()
    const started = performance.now()
    const result = await extractVideoFrames(await loadVideoBlob('video-gray-steps.webm'), {
      ...base,
      stallMs: 300,
    })
    expect(!result.ok && result.error.code).toBe('stalled')
    expect(!result.ok && result.error.message).toMatch(/visible/i)
    expect(performance.now() - started).toBeLessThan(5000)
    expectClean(spies)
  })
})
