import type { OutputFormat } from '../codecs/encode'
import type { AnimationRequest, OutputPlan } from '../pipeline'

/**
 * A profile is data, not code. The user picks where the image is going, not a
 * quality number, and the profile answers with a format, a bound and a
 * quality.
 *
 * Most profiles are our own advice and say so in their note. A profile that
 * quotes somebody else's rule — a platform demanding 500 KB — is an
 * `ExternalProfile`, whose mandatory `requirement` (source, verifiedAt,
 * evidence) makes an unsourced limit fail to compile. The first design of that
 * idea, for paperwork, never received an entry and was removed (D48); the rule
 * did not go away, it came back with Discord. A requirement nobody can check
 * is worse than no profile at all, because the user finds out when their
 * submission is rejected.
 */

export type ProfileGroup =
  | 'Web'
  | 'Correo'
  | 'Mensajería'
  | 'Miniatura'
  | 'Tamaño'
  | 'Formato'
  | 'Metadatos'
  | 'Auditoría'
  | 'Discord'

/**
 * Where a limit that is not ours comes from, and what was actually checked.
 *
 * A limit set by somebody else (a platform, a portal) is a claim about the
 * outside world, and the user finds out it was wrong when their upload is
 * rejected. So the claim carries its proof: a page anybody can open, the day it
 * was checked, and what the check consisted of. An unsourced requirement does
 * not compile (see `ExternalProfile`), and that is the rule from D48 written
 * into the type instead of into a comment.
 */
export type Requirement = {
  /** An https URL of the authority's own page. */
  readonly source: string
  /** The day it was checked, as YYYY-MM-DD. */
  readonly verifiedAt: string
  /** What was verified and how, including what was NOT enforced by the authority. */
  readonly evidence: string
}

/** The fields every profile has, whoever the advice comes from. */
type ProfileBase = {
  readonly id: string
  readonly label: string
  readonly group: ProfileGroup
  /**
   * `keep` leaves the file in the format it arrived in, and it is the default
   * stance (D49).
   *
   * Turning somebody's `.png` into a `.jpg` is a decision they did not ask
   * for: it changes the name they will look for, and it drops transparency
   * without saying so. Only the web profile converts, because there the WebP
   * is the thing being asked for.
   */
  readonly format: OutputFormat | 'keep'
  /**
   * A hard weight ceiling.
   *
   * No shipped profile sets one — see D49 — but the field stays because the
   * pipeline's budget search is the one piece of core that answers "leave them
   * all under N", and this is the only way a profile can reach it.
   */
  readonly maxBytes?: number
  readonly maxWidth?: number
  readonly maxHeight?: number
  /** Factor in (0, 1) applied to the decoded size, before the limits. */
  readonly scale?: number
  readonly minQuality?: number
  readonly quality?: number
  /**
   * Metadata is dropped by default for privacy. The EXIF rotation has already
   * been applied to the pixels by then, so nothing is lost visually.
   *
   * Note that the codecs in this stack write no metadata at all, so today this
   * is always effectively true. Honouring `false` would need a dependency
   * outside the agreed stack, and it would also have to normalise the
   * orientation tag to 1 — leaving the original tag on pixels that are already
   * rotated makes every viewer rotate them a second time.
   *
   * Not the same thing as `stripOnly` below: this one says the recompress path
   * writes no metadata of its own; `stripOnly` removes it from the original
   * file's bytes without recompressing.
   */
  readonly stripMetadata: boolean
  /** Remove the metadata from the container and return the same image (see `OutputPlan.stripOnly`). */
  readonly stripOnly?: boolean
  /** What this profile does, and why. Shown in the interface. */
  readonly note?: string
}

/** Our own advice: no external authority, so no requirement to prove. */
export type OwnProfile = ProfileBase & {
  readonly requirement?: Requirement
  /** Only an external destination can be animated: see `ExternalProfile`. */
  readonly animation?: never
}

/**
 * A destination whose weight limit belongs to somebody else (Discord's sticker
 * and emoji uploads). It is the only way to write a profile with `animation`,
 * and it cannot be written without `requirement`: leave it out and the
 * catalogue does not compile.
 *
 * `format` is `keep` because it does not apply: the output format of an
 * animation is `animation.format`, and the still pipeline never sees it.
 */
export type ExternalProfile = ProfileBase & {
  readonly format: 'keep'
  /** The authority's ceiling, which is the animation's budget. */
  readonly maxBytes: number
  readonly animation: AnimationRequest
  readonly requirement: Requirement
}

export type Profile = OwnProfile | ExternalProfile

/**
 * Turns a profile into the instructions the pipeline understands.
 *
 * Everything presentational — label, group, note — stops here. The pipeline
 * never learns why it is compressing something, which is what keeps profiles a
 * data question rather than a branching one.
 */
export function toOutputPlan(profile: Profile): OutputPlan {
  return {
    ...(profile.animation === undefined ? {} : { animation: profile.animation }),
    format: profile.format,
    ...(profile.maxBytes === undefined ? {} : { maxBytes: profile.maxBytes }),
    ...(profile.maxWidth === undefined ? {} : { maxWidth: profile.maxWidth }),
    ...(profile.maxHeight === undefined ? {} : { maxHeight: profile.maxHeight }),
    ...(profile.scale === undefined ? {} : { scale: profile.scale }),
    ...(profile.minQuality === undefined ? {} : { minQuality: profile.minQuality }),
    ...(profile.quality === undefined ? {} : { quality: profile.quality }),
    ...(profile.stripOnly === undefined ? {} : { stripOnly: profile.stripOnly }),
  }
}
