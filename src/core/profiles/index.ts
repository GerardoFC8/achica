import { PERFILES } from './catalogo'
import type { Profile, ProfileGroup } from './types'

export type { Profile, ProfileGroup } from './types'
export { toOutputPlan } from './types'
export { PERFILES } from './catalogo'

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
