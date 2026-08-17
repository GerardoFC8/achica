import { PERFILES_GENERICOS } from './genericos'
import { PERFILES_TRAMITES } from './tramites'
import { isTramite, type Profile, type ProfileGroup } from './types'

export type { GenericProfile, Profile, ProfileGroup, TramiteProfile } from './types'
export { isTramite, toOutputPlan } from './types'
export { PERFILES_GENERICOS } from './genericos'
export { PERFILES_TRAMITES } from './tramites'

/**
 * Every profile the application offers.
 *
 * Paperwork profiles come first because they are the reason someone opened
 * this tool: nobody arrives wanting "quality 75", they arrive because an
 * office asked for something specific.
 */
export const PERFILES: readonly Profile[] = [...PERFILES_TRAMITES, ...PERFILES_GENERICOS]

export function findProfile(id: string): Profile | null {
  return PERFILES.find((profile) => profile.id === id) ?? null
}

/** Grouped for display, in the order the groups first appear. */
export function profilesByGroup(
  profiles: readonly Profile[] = PERFILES,
): ReadonlyMap<ProfileGroup, readonly Profile[]> {
  const grouped = new Map<ProfileGroup, Profile[]>()

  for (const profile of profiles) {
    const existing = grouped.get(profile.group)
    if (existing === undefined) grouped.set(profile.group, [profile])
    else existing.push(profile)
  }

  return grouped
}

/**
 * What the interface must show about where a limit came from.
 *
 * Returning a shape rather than a sentence keeps the wording in the interface
 * layer, and returning null for our own recommendations is the point: those
 * have no external authority to cite, and dressing them up as if they did
 * would be the exact dishonesty the source rule exists to prevent.
 */
export function provenanceOf(
  profile: Profile,
): { readonly source: string; readonly verifiedAt: string } | null {
  return isTramite(profile) ? { source: profile.source, verifiedAt: profile.verifiedAt } : null
}
