import { describe, expect, it } from 'vitest'
import { PERFILES, findProfile, profilesByGroup, toOutputPlan } from './index'

describe('the profile catalogue', () => {
  it('has unique ids', () => {
    const ids = PERFILES.map((profile) => profile.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every profile a label and an explanation', () => {
    for (const profile of PERFILES) {
      expect(profile.label.length, profile.id).toBeGreaterThan(0)
      // The note is what lets a user disagree with our advice. A profile
      // without one is a number with no story.
      expect(profile.note?.length ?? 0, profile.id).toBeGreaterThan(0)
    }
  })

  it('strips metadata by default, as the spec requires', () => {
    for (const profile of PERFILES) {
      expect(profile.stripMetadata, profile.id).toBe(true)
    }
  })

  it('ships the four groups the v1 promised', () => {
    const groups = new Set(PERFILES.map((profile) => profile.group))

    expect(groups).toEqual(new Set(['Web', 'Correo', 'Mensajería', 'Miniatura']))
  })

  it('changes the format only where converting is the point', () => {
    /*
     * D49. Handing back a different extension than the one that came in is a
     * decision the user did not ask for, so only the web profile does it —
     * there the WebP is the thing being requested. This is the catalogue-level
     * half of the promise; profiles.browser-test.ts proves it on real bytes.
     */
    const converting = PERFILES.filter((profile) => profile.format !== 'keep')

    expect(converting.map((profile) => profile.id)).toEqual(['web-articulo'])
    expect(converting[0]?.format).toBe('webp')
  })

  it('sets no weight ceiling, because none of these is somebody else’s rule', () => {
    /*
     * D49. A byte budget was there for the paperwork profiles that never
     * arrived — "under 500 KB" was a number a portal put in a form. Without
     * them, a ceiling buys nothing and costs the only lever a lossless format
     * has: with PNG the quality knob does nothing, so the pipeline would hit
     * the budget by quietly shrinking the picture instead.
     *
     * The support stays in core and is tested there. This asserts the shipped
     * catalogue does not use it.
     */
    for (const profile of PERFILES) {
      expect(profile.maxBytes, profile.id).toBeUndefined()
    }
  })
})

describe('lookup', () => {
  it('finds a profile by id', () => {
    expect(findProfile('miniatura')?.label).toBe('Miniatura')
  })

  it('returns null for an id nobody defined', () => {
    expect(findProfile('perfil-inventado')).toBeNull()
  })

  it('groups profiles for display, in the order the groups first appear', () => {
    const grouped = profilesByGroup()

    expect([...grouped.keys()]).toEqual(['Web', 'Correo', 'Mensajería', 'Miniatura'])
    expect(grouped.get('Web')?.map((profile) => profile.id)).toEqual(['web-articulo'])
  })
})

describe('toOutputPlan', () => {
  it('passes the limits through and drops everything presentational', () => {
    /*
     * Built here rather than taken from the catalogue: this is the bridge to
     * the pipeline, and it has to carry a weight ceiling even though no shipped
     * profile currently sets one.
     */
    const plan = toOutputPlan({
      id: 'x',
      label: 'X',
      group: 'Correo',
      format: 'jpeg',
      maxBytes: 500_000,
      maxWidth: 2000,
      stripMetadata: true,
      note: 'not the pipeline’s business',
    })

    expect(plan).toEqual({ format: 'jpeg', maxBytes: 500_000, maxWidth: 2000 })
  })

  it('omits absent limits rather than passing undefined', () => {
    // exactOptionalPropertyTypes is on, and a key holding undefined is not the
    // same as an absent key when the pipeline checks for one.
    const plan = toOutputPlan({
      id: 'x',
      label: 'X',
      group: 'Web',
      format: 'keep',
      stripMetadata: true,
      note: 'n',
    })

    expect(Object.keys(plan)).toEqual(['format'])
  })

  it('produces a usable plan for every catalogued profile', () => {
    for (const profile of PERFILES) {
      const plan = toOutputPlan(profile)

      expect(plan.format, profile.id).toBeDefined()
      if (plan.maxBytes !== undefined) expect(plan.maxBytes).toBeGreaterThan(0)
      if (plan.maxWidth !== undefined) expect(plan.maxWidth).toBeGreaterThan(0)
      if (plan.maxHeight !== undefined) expect(plan.maxHeight).toBeGreaterThan(0)
    }
  })
})
