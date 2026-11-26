import { describe, expect, it } from 'vitest'
import { MAX_CLIP_SECONDS } from '../core/animation/video-segment'
import { DEFAULT_VIDEO, parseVideoNumber, readVideoTexts, textsOf, videoText } from './video-choice'

describe('parseVideoNumber', () => {
  it.each([
    ['5', 5],
    ['2.5', 2.5],
    ['2,5', 2.5],
    ['  7 ', 7],
    ['2,', 2],
    ['.5', 0.5],
    ['0', 0],
    ['-0', 0],
  ])('reads %j as %d', (text, value) => {
    expect(parseVideoNumber(text)).toEqual({ ok: true, value })
  })

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['abc', 'not-a-number'],
    ['5 s', 'not-a-number'],
    ['1e3', 'not-a-number'],
    ['1,000.5', 'not-a-number'],
    ['1,2,3', 'not-a-number'],
    ['Infinity', 'not-a-number'],
    ['-3', 'negative'],
    ['-0,5', 'negative'],
  ])('refuses %j as %s', (text, problem) => {
    expect(parseVideoNumber(text)).toEqual({ ok: false, problem })
  })
})

describe('readVideoTexts', () => {
  const texts = textsOf(DEFAULT_VIDEO, false)

  it('the defaults read back as themselves, with nothing to report', () => {
    expect(readVideoTexts(texts, DEFAULT_VIDEO)).toEqual({
      segment: DEFAULT_VIDEO,
      problems: {},
      adjusted: [],
    })
  })

  it('takes a decimal comma', () => {
    const reading = readVideoTexts({ ...texts, startSeconds: '1,5' }, DEFAULT_VIDEO)
    expect(reading.segment.startSeconds).toBe(1.5)
  })

  it('keeps the previous value of a field that is not a number and says why', () => {
    const previous = { startSeconds: 2, lengthSeconds: 3, fps: 10 }
    const reading = readVideoTexts({ startSeconds: '', lengthSeconds: 'tres', fps: '-4' }, previous)
    expect(reading.segment).toEqual(previous)
    expect(reading.problems).toEqual({
      startSeconds: 'empty',
      lengthSeconds: 'not-a-number',
      fps: 'negative',
    })
  })

  it('cuts a number outside the bounds and reports the field as adjusted', () => {
    const reading = readVideoTexts(
      { startSeconds: '0', lengthSeconds: '99', fps: '90' },
      DEFAULT_VIDEO,
    )
    expect(reading.segment.fps).toBe(30)
    // 225 frames at 30 fps is 7.5 s, below the 15 s cap.
    expect(reading.segment.lengthSeconds).toBe(7.5)
    expect(reading.adjusted).toEqual(['lengthSeconds', 'fps'])
    expect(reading.segment.lengthSeconds).toBeLessThanOrEqual(MAX_CLIP_SECONDS)
  })

  it('a zero length is raised to one frame, not refused', () => {
    const reading = readVideoTexts({ ...texts, lengthSeconds: '0' }, DEFAULT_VIDEO)
    expect(reading.segment.lengthSeconds).toBeCloseTo(1 / 15)
    expect(reading.adjusted).toEqual(['lengthSeconds'])
  })
})

describe('texts', () => {
  it('writes a decimal comma only when asked, and no trailing zeros', () => {
    expect(videoText(2.5, true)).toBe('2,5')
    expect(videoText(2.5, false)).toBe('2.5')
    expect(videoText(5, true)).toBe('5')
    expect(videoText(1 / 15, false)).toBe('0.07')
  })
})
