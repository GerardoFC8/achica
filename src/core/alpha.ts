/**
 * Transparency, for the one output that cannot hold it.
 *
 * JPEG has no alpha channel. The encoder simply drops it, so a transparent
 * pixel comes out as whatever RGB sat underneath, and decoders store fully
 * transparent pixels as black far more often than as anything else. A logo on
 * a see-through background became a black rectangle. Flattening on white first
 * is the convention every image editor follows when saving to JPEG.
 *
 * The arithmetic works on the raw byte array so it runs (and is tested) in
 * Node, where `ImageData` does not exist (D3). Only `flattenOnWhite` builds an
 * `ImageData`, which core/ may do: it is a type and a constructor, not a
 * reach into `window` or the DOM, and the worker that runs it has the global.
 */

type Pixels = { readonly data: Uint8ClampedArray }

/** True when any pixel is less than fully opaque. */
export function hasTransparency(image: Pixels): boolean {
  const { data } = image

  // Alpha is every fourth byte. Stops at the first translucent pixel, so an
  // opaque photo costs one pass of cheap reads and a transparent one often
  // returns almost immediately.
  for (let at = 3; at < data.length; at += 4) {
    if (data[at] !== 255) return true
  }

  return false
}

/**
 * Composites RGBA bytes over white and returns a new array, alpha 255.
 *
 * c' = c * a/255 + 255 * (1 - a/255), computed in integers and rounded once so
 * a fully opaque pixel is returned exactly and a fully transparent one is
 * exactly 255. The input is not modified: the caller may still need the alpha.
 */
export function flattenPixelsOnWhite(data: Uint8ClampedArray): Uint8ClampedArray<ArrayBuffer> {
  const flat = new Uint8ClampedArray(data.length)

  for (let at = 0; at + 3 < data.length; at += 4) {
    const alpha = data[at + 3] ?? 255
    const inverse = 255 - alpha

    for (let channel = 0; channel < 3; channel += 1) {
      const value = data[at + channel] ?? 0
      flat[at + channel] = Math.round((value * alpha + 255 * inverse) / 255)
    }
    flat[at + 3] = 255
  }

  return flat
}

/** A new, fully opaque image: the source composited over white. */
export function flattenOnWhite(image: ImageData): ImageData {
  return new ImageData(flattenPixelsOnWhite(image.data), image.width, image.height)
}
