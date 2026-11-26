import { describe, expect, it } from 'vitest'
import { fitImage, planFit } from './fit'

const sticker = { kind: 'sticker', size: 320 } as const

describe('planFit: sticker', () => {
  it('puts a square source on the whole canvas', () => {
    expect(planFit({ width: 100, height: 100 }, sticker)).toEqual({
      canvasWidth: 320,
      canvasHeight: 320,
      contentWidth: 320,
      contentHeight: 320,
      offsetX: 0,
      offsetY: 0,
    })
  })

  it('centres a wide source with padding above and below', () => {
    const plan = planFit({ width: 160, height: 90 }, sticker)
    expect([plan.contentWidth, plan.contentHeight]).toEqual([320, 180])
    expect([plan.offsetX, plan.offsetY]).toEqual([0, 70])
  })

  it('centres a tall source with padding left and right', () => {
    const plan = planFit({ width: 90, height: 160 }, sticker)
    expect([plan.contentWidth, plan.contentHeight]).toEqual([180, 320])
    expect([plan.offsetX, plan.offsetY]).toEqual([70, 0])
  })

  it('enlarges a small source so the canvas is exact', () => {
    const plan = planFit({ width: 16, height: 16 }, sticker)
    expect([plan.contentWidth, plan.contentHeight]).toEqual([320, 320])
  })

  it('gives the odd leftover pixel to the right and bottom edge', () => {
    const plan = planFit({ width: 100, height: 99 }, sticker)
    expect(plan.contentHeight).toBe(317)
    expect(plan.offsetY).toBe(1)
  })

  it('never makes a dimension zero, however extreme the ratio', () => {
    const plan = planFit({ width: 1000, height: 1 }, sticker)
    expect(plan.contentWidth).toBe(320)
    expect(plan.contentHeight).toBe(1)
    expect(plan.offsetY).toBe(159)
  })

  it('uses the reduced canvas when asked', () => {
    const plan = planFit({ width: 160, height: 90 }, { kind: 'sticker', size: 320, canvas: 256 })
    expect([plan.canvasWidth, plan.canvasHeight]).toEqual([256, 256])
    expect([plan.contentWidth, plan.contentHeight]).toEqual([256, 144])
  })

  it('always touches the canvas on the long side and stays inside it', () => {
    for (let width = 1; width <= 700; width += 37) {
      for (let height = 1; height <= 700; height += 41) {
        const plan = planFit({ width, height }, sticker)
        expect(Math.max(plan.contentWidth, plan.contentHeight)).toBe(320)
        expect(plan.offsetX + plan.contentWidth).toBeLessThanOrEqual(320)
        expect(plan.offsetY + plan.contentHeight).toBeLessThanOrEqual(320)
        expect(plan.offsetX).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

describe('planFit: emoji and none', () => {
  it('shrinks to fit and keeps the ratio, with no padding', () => {
    const plan = planFit({ width: 300, height: 150 }, { kind: 'emoji', maxSide: 128 })
    expect([plan.canvasWidth, plan.canvasHeight]).toEqual([128, 64])
    expect([plan.offsetX, plan.offsetY]).toEqual([0, 0])
  })

  it('never enlarges', () => {
    const plan = planFit({ width: 50, height: 20 }, { kind: 'emoji', maxSide: 128 })
    expect([plan.canvasWidth, plan.canvasHeight]).toEqual([50, 20])
  })

  it('leaves the source alone in none mode', () => {
    const plan = planFit({ width: 77, height: 33 }, { kind: 'none' })
    expect([plan.canvasWidth, plan.canvasHeight]).toEqual([77, 33])
  })
})

describe('fitImage', () => {
  it('pads with transparent pixels around the content', async () => {
    // 320x180 already is the content size of a 16:9 sticker, so no resampling (and no wasm) runs.
    const data = new Uint8ClampedArray(320 * 180 * 4).fill(255)
    const image = { data, width: 320, height: 180 } as unknown as ImageData
    const out = await fitImage(image, sticker)
    expect([out.width, out.height]).toEqual([320, 320])
    const at = (x: number, y: number): number[] => {
      const i = (y * 320 + x) * 4
      return [...out.data.subarray(i, i + 4)]
    }
    expect(at(10, 0)).toEqual([0, 0, 0, 0])
    expect(at(10, 69)).toEqual([0, 0, 0, 0])
    expect(at(10, 70)).toEqual([255, 255, 255, 255])
    expect(at(10, 249)).toEqual([255, 255, 255, 255])
    expect(at(10, 250)).toEqual([0, 0, 0, 0])
  })
})
