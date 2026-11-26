import { loadFixture } from './animation-fixtures'

/** A generated video fixture as a Blob with NO type: the extractor must route by bytes. */
export async function loadVideoBlob(name: string): Promise<Blob> {
  return new Blob([await loadFixture(name)])
}

/** The flat gray of source frame `k` in video-gray-steps (see scripts/make-fixtures.mjs). */
export const grayOfSourceFrame = (k: number): number => 8 + 16 * k

/** The RGBA of the pixel at (x, y). */
export function pixelAt(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
): readonly [number, number, number, number] {
  const at = (y * width + x) * 4
  return [data[at] ?? -1, data[at + 1] ?? -1, data[at + 2] ?? -1, data[at + 3] ?? -1]
}
