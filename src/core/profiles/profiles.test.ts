import { describe, expect, it } from 'vitest'
import {
  PERFILES,
  PERFILES_GENERICOS,
  PERFILES_TRAMITES,
  findProfile,
  isTramite,
  profilesByGroup,
  provenanceOf,
  toOutputPlan,
} from './index'

describe('the profile catalogue', () => {
  it('has unique ids', () => {
    const ids = PERFILES.map((profile) => profile.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every profile a label and an explanation', () => {
    for (const profile of PERFILES) {
      expect(profile.label.length, profile.id).toBeGreaterThan(0)
      // The note is what lets a user disagree with our advice, or understand
      // an office's demand. A profile without one is a number with no story.
      expect(profile.note?.length ?? 0, profile.id).toBeGreaterThan(0)
    }
  })

  it('strips metadata by default, as the spec requires', () => {
    for (const profile of PERFILES) {
      expect(profile.stripMetadata, profile.id).toBe(true)
    }
  })

  it('ships no paperwork profiles until they are verified', () => {
    // An empty list is honest. Profiles arrive one at a time, each with the
    // document it came from.
    expect(PERFILES_TRAMITES).toHaveLength(0)
  })

  it('ships the generic profiles the v1 promised', () => {
    const groups = new Set(PERFILES_GENERICOS.map((profile) => profile.group))

    expect(groups).toEqual(new Set(['Web', 'Correo', 'Mensajería', 'Miniatura']))
  })
})

describe('the source rule', () => {
  it('carries source and date on every paperwork profile', () => {
    /*
     * The type makes this unrepresentable — a TramiteProfile without a source
     * does not compile — so this is the belt to that braces. It also fails
     * loudly if somebody ever widens the type to make an exception.
     */
    for (const profile of PERFILES.filter(isTramite)) {
      expect(profile.source.length, profile.id).toBeGreaterThan(0)
      expect(profile.verifiedAt, profile.id).toMatch(/^\d{4}-\d{2}-\d{2}/)
      expect(Number.isNaN(Date.parse(profile.verifiedAt)), profile.id).toBe(false)
    }
  })

  it('reports provenance only where there is an external authority to cite', () => {
    for (const profile of PERFILES_GENERICOS) {
      // Our own advice has no source, and pretending otherwise would be the
      // dishonesty the rule exists to prevent.
      expect(provenanceOf(profile), profile.id).toBeNull()
    }
  })
})

describe('lookup', () => {
  it('finds a profile by id', () => {
    expect(findProfile('miniatura')?.label).toBe('Miniatura')
  })

  it('returns null for an id nobody defined', () => {
    expect(findProfile('mesa-de-partes-inventada')).toBeNull()
  })

  it('groups profiles for display', () => {
    const grouped = profilesByGroup()

    expect(grouped.get('Web')?.map((profile) => profile.id)).toEqual(['web-articulo'])
    expect(grouped.get('Trámites')).toBeUndefined()
  })
})

describe('toOutputPlan', () => {
  it('passes the limits through and drops everything presentational', () => {
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
