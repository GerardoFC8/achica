/**
 * Which part of a video becomes the animation, as it travels in the plan.
 *
 * The caps here are achica's own: they bound the memory and the time of one
 * extraction (225 frames of 320 x 320 are about 90 MB of RGBA). They are NOT a
 * Discord limit: D61 measured that Discord enforces only the byte weight.
 */

export const MAX_CLIP_SECONDS = 15
export const MAX_CLIP_FRAMES = 225

/** The segment the plan carries; the interface sets it, no profile does. */
export type VideoSegment = {
  readonly startSeconds: number
  readonly lengthSeconds: number
  readonly fps: number
}

export const DEFAULT_VIDEO_SEGMENT: VideoSegment = {
  startSeconds: 0,
  lengthSeconds: 5,
  fps: 15,
}

/** Bounds for the frame rate a user may ask for. */
export const MIN_VIDEO_FPS = 1
export const MAX_VIDEO_FPS = 30

const finiteOr = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

/**
 * A segment that can always be extracted: missing or non-finite fields take
 * the defaults, the start is never negative, the rate stays in its bounds and
 * the length never exceeds the caps (the extractor clips to the video's own
 * end, which only it knows).
 */
export function normalizeVideoSegment(partial: Partial<VideoSegment> = {}): VideoSegment {
  const fps = Math.min(
    MAX_VIDEO_FPS,
    Math.max(MIN_VIDEO_FPS, finiteOr(partial.fps, DEFAULT_VIDEO_SEGMENT.fps)),
  )
  const startSeconds = Math.max(
    0,
    finiteOr(partial.startSeconds, DEFAULT_VIDEO_SEGMENT.startSeconds),
  )
  const requested = finiteOr(partial.lengthSeconds, DEFAULT_VIDEO_SEGMENT.lengthSeconds)
  const lengthSeconds = Math.min(
    MAX_CLIP_SECONDS,
    MAX_CLIP_FRAMES / fps,
    Math.max(1 / fps, requested),
  )
  return { startSeconds, lengthSeconds, fps }
}

/** Why a video could not become frames. `detail` is for logs; the interface words its own message. */
export type VideoFailureReason =
  /** Not an MP4 or WebM by its bytes (includes an empty file). */
  | 'unsupported-video'
  /** The browser cannot decode it: HEVC is the expected case. */
  | 'codec-unsupported'
  /** Audio only. */
  | 'no-video-track'
  | 'corrupt'
  /** No frame arrived in time: usually a tab that is not visible. */
  | 'stalled'
  | 'aborted'
  /** fps, start or length that cannot work. */
  | 'bad-options'
  /** Anything unforeseen; kept as a value so it cannot look like a crashed worker. */
  | 'internal'

/** What was cut out of the video, so the row can say what the user chose to keep. */
export type ClipInfo = {
  readonly startSeconds: number
  readonly lengthSeconds: number
  readonly sourceDurationSeconds: number
}
