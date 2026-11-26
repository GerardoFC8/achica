export type Rect = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * The smallest rectangle that contains every pixel that differs between two
 * equally sized buffers, or null when they are identical. `unit` is how many
 * array elements make one pixel (1 for indices, 4 for RGBA).
 */
export function changedRect(
  previous: ArrayLike<number>,
  next: ArrayLike<number>,
  width: number,
  height: number,
  unit: number,
): Rect | null {
  let top = -1
  let bottom = -1
  let left = width
  let right = -1
  const rowLength = width * unit
  for (let y = 0; y < height; y += 1) {
    const base = y * rowLength
    let first = -1
    let last = -1
    for (let x = 0; x < width; x += 1) {
      const at = base + x * unit
      let differs = false
      for (let u = 0; u < unit; u += 1) {
        if (previous[at + u] !== next[at + u]) {
          differs = true
          break
        }
      }
      if (differs) {
        if (first < 0) first = x
        last = x
      }
    }
    if (first >= 0) {
      if (top < 0) top = y
      bottom = y
      if (first < left) left = first
      if (last > right) right = last
    }
  }
  if (top < 0) return null
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
}
