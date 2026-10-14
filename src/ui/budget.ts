import type { OutputPlan } from '../core/pipeline'
import { toOutputPlan, type Profile } from '../core/profiles'

/**
 * The weight ceiling the user sets on top of a destination: "leave them all
 * under 200 KB", the third axis of the spec, reachable from the interface
 * again (D53).
 *
 * It is a choice laid over the profile and not a field of it. The destination
 * still decides format, dimensions and quality; the ceiling only adds a hard
 * limit on what comes out. Every file can go in, whatever it weighs.
 */

/**
 * What a PNG does when it cannot meet the ceiling as it is.
 *
 * `webp` keeps every pixel and the transparency and reaches the ceiling by
 * quality, at the price of a new extension. `keep` keeps the `.png` and
 * reaches the ceiling by shrinking the picture, since PNG has no quality to
 * give. The user decides; the default is the one that keeps the picture.
 */
export type PngUnderBudget = 'webp' | 'keep'

export type BudgetChoice = {
  /** Null is no ceiling at all, which is where every visit starts. */
  readonly maxBytes: number | null
  readonly png: PngUnderBudget
}

export const NO_BUDGET: BudgetChoice = { maxBytes: null, png: 'webp' }

/** Thousands, like every weight in the interface (see format.ts). */
export const BUDGET_PRESETS: readonly number[] = [100_000, 200_000, 500_000, 1_000_000]

/**
 * The destination as the rest of the interface should read it: with the
 * ceiling folded in, so the weight bar, the row states and the details all
 * measure against the limit the user actually set.
 */
export function withBudget(profile: Profile, choice: BudgetChoice): Profile {
  return choice.maxBytes === null ? profile : { ...profile, maxBytes: choice.maxBytes }
}

export function planFor(profile: Profile, choice: BudgetChoice): OutputPlan {
  const plan = toOutputPlan(withBudget(profile, choice))
  return choice.maxBytes !== null && choice.png === 'webp'
    ? { ...plan, losslessUnderBudget: 'webp' }
    : plan
}

/** Below this nothing useful fits: an image header alone takes a good part. */
export const MIN_KILOBYTES = 5
/** Past this a ceiling stops being one for any photo a person would carry. */
export const MAX_KILOBYTES = 100_000

/**
 * A ceiling typed by hand, in KB, into bytes; or null when it is not one.
 *
 * Accepts a decimal comma as well as a point, since the interface is in
 * Spanish and "7,5" is how a decimal gets written there.
 */
export function parseKilobytes(text: string): number | null {
  const normalised = text.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(normalised)) return null

  const kilobytes = Number(normalised)
  if (kilobytes < MIN_KILOBYTES || kilobytes > MAX_KILOBYTES) return null

  return Math.round(kilobytes * 1000)
}
