import { describe, expect, it } from 'vitest'
import { DISCORD_PERFILES, PERFILES, toOutputPlan, type Profile } from './index'

describe('the Discord profiles', () => {
  it('are the three destinations, with unique ids', () => {
    expect(DISCORD_PERFILES.map((profile) => profile.id)).toEqual([
      'discord-sticker-gif',
      'discord-sticker-apng',
      'discord-emoji-gif',
    ])
  })

  it('stay out of the compressor catalogue', () => {
    const own = new Set(PERFILES.map((profile) => profile.id))

    for (const profile of DISCORD_PERFILES) expect(own.has(profile.id), profile.id).toBe(false)
    expect(PERFILES.some((profile) => profile.group === 'Discord')).toBe(false)
  })

  it('carry a verifiable requirement: an https source and a real date', () => {
    for (const profile of DISCORD_PERFILES) {
      const { source, verifiedAt, evidence } = profile.requirement

      expect(source, profile.id).toMatch(/^https:\/\/\S+$/)
      expect(verifiedAt, profile.id).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(new Date(verifiedAt).toISOString().slice(0, 10), profile.id).toBe(verifiedAt)
      expect(evidence.length, profile.id).toBeGreaterThan(80)
    }
  })

  it('say what Discord did not enforce, and that the exact ceiling is ambiguous', () => {
    for (const profile of DISCORD_PERFILES) {
      expect(profile.requirement.evidence, profile.id).toContain('ambiguo')
    }
    const sticker = DISCORD_PERFILES[0]?.requirement.evidence ?? ''
    expect(sticker).toContain('no se hicieron cumplir')
    expect(sticker).toContain('.apng')
  })

  it('use the budgets and layouts that were agreed', () => {
    const byId = Object.fromEntries(DISCORD_PERFILES.map((profile) => [profile.id, profile]))

    expect(byId['discord-sticker-gif']?.maxBytes).toBe(512_000)
    expect(byId['discord-sticker-gif']?.animation).toEqual({
      layout: { kind: 'sticker', size: 320 },
      format: 'gif',
    })
    expect(byId['discord-sticker-apng']?.maxBytes).toBe(512_000)
    expect(byId['discord-sticker-apng']?.animation.format).toBe('apng')
    expect(byId['discord-emoji-gif']?.maxBytes).toBe(256_000)
    expect(byId['discord-emoji-gif']?.animation).toEqual({
      layout: { kind: 'emoji', maxSide: 128 },
      format: 'gif',
    })
  })

  it('reach the pipeline as an animation plan with the budget', () => {
    for (const profile of DISCORD_PERFILES) {
      const plan = toOutputPlan(profile)

      expect(plan.animation, profile.id).toEqual(profile.animation)
      expect(plan.maxBytes, profile.id).toBe(profile.maxBytes)
    }
  })

  it('leave a still profile plan without an animation', () => {
    for (const profile of PERFILES) expect(toOutputPlan(profile).animation).toBeUndefined()
  })
})

describe('the requirement rule, in the type', () => {
  // The check is the compiler's (npm run typecheck): an unused @ts-expect-error
  // is itself an error, so these fail the build if the rule ever loosens.
  it('does not compile an animated profile without its requirement', () => {
    // @ts-expect-error an external limit with no source and no verifiedAt is not a profile
    const unsourced: Profile = {
      id: 'x',
      label: 'x',
      group: 'Discord',
      format: 'keep',
      maxBytes: 512_000,
      animation: { layout: { kind: 'sticker', size: 320 }, format: 'gif' },
      stripMetadata: true,
    }

    expect(unsourced.id).toBe('x')
  })

  it('does not compile an animation on an own-advice profile either', () => {
    // @ts-expect-error only an ExternalProfile may animate
    const sneaky: Profile = {
      id: 'y',
      label: 'y',
      group: 'Web',
      format: 'keep',
      animation: { layout: { kind: 'emoji', maxSide: 128 }, format: 'gif' },
      stripMetadata: true,
    }

    expect(sneaky.id).toBe('y')
  })

  it('does not compile a requirement without a date', () => {
    const incomplete: Profile = {
      id: 'z',
      label: 'z',
      group: 'Discord',
      format: 'keep',
      maxBytes: 1,
      animation: { layout: { kind: 'emoji', maxSide: 128 }, format: 'gif' },
      stripMetadata: true,
      // @ts-expect-error verifiedAt is mandatory
      requirement: { source: 'https://example.com', evidence: 'x' },
    }

    expect(incomplete.id).toBe('z')
  })
})
