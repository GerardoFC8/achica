import type { OutputFormat } from '../codecs/encode'
import type { OutputPlan } from '../pipeline'

/**
 * A profile is data, not code. This is the product's differentiator: the user
 * picks where the image is going, not a quality number.
 *
 * The type is split into two shapes on purpose. The spec's hardest rule is
 * that a paperwork profile only exists with a verifiable source and a
 * verification date — a profile with an invented limit is worse than no
 * profile, because the user finds out when their submission is rejected.
 *
 * Making that a comment would leave it to whoever is in a hurry. Making it a
 * separate shape means a paperwork profile without a source does not compile.
 */

export type ProfileGroup = GenericGroup | 'Trámites'

export type GenericGroup = 'Web' | 'Correo' | 'Mensajería' | 'Miniatura'

type BaseProfile = {
  readonly id: string
  readonly label: string
  readonly format: OutputFormat | 'keep'
  readonly maxBytes?: number
  readonly maxWidth?: number
  readonly maxHeight?: number
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
   */
  readonly stripMetadata: boolean
  /** What the destination requires, and why. Shown in the interface. */
  readonly note?: string
}

/** Our own recommendation. Nobody is being told this is an external rule. */
export type GenericProfile = BaseProfile & {
  readonly group: GenericGroup
}

/**
 * A requirement imposed by somebody else. Both fields are mandatory, which is
 * the rule enforced rather than described.
 */
export type TramiteProfile = BaseProfile & {
  readonly group: 'Trámites'
  /** URL or official document the limits come from. */
  readonly source: string
  /** ISO date. These requirements change; assume this one has gone stale. */
  readonly verifiedAt: string
}

export type Profile = GenericProfile | TramiteProfile

export function isTramite(profile: Profile): profile is TramiteProfile {
  return profile.group === 'Trámites'
}

/**
 * Turns a profile into the instructions the pipeline understands.
 *
 * Everything presentational — label, group, note, source — stops here. The
 * pipeline never learns why it is compressing something, which is what keeps
 * profiles a data question rather than a branching one.
 */
export function toOutputPlan(profile: Profile): OutputPlan {
  return {
    format: profile.format,
    ...(profile.maxBytes === undefined ? {} : { maxBytes: profile.maxBytes }),
    ...(profile.maxWidth === undefined ? {} : { maxWidth: profile.maxWidth }),
    ...(profile.maxHeight === undefined ? {} : { maxHeight: profile.maxHeight }),
    ...(profile.minQuality === undefined ? {} : { minQuality: profile.minQuality }),
    ...(profile.quality === undefined ? {} : { quality: profile.quality }),
  }
}
