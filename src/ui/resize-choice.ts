import type { Profile } from '../core/profiles'

/**
 * What the user asks of the resize tool, and the profile that choice becomes.
 *
 * Two ways to say it, and only these two: a percentage of the original, or a
 * box the result has to fit inside. Both only ever shrink and neither crops;
 * those rules live in the core (`scale`, `maxWidth`, `maxHeight`), this file
 * only decides which of them to set.
 *
 * Quality is not part of the choice. The product hands out destinations, not a
 * slider (axis 2 of the spec), so every resize encodes at one fixed quality.
 */

export type ResizeChoice =
  | { readonly mode: 'percent'; readonly percent: number }
  /** At least one side is set; a null side is left free. */
  | { readonly mode: 'box'; readonly width: number | null; readonly height: number | null }

export const MIN_PERCENT = 1
/** 100 would be a no-op and the tool only reduces, so the ceiling is 99. */
export const MAX_PERCENT = 99
export const MIN_PIXELS = 1
/** Past this no screen or sensor a person owns is being described. */
export const MAX_PIXELS = 20_000

export const DEFAULT_RESIZE: ResizeChoice = { mode: 'percent', percent: 50 }

export const PERCENT_PRESETS: readonly number[] = [75, 50, 25]

/** Neutral boxes: sizes people ask for, with no platform attached to any. */
export const BOX_PRESETS: readonly {
  readonly width: number | null
  readonly height: number | null
}[] = [
  { width: 1920, height: null },
  { width: 1280, height: null },
  { width: 800, height: null },
  { width: 1920, height: 1080 },
  { width: 1080, height: 1080 },
]

/** Fixed quality of the lossy formats when only the size changes. */
export const RESIZE_QUALITY = 85

/**
 * A whole number, as typed. The interface is in two languages but neither
 * writes a fractional pixel or a fractional percent, so there is no decimal
 * comma to accept: "50,5" is refused like "50.5", not read as 505. A trailing
 * unit ("%", "px") is tolerated because people type it.
 */
function parseWhole(text: string, unit: RegExp, min: number, max: number): number | null {
  const trimmed = text.trim().replace(unit, '').trim()
  if (!/^\d+$/.test(trimmed)) return null

  const value = Number(trimmed)
  return value >= min && value <= max ? value : null
}

export const parsePercent = (text: string): number | null =>
  parseWhole(text, /\s*%$/, MIN_PERCENT, MAX_PERCENT)

export const parsePixels = (text: string): number | null =>
  parseWhole(text, /\s*px$/i, MIN_PIXELS, MAX_PIXELS)

/**
 * A box from two fields. A blank field leaves that side free; both blank, or
 * either filled one not being a valid size, is not a choice.
 */
export function parseBox(width: string, height: string): ResizeChoice | null {
  const w = width.trim() === '' ? null : parsePixels(width)
  const h = height.trim() === '' ? null : parsePixels(height)

  if (width.trim() !== '' && w === null) return null
  if (height.trim() !== '' && h === null) return null
  if (w === null && h === null) return null

  return { mode: 'box', width: w, height: h }
}

export function profileForResize(choice: ResizeChoice): Profile {
  if (choice.mode === 'percent') {
    return {
      id: `redimensionar-${choice.percent}`,
      label: `${choice.percent} %`,
      group: 'Tamaño',
      format: 'keep',
      // Whole percents only, so the division is exact enough for the core's
      // rounding to land where the user expects.
      scale: choice.percent / 100,
      quality: RESIZE_QUALITY,
      stripMetadata: true,
      note: `Reduce cada imagen al ${choice.percent} % de su ancho y de su alto, sin recortar y conservando el formato.`,
    }
  }

  const { width, height } = choice
  const box =
    width !== null && height !== null
      ? `${width} × ${height} px`
      : width !== null
        ? `${width} px de ancho`
        : `${height} px de alto`

  return {
    id: `redimensionar-${width ?? 'x'}x${height ?? 'x'}`,
    label: box,
    group: 'Tamaño',
    format: 'keep',
    ...(width === null ? {} : { maxWidth: width }),
    ...(height === null ? {} : { maxHeight: height }),
    quality: RESIZE_QUALITY,
    stripMetadata: true,
    note: `Reduce las imágenes que superen ${box} hasta que quepan, sin recortar y conservando el formato. Las más pequeñas no se tocan.`,
  }
}

/** The words a summary is built from, in the page's language. */
export type ResizeWords = {
  readonly summaryPercent: (percent: number) => string
  readonly summaryBox: (width: number | null, height: number | null) => string
}

/** One short line for the toolbar button. */
export function resizeSummary(choice: ResizeChoice, words: ResizeWords): string {
  return choice.mode === 'percent'
    ? words.summaryPercent(choice.percent)
    : words.summaryBox(choice.width, choice.height)
}

export function sameResize(a: ResizeChoice, b: ResizeChoice): boolean {
  if (a.mode === 'percent') return b.mode === 'percent' && a.percent === b.percent
  return b.mode === 'box' && a.width === b.width && a.height === b.height
}
