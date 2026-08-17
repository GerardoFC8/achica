import { describe, expect, it } from 'vitest'
import { fitWithin, isSameSize, scaleBy } from './resize'

const photo = { width: 1800, height: 1200 }
const portrait = { width: 1200, height: 1800 }

describe('fitWithin', () => {
  it('leaves an image alone when it already fits', () => {
    expect(fitWithin(photo, { maxWidth: 2000, maxHeight: 2000 })).toEqual(photo)
  })

  it('leaves an image alone when no bounds are given', () => {
    expect(fitWithin(photo, {})).toEqual(photo)
  })

  it('never enlarges', () => {
    // A profile allowing 1920px is stating a ceiling, not a target. Blowing a
    // small photo up would invent detail and grow the file for nobody.
    const small = { width: 400, height: 300 }

    expect(fitWithin(small, { maxWidth: 1920, maxHeight: 1080 })).toEqual(small)
  })

  it('honours a width ceiling and keeps the ratio', () => {
    expect(fitWithin(photo, { maxWidth: 900 })).toEqual({ width: 900, height: 600 })
  })

  it('honours a height ceiling and keeps the ratio', () => {
    expect(fitWithin(photo, { maxHeight: 600 })).toEqual({ width: 900, height: 600 })
  })

  it('obeys whichever bound binds first', () => {
    // A landscape photo in a square box is limited by its width; a portrait
    // one by its height. Taking the wrong bound silently overshoots the box.
    expect(fitWithin(photo, { maxWidth: 600, maxHeight: 600 })).toEqual({
      width: 600,
      height: 400,
    })
    expect(fitWithin(portrait, { maxWidth: 600, maxHeight: 600 })).toEqual({
      width: 400,
      height: 600,
    })
  })

  it('never returns a fractional or zero dimension', () => {
    const awkward = { width: 1001, height: 333 }
    const result = fitWithin(awkward, { maxWidth: 7 })

    expect(Number.isInteger(result.width)).toBe(true)
    expect(Number.isInteger(result.height)).toBe(true)
    expect(result.height).toBeGreaterThanOrEqual(1)
  })

  it('keeps at least one pixel even under an absurd bound', () => {
    expect(fitWithin(photo, { maxWidth: 1 })).toEqual({ width: 1, height: 1 })
  })

  it('stays inside the box for a spread of ratios', () => {
    const bounds = { maxWidth: 800, maxHeight: 800 }
    const sources = [
      { width: 4000, height: 3000 },
      { width: 3000, height: 4000 },
      { width: 5000, height: 100 },
      { width: 100, height: 5000 },
      { width: 1234, height: 4321 },
      { width: 801, height: 801 },
    ]

    for (const source of sources) {
      const result = fitWithin(source, bounds)

      expect(result.width, JSON.stringify(source)).toBeLessThanOrEqual(800)
      expect(result.height, JSON.stringify(source)).toBeLessThanOrEqual(800)

      // The ratio must survive, allowing for the rounding to whole pixels.
      const before = source.width / source.height
      const after = result.width / result.height
      expect(Math.abs(before - after) / before).toBeLessThan(0.02)
    }
  })

  it('does not choke on a degenerate image', () => {
    expect(fitWithin({ width: 0, height: 0 }, { maxWidth: 100 })).toEqual({
      width: 0,
      height: 0,
    })
  })
})

describe('scaleBy', () => {
  it('halves both sides', () => {
    expect(scaleBy(photo, 0.5)).toEqual({ width: 900, height: 600 })
  })

  it('rounds to whole pixels and never reaches zero', () => {
    expect(scaleBy({ width: 3, height: 3 }, 0.01)).toEqual({ width: 1, height: 1 })
  })
})

describe('isSameSize', () => {
  it('compares both dimensions', () => {
    expect(isSameSize(photo, { width: 1800, height: 1200 })).toBe(true)
    expect(isSameSize(photo, { width: 1800, height: 1201 })).toBe(false)
  })
})
