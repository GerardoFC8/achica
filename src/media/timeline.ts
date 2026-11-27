import { MAX_CLIP_FRAMES, MAX_CLIP_SECONDS } from '../core/animation/video-segment'
import { err, ok, type Result } from '../core/result'

/**
 * The arithmetic of a video extraction, kept apart from the <video> element so
 * Node can test every awkward case: which instants are wanted, which presented
 * frame is the nearest to each, how long each output frame stays, and how a
 * request is clipped to the video and to achica's own caps.
 */

/** achica's own caps (not Discord's): they live in the core, with the plan's segment. */
export { MAX_CLIP_FRAMES, MAX_CLIP_SECONDS }

export type ClipRequest = {
  readonly durationSeconds: number
  readonly startSeconds: number
  readonly lengthSeconds: number
  readonly fps: number
}

export type ClipPlan = {
  readonly startSeconds: number
  /** What is really extracted, after clipping to the video's end and to the caps. */
  readonly lengthSeconds: number
  readonly frameCount: number
}

export type ClipPlanError = { readonly code: 'bad-options'; readonly message: string }

const badOptions = (message: string): Result<never, ClipPlanError> =>
  err({ code: 'bad-options', message })

export function planClip(request: ClipRequest): Result<ClipPlan, ClipPlanError> {
  const { durationSeconds, startSeconds, lengthSeconds, fps } = request
  if (!Number.isFinite(fps) || fps <= 0 || fps > 120) {
    return badOptions('fps must be a number between 0 and 120.')
  }
  if (!Number.isFinite(startSeconds) || startSeconds < 0) {
    return badOptions('startSeconds must be zero or more.')
  }
  if (!Number.isFinite(lengthSeconds) || lengthSeconds <= 0) {
    return badOptions('lengthSeconds must be more than zero.')
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return badOptions('The video has no usable duration.')
  }
  const remaining = durationSeconds - startSeconds
  // Less than half a frame left would give zero frames: the start is past the end.
  if (remaining * fps < 0.5) return badOptions('The start is at or past the end of the video.')

  const length = Math.min(lengthSeconds, MAX_CLIP_SECONDS, remaining, MAX_CLIP_FRAMES / fps)
  const frameCount = Math.min(MAX_CLIP_FRAMES, Math.max(1, Math.round(length * fps)))
  return ok({ startSeconds, lengthSeconds: length, frameCount })
}

/** The instants a clip samples: `start + k / fps`. */
export function targetTimes(startSeconds: number, fps: number, frameCount: number): number[] {
  return Array.from({ length: frameCount }, (_, k) => startSeconds + k / fps)
}

/**
 * How long each output frame stays, in milliseconds.
 *
 * The frame boundaries sit at `round(k * length / count)`, so the rounding
 * error is carried instead of repeated: at 15 fps the delays are 67, 67, 66,
 * not 67 three times, and the total is exactly the clip length rounded once.
 * Every delay is at least 1 ms.
 */
export function frameDelays(frameCount: number, lengthSeconds: number): number[] {
  const boundary = (k: number): number => Math.round((k * lengthSeconds * 1000) / frameCount)
  return Array.from({ length: frameCount }, (_, k) => Math.max(1, boundary(k + 1) - boundary(k)))
}

/**
 * One output frame: the presented frame it shows, by media time, and how many
 * consecutive targets it served. `targets > 1` means the presented frame was
 * the nearest one to several targets in a row and those targets were fused
 * into this single frame (requested rate above the source's, or frames dropped
 * under load).
 */
export type PresentedRun = {
  readonly mediaTime: number
  readonly targets: number
}

/**
 * How long each output frame stays, in milliseconds, when consecutive targets
 * served by the same presented frame were fused.
 *
 * The delays must add up to the clip length (rounded once, as `frameDelays`
 * does), so they are the gaps between frame START boundaries, anchored at 0
 * and at the total. A frame starts:
 *
 * - at the media time of its presented frame (minus the clip start) when it or
 *   the frame before it is a fused one. That is when it really appeared on
 *   screen: a 10 fps source asked at 15 fps gives 100, 100, 100 and not the
 *   66, 133 that slicing the 15 fps timeline would give;
 * - otherwise at its slot on the uniform target timeline, exactly as
 *   `frameDelays` places it. So when nothing was fused the result IS
 *   `frameDelays`, and a stray fused frame under load only disturbs its two
 *   neighbours instead of the whole clip.
 *
 * Boundaries are kept strictly increasing (every delay is at least 1 ms).
 */
export function fusedDelays(
  runs: readonly PresentedRun[],
  startSeconds: number,
  lengthSeconds: number,
): number[] {
  const count = runs.length
  if (count === 0) return []
  const targetCount = runs.reduce((sum, run) => sum + run.targets, 0)
  if (targetCount === count) return frameDelays(count, lengthSeconds)

  const total = Math.max(count, Math.round(lengthSeconds * 1000))
  const boundaries: number[] = [0]
  let slot = 0
  runs.forEach((run, i) => {
    if (i > 0) {
      const fused = run.targets > 1 || (runs[i - 1]?.targets ?? 1) > 1
      const wanted = fused
        ? Math.round((run.mediaTime - startSeconds) * 1000)
        : Math.round((slot * total) / targetCount)
      const floor = (boundaries[i - 1] ?? 0) + 1
      const ceiling = total - (count - i)
      boundaries.push(Math.min(ceiling, Math.max(floor, wanted)))
    }
    slot += run.targets
  })
  boundaries.push(total)
  return runs.map((_, i) => (boundaries[i + 1] ?? total) - (boundaries[i] ?? 0))
}

/**
 * How close to the clip end a presented frame counts as already past it. The
 * end itself belongs to the NEXT segment (a frame presented at exactly
 * `start + length` is the first one after the clip), and media times reported
 * by the browser may land a hair below the container's timestamp. 1 ms is the
 * tolerance the capture already uses for seeks, and far below a frame interval.
 */
export const CLIP_END_EPSILON_SECONDS = 1e-3

/** Whether a presented frame is at or past the clip end, so it must serve no target. */
function pastEnd(mediaTime: number, endSeconds: number): boolean {
  return mediaTime >= endSeconds - CLIP_END_EPSILON_SECONDS
}

/**
 * The reference, non-streaming version: for each target, the index of the
 * presented frame whose media time is the nearest (the earlier one on a tie).
 * `mediaTimes` must be ascending. The streaming selector below must agree with
 * it, and the tests check that on random inputs.
 *
 * Frames at or past `endSeconds` are not candidates, except the very first
 * frame when nothing came before it (see `createNearestSelector`).
 */
export function nearestFrameIndices(
  targets: readonly number[],
  mediaTimes: readonly number[],
  endSeconds = Infinity,
): number[] {
  return targets.map((target) => {
    let best = 0
    for (let i = 1; i < mediaTimes.length; i += 1) {
      const time = mediaTimes[i] ?? 0
      if (pastEnd(time, endSeconds)) break
      if (Math.abs(time - target) < Math.abs((mediaTimes[best] ?? 0) - target)) best = i
    }
    return best
  })
}

/**
 * The same choice, made while the frames are still arriving, so only the
 * previous frame has to be kept (as pixels, at the final size).
 *
 * A target belongs to the previous frame once a newer one has arrived and the
 * target is not past the midpoint between them. `feed` says how many targets,
 * counting on from the first unresolved one, the PREVIOUS frame serves. The
 * current frame always becomes the new previous one.
 *
 * A frame whose media time does not advance (a repeat, or a seek going back)
 * is ignored: `skip` is true and nothing changes.
 *
 * THE CLIP END. A frame at or past `endSeconds` (the clip's start + length)
 * shows what comes AFTER the clip, so it never serves a target: when one
 * arrives, every unresolved target goes to the previous frame, as `flush`
 * does, and the selector is done. Without this, frames dropped just before the
 * end let the first frame of the next second serve the last target (blue in a
 * clip of green). The one exception is a first frame already past the end (a
 * gap in the video longer than the whole clip): it is kept, because it is the
 * nearest frame there is, and the alternative is a clip of zero frames.
 */
export type NearestSelector = {
  feed(mediaTime: number): { readonly skip: boolean; readonly served: number }
  /** The stream ended: everything unresolved goes to the last frame. 0 if there was none. */
  flush(): number
  readonly resolved: number
  readonly done: boolean
}

export function createNearestSelector(
  targets: readonly number[],
  endSeconds = Infinity,
): NearestSelector {
  let next = 0
  let previous: number | null = null
  const flush = (): number => {
    if (previous === null) return 0
    const served = targets.length - next
    next = targets.length
    return served
  }
  return {
    feed(mediaTime) {
      if (previous !== null && !(mediaTime > previous)) return { skip: true, served: 0 }
      // Past the end: the previous frame takes the rest and this one is never kept.
      if (previous !== null && pastEnd(mediaTime, endSeconds))
        return { skip: false, served: flush() }
      let served = 0
      if (previous !== null) {
        const midpoint = (previous + mediaTime) / 2
        while (next + served < targets.length && (targets[next + served] ?? Infinity) <= midpoint) {
          served += 1
        }
      }
      next += served
      previous = mediaTime
      return { skip: false, served }
    },
    flush,
    get resolved() {
      return next
    },
    get done() {
      return next >= targets.length
    },
  }
}
