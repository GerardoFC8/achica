import type { OutputFormat } from '../codecs/encode'
import type { OutputPlan } from '../pipeline'

/**
 * A profile is data, not code. The user picks where the image is going, not a
 * quality number, and the profile answers with a format, a bound and a
 * quality.
 *
 * Every profile shipped today is our own advice and says so in its note. An
 * earlier design carried a second kind that quoted somebody else's rule — a
 * portal demanding 500 KB — behind a separate shape whose mandatory `source`
 * and `verifiedAt` made an unsourced requirement fail to compile. That group
 * never received a single entry and was removed (D48). The rule it encoded is
 * not gone, only unused: a requirement nobody can check is worse than no
 * profile at all, because the user finds out when their submission is
 * rejected.
 */

export type ProfileGroup = 'Web' | 'Correo' | 'Mensajería' | 'Miniatura'

export type Profile = {
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
  /** What this profile does, and why. Shown in the interface. */
  readonly note?: string
}

/**
 * Turns a profile into the instructions the pipeline understands.
 *
 * Everything presentational — label, group, note — stops here. The pipeline
 * never learns why it is compressing something, which is what keeps profiles a
 * data question rather than a branching one.
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
