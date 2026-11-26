import { describe, expect, it } from 'vitest'
import { flattenPixelsOnWhite, hasTransparency } from './alpha'

// ImageData does not exist in Node (D3), so these take the raw bytes. The
// wrapper that builds an ImageData is covered in alpha.browser-test.ts.
const rgba = (...values: number[]): Uint8ClampedArray => new Uint8ClampedArray(values)

describe('hasTransparency', () => {
  it('is false for a fully opaque image', () => {
    expect(hasTransparency({ data: rgba(10, 20, 30, 255, 0, 0, 0, 255) })).toBe(false)
  })

  it('is true as soon as one pixel is not fully opaque', () => {
    expect(hasTransparency({ data: rgba(10, 20, 30, 255, 0, 0, 0, 254) })).toBe(true)
    expect(hasTransparency({ data: rgba(0, 0, 0, 0) })).toBe(true)
  })

  it('treats an empty image as opaque', () => {
    expect(hasTransparency({ data: rgba() })).toBe(false)
  })
})

describe('flattenPixelsOnWhite', () => {
  it('turns a fully transparent pixel white, whatever RGB is underneath', () => {
    expect(Array.from(flattenPixelsOnWhite(rgba(0, 0, 0, 0)))).toEqual([255, 255, 255, 255])
    expect(Array.from(flattenPixelsOnWhite(rgba(12, 200, 90, 0)))).toEqual([255, 255, 255, 255])
  })

  it('leaves an opaque pixel exactly as it was', () => {
    expect(Array.from(flattenPixelsOnWhite(rgba(12, 200, 90, 255)))).toEqual([12, 200, 90, 255])
  })

  it('blends a half-transparent pixel towards white', () => {
    // black at alpha 128: 0 * 128/255 + 255 * 127/255 = 127
    expect(Array.from(flattenPixelsOnWhite(rgba(0, 0, 0, 128)))).toEqual([127, 127, 127, 255])
    // red at alpha 128: r = 255*128/255 + 127 = 255, g = b = 127
    expect(Array.from(flattenPixelsOnWhite(rgba(255, 0, 0, 128)))).toEqual([255, 127, 127, 255])
  })

  it('does not modify its input and handles several pixels', () => {
    const input = rgba(0, 0, 0, 0, 10, 20, 30, 255)
    const flat = flattenPixelsOnWhite(input)

    expect(Array.from(flat)).toEqual([255, 255, 255, 255, 10, 20, 30, 255])
    expect(Array.from(input)).toEqual([0, 0, 0, 0, 10, 20, 30, 255])
  })
})
