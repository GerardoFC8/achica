import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VIDEO_SEGMENT,
  MAX_CLIP_FRAMES,
  MAX_CLIP_SECONDS,
  MAX_VIDEO_FPS,
  MIN_VIDEO_FPS,
  normalizeVideoSegment,
} from './video-segment'

describe('the default segment', () => {
  it('starts at zero and takes five seconds at 15 fps', () => {
    expect(DEFAULT_VIDEO_SEGMENT).toEqual({ startSeconds: 0, lengthSeconds: 5, fps: 15 })
  })

  it('is its own fixed point', () => {
    expect(normalizeVideoSegment(DEFAULT_VIDEO_SEGMENT)).toEqual(DEFAULT_VIDEO_SEGMENT)
    expect(normalizeVideoSegment()).toEqual(DEFAULT_VIDEO_SEGMENT)
  })
})

describe('normalizeVideoSegment', () => {
  it('keeps a reasonable request as it is', () => {
    expect(normalizeVideoSegment({ startSeconds: 3.5, lengthSeconds: 4, fps: 12 })).toEqual({
      startSeconds: 3.5,
      lengthSeconds: 4,
      fps: 12,
    })
  })

  it('fills what is missing and what is not a number with the defaults', () => {
    expect(normalizeVideoSegment({ startSeconds: Number.NaN, fps: Infinity })).toEqual(
      DEFAULT_VIDEO_SEGMENT,
    )
    expect(normalizeVideoSegment({ lengthSeconds: 2 })).toEqual({
      ...DEFAULT_VIDEO_SEGMENT,
      lengthSeconds: 2,
    })
  })

  it('never starts before the beginning', () => {
    expect(normalizeVideoSegment({ startSeconds: -4 }).startSeconds).toBe(0)
  })

  it('keeps the rate between its bounds', () => {
    expect(normalizeVideoSegment({ fps: 0 }).fps).toBe(MIN_VIDEO_FPS)
    expect(normalizeVideoSegment({ fps: -3 }).fps).toBe(MIN_VIDEO_FPS)
    expect(normalizeVideoSegment({ fps: 500 }).fps).toBe(MAX_VIDEO_FPS)
  })

  it('caps the length by seconds and by frames, whichever bites first', () => {
    expect(normalizeVideoSegment({ lengthSeconds: 600, fps: 10 }).lengthSeconds).toBe(
      MAX_CLIP_SECONDS,
    )
    // 30 fps: 225 frames are 7.5 s, below the 15 s cap.
    const fast = normalizeVideoSegment({ lengthSeconds: 600, fps: 30 })
    expect(fast.lengthSeconds).toBe(MAX_CLIP_FRAMES / 30)
    expect(fast.lengthSeconds * fast.fps).toBeLessThanOrEqual(MAX_CLIP_FRAMES)
  })

  it('never asks for less than one frame', () => {
    const tiny = normalizeVideoSegment({ lengthSeconds: -1, fps: 10 })
    expect(tiny.lengthSeconds).toBeCloseTo(0.1)
    expect(tiny.lengthSeconds).toBeGreaterThan(0)
  })
})
