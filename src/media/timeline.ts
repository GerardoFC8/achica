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
 * The reference, non-streaming version: for each target, the index of the
 * presented frame whose media time is the nearest (the earlier one on a tie).
 * `mediaTimes` must be ascending. The streaming selector below must agree with
 * it, and the tests check that on random inputs.
 */
export function nearestFrameIndices(
  targets: readonly number[],
  mediaTimes: readonly number[],
): number[] {
  return targets.map((target) => {
    let best = 0
    for (let i = 1; i < mediaTimes.length; i += 1) {
      const distance = Math.abs((mediaTimes[i] ?? 0) - target)
      if (distance < Math.abs((mediaTimes[best] ?? 0) - target)) best = i
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
 */
export type NearestSelector = {
  feed(mediaTime: number): { readonly skip: boolean; readonly served: number }
  /** The stream ended: everything unresolved goes to the last frame. 0 if there was none. */
  flush(): number
  readonly resolved: number
  readonly done: boolean
}

export function createNearestSelector(targets: readonly number[]): NearestSelector {
  let next = 0
  let previous: number | null = null
  return {
    feed(mediaTime) {
      if (previous !== null && !(mediaTime > previous)) return { skip: true, served: 0 }
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
    flush() {
      if (previous === null) return 0
      const served = targets.length - next
      next = targets.length
      return served
    },
    get resolved() {
      return next
    },
    get done() {
      return next >= targets.length
    },
  }
}
