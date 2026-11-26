import { resampleImage, scaleBy, type Dimensions } from '../resize'

/**
 * Reframing one decoded frame: the geometry, then the resampling.
 *
 * Same split as resize.ts and for the same reason: the geometry is
 * arithmetic that is tested in Node against every awkward ratio, and the
 * resampling is one call to the existing lanczos resampler (premultiplied,
 * linear light), which also runs in a worker.
 *
 * Two modes, because the two destinations want opposite things:
 *
 * - sticker: a square canvas of exactly `size` pixels. The frame is fitted
 *   inside it keeping its ratio, centred, with transparent padding, and a
 *   small source IS enlarged so the content touches the canvas on its long
 *   side. Nothing is cropped. `canvas` is the reduced canvas the budget
 *   search may fall back to (256 instead of 320); it is never set by default.
 * - emoji: fitted inside `maxSide` x `maxSide`, never enlarged, no padding.
 *   The output keeps the source ratio.
 *
 * 'none' returns the source untouched. It exists so tests can compare the
 * decoder's pixels with an independent decoder's, byte for byte.
 */

export type FitMode =
  | { readonly kind: 'sticker'; readonly size: number; readonly canvas?: number }
  | { readonly kind: 'emoji'; readonly maxSide: number }
  | { readonly kind: 'none' }

/** Where a source frame lands: the canvas it is written to and the content rectangle inside it. */
export type Placement = {
  readonly canvasWidth: number
  readonly canvasHeight: number
  readonly contentWidth: number
  readonly contentHeight: number
  readonly offsetX: number
  readonly offsetY: number
}

/** A framed frame's pixels: straight RGBA, row-major. */
export type FittedPixels = {
  readonly data: Uint8ClampedArray
  readonly width: number
  readonly height: number
}

const clamp = (value: number, max: number): number => Math.min(max, Math.max(1, Math.round(value)))

export function planFit(source: Dimensions, mode: FitMode): Placement {
  const { width, height } = source
  if (mode.kind === 'none' || width < 1 || height < 1) {
    return {
      canvasWidth: width,
      canvasHeight: height,
      contentWidth: width,
      contentHeight: height,
      offsetX: 0,
      offsetY: 0,
    }
  }

  if (mode.kind === 'emoji') {
    // Shrink only. scaleBy rounds and clamps to one pixel, like every resize here.
    const scale = Math.min(1, mode.maxSide / width, mode.maxSide / height)
    const content = scale < 1 ? scaleBy(source, scale) : { width, height }
    const contentWidth = Math.min(content.width, mode.maxSide)
    const contentHeight = Math.min(content.height, mode.maxSide)
    return {
      canvasWidth: contentWidth,
      canvasHeight: contentHeight,
      contentWidth,
      contentHeight,
      offsetX: 0,
      offsetY: 0,
    }
  }

  const side = mode.canvas ?? mode.size
  const scale = Math.min(side / width, side / height)
  // The long side is exactly `side`: rounding must not leave the canvas one pixel short.
  const contentWidth = width * scale >= height * scale ? side : clamp(width * scale, side)
  const contentHeight = height * scale > width * scale ? side : clamp(height * scale, side)
  return {
    canvasWidth: side,
    canvasHeight: side,
    contentWidth,
    contentHeight,
    // Floor, so an odd leftover pixel goes to the right and bottom edge.
    offsetX: Math.floor((side - contentWidth) / 2),
    offsetY: Math.floor((side - contentHeight) / 2),
  }
}

/** Resamples `image` to `width` x `height`, or returns it when it already is that size. */
export async function resizeImage(image: ImageData, target: Dimensions): Promise<ImageData> {
  if (image.width === target.width && image.height === target.height) return image
  return resampleImage(image, target)
}

/** Frames `image` as `plan` says. Transparent padding is zero bytes. */
export async function fitImage(image: ImageData, mode: FitMode): Promise<FittedPixels> {
  const plan = planFit(image, mode)
  const content = await resizeImage(image, {
    width: plan.contentWidth,
    height: plan.contentHeight,
  })
  if (plan.canvasWidth === plan.contentWidth && plan.canvasHeight === plan.contentHeight) {
    return { data: content.data, width: content.width, height: content.height }
  }
  const data = new Uint8ClampedArray(plan.canvasWidth * plan.canvasHeight * 4)
  const rowBytes = content.width * 4
  for (let y = 0; y < content.height; y += 1) {
    const from = y * rowBytes
    data.set(
      content.data.subarray(from, from + rowBytes),
      ((plan.offsetY + y) * plan.canvasWidth + plan.offsetX) * 4,
    )
  }
  return { data, width: plan.canvasWidth, height: plan.canvasHeight }
}
