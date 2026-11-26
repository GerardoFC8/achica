import { createSerialQueue } from './serial-queue'
import {
  extractVideoFrames,
  type ExtractedVideo,
  type ExtractOptions,
  type VideoError,
} from './video-frames'
import { err, type Result } from '../core/result'

/**
 * The one queue every video extraction goes through, so the pool can start
 * many jobs at once and the main thread still plays one video at a time.
 */
const queue = createSerialQueue()

export function extractVideoFramesSerially(
  file: Blob,
  options: ExtractOptions,
): Promise<Result<ExtractedVideo, VideoError>> {
  return queue.run(() => extractVideoFrames(file, options), {
    signal: options.signal,
    whenAborted: () => err({ code: 'aborted', message: 'Cancelled.' }),
  })
}
