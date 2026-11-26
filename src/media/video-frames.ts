import { planFit, type FitMode } from '../core/animation/fit'
import type { Frame } from '../core/animation/types'
import type { VideoFailureReason } from '../core/animation/video-segment'
import { err, ok, type Result } from '../core/result'
import { SNIFF_BYTES, sniffVideoContainer } from './sniff'
import {
  createNearestSelector,
  frameDelays,
  MAX_CLIP_FRAMES,
  MAX_CLIP_SECONDS,
  planClip,
  targetTimes,
} from './timeline'

/**
 * Extracts a clip of a video (MP4 or WebM) as RGBA frames already at their
 * final size, on the main thread.
 *
 * It lives in media/ and not in core/ because it needs the <video> element,
 * which does not exist in a worker: the frames are made here, small, and then
 * handed to the worker that searches for the byte budget.
 *
 * Decisions that are not obvious:
 *
 * - The main method PLAYS the video and captures with requestVideoFrameCallback.
 *   The obvious alternative, jumping with `currentTime` once per frame, was
 *   measured on a 1080p H.264 file of 60 s (default GOP, Windows): 75 jumps
 *   from second 0 took 7.6 s in Chromium and 40 s in Firefox, and from second
 *   30 they took 13.5 s and 149 s (2 s per jump), because every jump decodes
 *   again from the previous key frame. Playing and capturing takes as long as
 *   the clip lasts (5 s for 5 s), whatever the resolution. Seeking is kept
 *   only as the fallback for a browser without requestVideoFrameCallback.
 * - Each chosen frame is drawn straight to a canvas of the FINAL size and
 *   read from there. Frames at source size are never kept: 150 frames of 1080p
 *   are over 1 GB.
 * - Only the previous presented frame is held (see NearestSelector in
 *   timeline.ts): a target is served by the nearest presented frame by media
 *   time, and that is known once the next one arrives.
 * - Every wait has a timeout and none uses requestAnimationFrame. `seeked`
 *   never fires when currentTime already has the value (frame 0), nor with an
 *   unknown duration, and a hidden tab presents no frames at all: that case is
 *   the typed error 'stalled', never a hang.
 * - The route is chosen by bytes (sniff.ts), not by extension or `file.type`.
 * - Failures are values, and the single <video> is never added to the page;
 *   its object URL is revoked and its source released on every path.
 *
 * - UNDER LOAD FRAMES ARE REPEATED. Playing in real time means the browser may
 *   drop frames when the machine is busy (measured: 125 of 150 presented in
 *   Firefox while other test files ran). The nearest-frame rule keeps the
 *   timeline honest: a dropped frame is served by its neighbour, so the result
 *   is never shifted and never out of order, but some frames repeat.
 *   `repeatedFrames` counts them (it also counts the repeats that are by
 *   design when the target rate is above the source rate).
 *
 * Not handled, and said so: rotation stored in the metadata (phone videos) is
 * whatever the browser reports as videoWidth/Height; variable frame rate is
 * covered only because targets are chosen by media time.
 */

export { MAX_CLIP_FRAMES, MAX_CLIP_SECONDS }

export const DEFAULT_STALL_MS = 4000

/** Metadata and seeks may be slow on a big file; they get at least this long. */
const MIN_LOAD_WAIT_MS = 10_000

/** The reasons are the core's (they travel in the job's error); see VideoFailureReason. */
export type VideoErrorCode = VideoFailureReason

export type VideoError = { readonly code: VideoErrorCode; readonly message: string }

export type ExtractOptions = {
  readonly startSeconds: number
  readonly lengthSeconds: number
  readonly fps: number
  readonly fit: FitMode
  readonly signal?: AbortSignal
  readonly onProgress?: (done: number, total: number) => void
  /** How long without a frame counts as stalled. Default 4000. */
  readonly stallMs?: number
}

export type ExtractedVideo = {
  /** RGBA at the final size, `delayMs` from the timeline. */
  readonly frames: Frame[]
  readonly width: number
  readonly height: number
  readonly source: {
    readonly durationSeconds: number
    readonly width: number
    readonly height: number
  }
  /**
   * Output frames that repeat the presented frame of the one before: dropped
   * frames under load (see the header), plus the repeats by design when the
   * target rate is above the source rate. Zero means one presented frame each.
   */
  readonly repeatedFrames: number
  /** What was really extracted, after clipping to the video and to the caps. */
  readonly clip: { readonly startSeconds: number; readonly lengthSeconds: number }
}

const fail = (code: VideoErrorCode, message: string): Result<never, VideoError> =>
  err({ code, message })

const STALLED_MESSAGE =
  'No video frame was presented in time. Keep this tab visible while the video is read: ' +
  'browsers do not present frames of a hidden tab.'

type Wake = 'event' | 'error' | 'timeout' | 'aborted'

/** Waits for one event of the element, or its `error`, or the timeout, or the abort. */
function waitFor(
  video: HTMLVideoElement,
  eventName: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<Wake> {
  return new Promise((resolve) => {
    const done = (wake: Wake): void => {
      clearTimeout(timer)
      video.removeEventListener(eventName, onEvent)
      video.removeEventListener('error', onError)
      signal?.removeEventListener('abort', onAbort)
      resolve(wake)
    }
    const onEvent = (): void => done('event')
    const onError = (): void => done('error')
    const onAbort = (): void => done('aborted')
    const timer = setTimeout(() => done('timeout'), timeoutMs)
    video.addEventListener(eventName, onEvent, { once: true })
    video.addEventListener('error', onError, { once: true })
    if (isAborted(signal)) done('aborted')
    else signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Where the element's error says the source stands. */
function describeMediaError(video: HTMLVideoElement): string {
  const error = video.error
  return error === null ? 'unknown media error' : `media error ${error.code}: ${error.message}`
}

type Canvas2D = {
  readonly canvas: HTMLCanvasElement
  readonly context: CanvasRenderingContext2D
}

type Geometry = {
  readonly sourceWidth: number
  readonly sourceHeight: number
  readonly width: number
  readonly height: number
  readonly contentWidth: number
  readonly contentHeight: number
  readonly offsetX: number
  readonly offsetY: number
}

function makeCanvas(geometry: Geometry): Canvas2D | null {
  const canvas = document.createElement('canvas')
  canvas.width = geometry.width
  canvas.height = geometry.height
  // Read back every frame: tells the browser to keep the pixels on the CPU.
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (context === null) return null
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  return { canvas, context }
}

/** Draws the element's current frame, reduced, into the content rectangle. Padding stays transparent. */
function drawFrame(target: Canvas2D, video: HTMLVideoElement, geometry: Geometry): void {
  target.context.clearRect(0, 0, geometry.width, geometry.height)
  target.context.drawImage(
    video,
    0,
    0,
    geometry.sourceWidth,
    geometry.sourceHeight,
    geometry.offsetX,
    geometry.offsetY,
    geometry.contentWidth,
    geometry.contentHeight,
  )
}

export async function extractVideoFrames(
  file: Blob,
  options: ExtractOptions,
): Promise<Result<ExtractedVideo, VideoError>> {
  try {
    return await extract(file, options)
  } catch (error) {
    return fail('internal', error instanceof Error ? error.message : 'unexpected failure')
  }
}

async function extract(
  file: Blob,
  options: ExtractOptions,
): Promise<Result<ExtractedVideo, VideoError>> {
  const { signal } = options
  const stallMs = options.stallMs ?? DEFAULT_STALL_MS
  const loadWaitMs = Math.max(stallMs, MIN_LOAD_WAIT_MS)
  if (isAborted(signal)) return fail('aborted', 'Cancelled.')

  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer())
  if (sniffVideoContainer(head) === null) {
    return fail('unsupported-video', 'The file is not an MP4 or WebM video.')
  }
  if (isAborted(signal)) return fail('aborted', 'Cancelled.')

  const url = URL.createObjectURL(file)
  // One element per extraction, never added to the document.
  const video = document.createElement('video')
  try {
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.playbackRate = 1
    video.src = url

    const loaded = await waitFor(video, 'loadedmetadata', loadWaitMs, signal)
    if (loaded === 'aborted') return fail('aborted', 'Cancelled.')
    if (loaded === 'error') {
      // Before the metadata, "source not supported" and "cannot decode" are the
      // same story for the user: this browser cannot read it (HEVC, mostly).
      return fail(
        'codec-unsupported',
        `The browser cannot play this video (${describeMediaError(video)}).`,
      )
    }
    if (loaded === 'timeout') return fail('stalled', STALLED_MESSAGE)

    const sourceWidth = video.videoWidth
    const sourceHeight = video.videoHeight
    if (sourceWidth === 0 || sourceHeight === 0) {
      return fail('no-video-track', 'The file has no video track (audio only).')
    }
    const durationSeconds = video.duration
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      return fail('corrupt', 'The video has no known duration.')
    }

    const plan = planClip({
      durationSeconds,
      startSeconds: options.startSeconds,
      lengthSeconds: options.lengthSeconds,
      fps: options.fps,
    })
    if (!plan.ok) return fail(plan.error.code, plan.error.message)

    const placement = planFit({ width: sourceWidth, height: sourceHeight }, options.fit)
    const geometry: Geometry = {
      sourceWidth,
      sourceHeight,
      width: placement.canvasWidth,
      height: placement.canvasHeight,
      contentWidth: placement.contentWidth,
      contentHeight: placement.contentHeight,
      offsetX: placement.offsetX,
      offsetY: placement.offsetY,
    }
    const targets = targetTimes(plan.value.startSeconds, options.fps, plan.value.frameCount)
    const delays = frameDelays(plan.value.frameCount, plan.value.lengthSeconds)

    const job: Job = {
      video,
      geometry,
      targets,
      delays,
      signal,
      stallMs,
      loadWaitMs,
      onProgress: options.onProgress,
      stats: { repeated: 0 },
    }
    const frames =
      typeof video.requestVideoFrameCallback === 'function'
        ? await captureByPlaying(job)
        : await captureBySeeking(job)
    if (!frames.ok) return frames
    return ok({
      frames: frames.value,
      width: geometry.width,
      height: geometry.height,
      repeatedFrames: job.stats.repeated,
      source: { durationSeconds, width: sourceWidth, height: sourceHeight },
      clip: {
        startSeconds: plan.value.startSeconds,
        lengthSeconds: plan.value.lengthSeconds,
      },
    })
  } finally {
    // Every path, error and cancellation included.
    video.pause()
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

type Job = {
  readonly video: HTMLVideoElement
  readonly geometry: Geometry
  readonly targets: readonly number[]
  readonly delays: readonly number[]
  readonly signal: AbortSignal | undefined
  readonly stallMs: number
  readonly loadWaitMs: number
  readonly onProgress: ((done: number, total: number) => void) | undefined
  /** Filled by the capture: how many output frames repeated the one before. */
  readonly stats: { repeated: number }
}

/** Reads the canvas into `count` frames (copies when a presented frame serves several targets). */
function readFrames(
  source: Canvas2D,
  geometry: Geometry,
  count: number,
  firstIndex: number,
  delays: readonly number[],
): Frame[] {
  const pixels = source.context.getImageData(0, 0, geometry.width, geometry.height).data
  return Array.from({ length: count }, (_, i) => ({
    data: i === 0 ? pixels : pixels.slice(),
    width: geometry.width,
    height: geometry.height,
    delayMs: delays[firstIndex + i] ?? 1,
  }))
}

/** The main method: play, and take the nearest presented frame to each target. */
function captureByPlaying(job: Job): Promise<Result<Frame[], VideoError>> {
  const { video, geometry, targets, delays, signal, stallMs, onProgress } = job
  const canvases = [makeCanvas(geometry), makeCanvas(geometry)]
  const [first, second] = canvases
  if (first === null || second === null || first === undefined || second === undefined) {
    return Promise.resolve(fail('internal', 'A 2D canvas is not available.'))
  }
  const pair: readonly [Canvas2D, Canvas2D] = [first, second]
  const selector = createNearestSelector(targets)
  const frames: Frame[] = []
  // Which canvas holds the previous presented frame; -1 before the first one.
  let previous: 0 | 1 | -1 = -1
  let playing = false
  // Whether any callback has reported a frame yet (see the seed below).
  let reported = false
  let finished = false
  let callbackId: number | null = null
  let stallTimer: ReturnType<typeof setTimeout> | undefined
  let endTimer: ReturnType<typeof setTimeout> | undefined

  return new Promise((resolve) => {
    const finish = (result: Result<Frame[], VideoError>): void => {
      if (finished) return
      finished = true
      clearTimeout(stallTimer)
      clearTimeout(endTimer)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('error', onError)
      signal?.removeEventListener('abort', onAbort)
      video.pause()
      if (callbackId !== null) video.cancelVideoFrameCallback(callbackId)
      resolve(result)
    }
    const armStall = (): void => {
      clearTimeout(stallTimer)
      stallTimer = setTimeout(() => finish(fail('stalled', STALLED_MESSAGE)), stallMs)
    }
    const commit = (served: number): void => {
      if (served <= 0 || previous === -1) return
      job.stats.repeated += served - 1
      const made = readFrames(pair[previous], geometry, served, frames.length, delays)
      for (const frame of made) frames.push(frame)
      onProgress?.(frames.length, targets.length)
    }
    const onFrame = (mediaTime: number): void => {
      const fed = selector.feed(mediaTime)
      if (fed.skip) return
      commit(fed.served)
      if (selector.done) {
        finish(ok(frames))
        return
      }
      previous = previous === 0 ? 1 : 0
      drawFrame(pair[previous], video, geometry)
    }
    const schedule = (): void => {
      callbackId = video.requestVideoFrameCallback((_now, metadata) => {
        if (finished) return
        reported = true
        if (playing) armStall()
        onFrame(metadata.mediaTime)
        if (!finished) schedule()
      })
    }
    const onEnded = (): void => {
      // The last frame's callback may still be on its way; give it a moment.
      endTimer = setTimeout(() => {
        commit(selector.flush())
        if (frames.length === 0) finish(fail('corrupt', 'The video ended without a frame.'))
        else finish(ok(frames))
      }, 100)
    }
    const onError = (): void =>
      finish(fail('corrupt', `Playback failed (${describeMediaError(video)}).`))
    const onAbort = (): void => finish(fail('aborted', 'Cancelled.'))

    video.addEventListener('ended', onEnded)
    video.addEventListener('error', onError)
    if (isAborted(signal)) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    const start = targets[0] ?? 0
    void (async () => {
      // Registered before the seek, so the frame the seek presents is not missed.
      schedule()
      // `seeked` does not fire when currentTime already has the value (frame 0).
      if (Math.abs(video.currentTime - start) > 1e-3) {
        video.currentTime = start
        const sought = await waitFor(video, 'seeked', job.loadWaitMs, signal)
        if (finished) return
        if (sought === 'timeout') return finish(fail('stalled', STALLED_MESSAGE))
        if (sought !== 'event') return // aborted or error: their own handlers finish
      }
      // The frame on screen now was presented BEFORE we asked for callbacks (frame
      // 0 on load, or the frame a seek landed on), so no callback will ever
      // report it, and without it the first target would get the next frame: a
      // shift of one. Unless a callback already reported the seek's frame, it is taken here, at the time the element says it shows.
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        const ready = await waitFor(video, 'loadeddata', job.loadWaitMs, signal)
        if (finished) return
        if (ready === 'timeout') return finish(fail('stalled', STALLED_MESSAGE))
        if (ready !== 'event') return
      }
      if (!reported) onFrame(video.currentTime)
      if (finished) return
      playing = true
      armStall()
      video.play().catch((error: unknown) => {
        const name = error instanceof DOMException ? error.name : ''
        if (name === 'NotSupportedError') {
          finish(fail('codec-unsupported', 'The browser cannot play this video.'))
        } else if (name !== 'AbortError') {
          finish(fail('stalled', STALLED_MESSAGE))
        }
      })
    })()
  })
}

/** The fallback: one seek per target. Slow on real video (see the header), but it works everywhere. */
async function captureBySeeking(job: Job): Promise<Result<Frame[], VideoError>> {
  const { video, geometry, targets, delays, signal, onProgress } = job
  const canvas = makeCanvas(geometry)
  if (canvas === null) return fail('internal', 'A 2D canvas is not available.')
  const frames: Frame[] = []
  for (const target of targets) {
    if (isAborted(signal)) return fail('aborted', 'Cancelled.')
    if (Math.abs(video.currentTime - target) > 1e-3) {
      video.currentTime = target
      const sought = await waitFor(video, 'seeked', job.loadWaitMs, signal)
      if (sought === 'aborted') return fail('aborted', 'Cancelled.')
      if (sought === 'error') return fail('corrupt', `Seek failed (${describeMediaError(video)}).`)
      if (sought === 'timeout') return fail('stalled', STALLED_MESSAGE)
    }
    drawFrame(canvas, video, geometry)
    for (const frame of readFrames(canvas, geometry, 1, frames.length, delays)) frames.push(frame)
    onProgress?.(frames.length, targets.length)
  }
  return ok(frames)
}

/** A function, not an inline test: TypeScript would keep a narrowed `false` across the awaits. */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}
