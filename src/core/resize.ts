/**
 * Resizing: the geometry, and the resampling.
 *
 * They are separated because they fail differently. The geometry is
 * arithmetic — it decides what size to aim for, and it is where an off-by-one
 * or a lost aspect ratio hides. The resampling is a wasm call that either
 * works or throws. Keeping the arithmetic pure means it is tested in
 * milliseconds in Node, against every awkward ratio, instead of once against
 * whichever photo happened to be handy.
 */

export type Dimensions = {
  readonly width: number
  readonly height: number
}

export type Bounds = {
  readonly maxWidth?: number
  readonly maxHeight?: number
}

function clampToPixel(value: number): number {
  // An image is at least one pixel. Rounding a very small scale to zero would
  // hand the encoder a dimension it cannot use.
  return Math.max(1, Math.round(value))
}

/**
 * The largest size that fits inside the bounds without distorting the image.
 *
 * Never enlarges. A profile that allows 1920px wide is stating a ceiling, not
 * a target: blowing up a 400px photo to meet it would invent detail that was
 * never there and make the file bigger for no one's benefit.
 */
export function fitWithin(source: Dimensions, bounds: Bounds): Dimensions {
  // Always a fresh pair, never the argument. ImageData satisfies Dimensions
  // structurally, so returning `source` would hand back a whole decoded bitmap
  // where the caller asked for two numbers.
  const unchanged = { width: source.width, height: source.height }

  if (source.width <= 0 || source.height <= 0) return unchanged

  const scales: number[] = [1]
  if (bounds.maxWidth !== undefined) scales.push(bounds.maxWidth / source.width)
  if (bounds.maxHeight !== undefined) scales.push(bounds.maxHeight / source.height)

  const scale = Math.min(...scales)
  if (scale >= 1) return unchanged

  return {
    width: clampToPixel(source.width * scale),
    height: clampToPixel(source.height * scale),
  }
}

/** Scales by a factor, keeping the ratio. Used when a budget needs fewer pixels. */
export function scaleBy(source: Dimensions, factor: number): Dimensions {
  if (source.width <= 0 || source.height <= 0) {
    return { width: source.width, height: source.height }
  }

  return {
    width: clampToPixel(source.width * factor),
    height: clampToPixel(source.height * factor),
  }
}

export function isSameSize(a: Dimensions, b: Dimensions): boolean {
  return a.width === b.width && a.height === b.height
}

/**
 * Resamples to the given size.
 *
 * The library defaults are kept deliberately, because both of them are the
 * difference between a correct resize and a subtly wrong one:
 *
 *   premultiply — without it, resampling averages colour into fully
 *   transparent pixels and leaves dark halos around every soft edge.
 *
 *   linearRGB — averaging sRGB values directly darkens the result, because
 *   sRGB is not linear in light. Converting first is what keeps a shrunk
 *   photo the same brightness as the original.
 *
 * lanczos3 is the default method and the right one for photographs.
 */
export async function resampleImage(image: ImageData, target: Dimensions): Promise<ImageData> {
  const { default: resize } = await import('@jsquash/resize')

  return resize(image, {
    width: target.width,
    height: target.height,
    fitMethod: 'stretch',
  })
}
