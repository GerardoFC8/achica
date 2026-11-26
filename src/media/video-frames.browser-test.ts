import { afterEach, describe, expect, it, vi } from 'vitest'
import { grayOfSourceFrame, loadVideoBlob, pixelAt } from '../../test/helpers/video-fixtures'
import { extractVideoFrames, type ExtractedVideo, type ExtractOptions } from './video-frames'

/*
 * The oracle is independent of the extractor: video-gray-steps has a flat gray
 * of level 8 + 16k in source frame k (8 fps, 16 frames), so the pixel value of
 * an extracted frame says which SOURCE frame it came from. A shift by one
 * frame is 16 levels.
 */

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

/** The source frame an extracted frame came from, read from its flat gray. */
function sourceFrameOf(video: ExtractedVideo, index: number): number {
  return Math.round((centreGray(video, index) - grayOfSourceFrame(0)) / 16)
}

/**
 * The guarantee that holds under load. Playing in real time may lose frames
 * when the machine is busy (125 of 150 presented were measured in Firefox
 * while other files ran, and a run of three lost in a row was seen in the full
 * suite), and a frame may be drawn a little after the one its callback
 * reported, so a target may get a neighbour some frames away. What must never
 * happen is a SHIFT or a jump back. So:
 *
 * - the first frame is within one source frame of the first target (it is read
 *   after a seek, not from playback);
 * - no frame is more than three source frames from its target;
 * - the order never goes back;
 * - most frames are exact: a shift of one frame everywhere has none that is
 *   (that is what this catches), while a loaded machine spoils a minority.
 */
function expectNoShiftNorReorder(video: ExtractedVideo, sources: readonly number[]): void {
  // Targets served by the same presented frame are fused into one frame, so
  // `repeatedFrames` fewer frames than targets come out. Frame j then serves
  // some target between j and j + repeatedFrames: that is the window its
  // source frame is checked against (no window at all when nothing was fused).
  const fused = video.repeatedFrames
  expect(video.frames).toHaveLength(sources.length - fused)
  const seen = video.frames.map((_, index) => sourceFrameOf(video, index))
  const nearest = (index: number): number => {
    const seenFrame = seen[index] ?? 0
    const window = sources.slice(index, index + fused + 1)
    return seenFrame - (window.find((s) => Math.abs(s - seenFrame) <= 1) ?? window[0] ?? 0)
  }
  const offsets = seen.map((_, index) => nearest(index))

  expect(Math.abs(offsets[0] ?? 0), 'the first frame is the first target').toBeLessThanOrEqual(1)
  offsets.forEach((offset, index) => {
    expect(
      Math.abs(offset),
      `frame ${index} is source ${seen[index]}, wanted ${sources[index]}`,
    ).toBeLessThanOrEqual(3)
  })
  for (let i = 1; i < seen.length; i += 1) {
    expect(seen[i] ?? 0, `frame ${i} went back`).toBeGreaterThanOrEqual(seen[i - 1] ?? 0)
  }
  const exact = offsets.filter((offset) => Math.abs(offset) <= (fused > 0 ? 1 : 0)).length
  expect(
    exact,
    `only ${exact} of ${offsets.length} frames are the one wanted: a shift`,
  ).toBeGreaterThanOrEqual(offsets.length / 2)
  expect(fused).toBeGreaterThanOrEqual(0)
}

/** What fusing guarantees: no two consecutive output frames show the same source frame. */
function expectNoConsecutiveDuplicates(video: ExtractedVideo): void {
  for (let i = 1; i < video.frames.length; i += 1) {
    expect(
      sourceFrameOf(video, i),
      `frame ${i} repeats the source frame of the one before`,
    ).toBeGreaterThan(sourceFrameOf(video, i - 1))
  }
}

const sumOfDelays = (video: ExtractedVideo): number =>
  video.frames.reduce((sum, frame) => sum + frame.delayMs, 0)

const range = (from: number, count: number, step = 1): number[] =>
  Array.from({ length: count }, (_, i) => from + i * step)

describe('extractVideoFrames, WebM (VP9)', () => {
  it('has no shift and no reordering at 8 fps over an 8 fps video, even if a frame repeats under load', async () => {
    const spies = spyOnObjectUrls()
    const video = await extractOk('video-gray-steps.webm')
    expectNoShiftNorReorder(video, range(0, 16))
    expectClean(spies)
  })

  it('counts the targets it fused, and few when the rate is below the source rate', async () => {
    // Sampling every other source frame serves a presented frame twice only when
    // playback lost one, and a loaded machine does lose them (125 of 150 were
    // measured in Firefox). So this asserts "well below the by-design fusions
    // of the dense case", not "none": half of the 8 targets is the line.
    const sparse = await extractOk('video-gray-steps.webm', { fps: 4 })
    expect(sparse.repeatedFrames).toBeLessThanOrEqual(4)
    expect(sparse.frames.length + sparse.repeatedFrames).toBe(8)

    // Above the source rate the fusions are by design: 16 fps over 8 fps video
    // is 16 targets for 8 presented frames.
    const dense = await extractOk('video-gray-steps.webm', { fps: 16, lengthSeconds: 1 })
    expect(dense.repeatedFrames).toBeGreaterThanOrEqual(6)
    expect(dense.frames.length + dense.repeatedFrames).toBe(16)
  })

  it('takes every other source frame at 4 fps', async () => {
    const video = await extractOk('video-gray-steps.webm', { fps: 4 })
    expectNoShiftNorReorder(video, range(0, 8, 2))
  })

  it('starts at the requested second, without skipping or repeating the first frame', async () => {
    const video = await extractOk('video-gray-steps.webm', { startSeconds: 1, lengthSeconds: 1 })
    expectNoShiftNorReorder(video, range(8, 8))
    expect(video.clip).toEqual({ startSeconds: 1, lengthSeconds: 1 })
  })

  it('clips the length to what is left of the video', async () => {
    const video = await extractOk('video-gray-steps.webm', { startSeconds: 1.5, lengthSeconds: 5 })
    expect(video.clip.startSeconds).toBe(1.5)
    expect(video.clip.lengthSeconds).toBeCloseTo(0.5, 2)
    expectNoShiftNorReorder(video, range(12, 4))
    expect(video.source.durationSeconds).toBeCloseTo(2, 1)
    expect(video.source.width).toBe(160)
    expect(video.source.height).toBe(90)
  })

  it('never exceeds the video rate: 16 fps asked over 8 fps gives the 8 frames, in order', async () => {
    const video = await extractOk('video-gray-steps.webm', { fps: 16, lengthSeconds: 1 })
    // Eight presented frames in that second; playback can only lose some.
    expect(video.frames.length).toBeLessThanOrEqual(8)
    expect(video.frames.length).toBeGreaterThanOrEqual(5)
    expectNoConsecutiveDuplicates(video)
    expectNoShiftNorReorder(video, range(0, 16, 0.5).map(Math.floor))
    const last = sourceFrameOf(video, video.frames.length - 1)
    expect(Math.abs(last - 7)).toBeLessThanOrEqual(1)
  })

  it('a frame stays as long as it was really on screen: 125 ms at 8 fps, asked at 16', async () => {
    const video = await extractOk('video-gray-steps.webm', { fps: 16, lengthSeconds: 1 })
    expect(sumOfDelays(video)).toBe(1000)
    // The 15-over-10 case of the bug: slicing the 16 fps timeline would give
    // 62/63 ms. A presented frame lasts 125 ms, or a multiple if playback lost
    // the one after it.
    for (const frame of video.frames) expect(frame.delayMs).toBeGreaterThanOrEqual(120)
    if (video.repeatedFrames === 8) {
      for (const frame of video.frames) expect(Math.abs(frame.delayMs - 125)).toBeLessThanOrEqual(2)
    }
    expect(video.effectiveFps).toBeCloseTo((video.frames.length * 1000) / 1000, 5)
    expect(video.effectiveFps).toBeLessThanOrEqual(8.01)
  })

  it('at a rate below the source rate the result is the one it always was', async () => {
    const video = await extractOk('video-gray-steps.webm', { fps: 4 })
    expect(sumOfDelays(video)).toBe(Math.round(video.clip.lengthSeconds * 1000))
    // Nothing fused (the usual case): every frame is one 250 ms slot, as before.
    if (video.repeatedFrames === 0) {
      expect(video.frames).toHaveLength(8)
      expect(video.frames.every((frame) => frame.delayMs === 250)).toBe(true)
      expect(video.effectiveFps).toBeCloseTo(4, 5)
    }
  })

  it('delays come from the timeline and add up to the extracted length', async () => {
    const video = await extractOk('video-gray-steps.webm', { fps: 5 })
    expect(sumOfDelays(video)).toBe(Math.round(video.clip.lengthSeconds * 1000))
    if (video.repeatedFrames === 0) {
      expect(video.frames).toHaveLength(10)
      expect(video.frames.every((frame) => frame.delayMs === 200)).toBe(true)
    }
  })

  it('asked at exactly the video rate, nothing is fused and every frame lasts 125 ms', async () => {
    const video = await extractOk('video-gray-steps.webm', { fps: 8, lengthSeconds: 1 })
    expect(sumOfDelays(video)).toBe(1000)
    expect(video.frames.length + video.repeatedFrames).toBe(8)
    if (video.repeatedFrames === 0) {
      expect(video.frames.every((frame) => Math.abs(frame.delayMs - 125) <= 1)).toBe(true)
    }
  })

  it('reports progress up to the total', async () => {
    const calls: Array<[number, number]> = []
    await extractOk('video-gray-steps.webm', {
      lengthSeconds: 1,
      onProgress: (done, total) => calls.push([done, total]),
    })
    expect(calls.length).toBeGreaterThan(0)
    // Progress counts targets resolved, fused ones included, so it still ends at the total.
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
  it.skipIf(canPlay === '')('has no shift and no reordering', async () => {
    const video = await extractOk('video-gray-steps.mp4')
    expectNoShiftNorReorder(video, range(0, 16))
  })
  it.skipIf(canPlay === '')('starts at the requested second', async () => {
    const video = await extractOk('video-gray-steps.mp4', { startSeconds: 1, lengthSeconds: 1 })
    expectNoShiftNorReorder(video, range(8, 8))
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
