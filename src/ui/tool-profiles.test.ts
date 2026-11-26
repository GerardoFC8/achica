import { describe, expect, it } from 'vitest'
import { PERFILES, toOutputPlan } from '../core/profiles'
import { NO_BUDGET } from './budget'
import { DEFAULT_FORMAT } from './format-choice'
import { DEFAULT_RESIZE } from './resize-choice'
import {
  AUDIT_PROFILE,
  defaultDestination,
  destinationsFor,
  planForTool,
  profileForTool,
  type ToolChoices,
} from './tool-profiles'

/**
 * The audit's own default (D60): the one thing that can be applied to a page
 * without touching its HTML. Anything else it offers is for seeing what else
 * would save, and is never the default.
 */

const choices = (destination = AUDIT_PROFILE): ToolChoices => ({
  destination,
  budget: { maxBytes: 100_000, png: 'webp' },
  resize: DEFAULT_RESIZE,
  format: DEFAULT_FORMAT,
})

describe('the audit destination', () => {
  it('keeps the format and the size, at the quality the catalogue uses', () => {
    expect(AUDIT_PROFILE).toMatchObject({
      group: 'Auditoría',
      format: 'keep',
      quality: 78,
    })
    expect(AUDIT_PROFILE.maxWidth).toBeUndefined()
    expect(AUDIT_PROFILE.maxHeight).toBeUndefined()
    expect(AUDIT_PROFILE.scale).toBeUndefined()
    expect(AUDIT_PROFILE.maxBytes).toBeUndefined()
    expect(AUDIT_PROFILE.stripOnly).toBeUndefined()
  })

  it('is called "Mismo formato y tamaño" and says what it does not assume', () => {
    expect(AUDIT_PROFILE.label).toBe('Mismo formato y tamaño')
    expect(AUDIT_PROFILE.note).toMatch(/ni el formato nuevo ni el tamaño/)
  })

  it('has an id of its own, apart from the catalogue', () => {
    expect(PERFILES.map((profile) => profile.id)).not.toContain(AUDIT_PROFILE.id)
  })
})

describe('what the audit offers', () => {
  it('lists its own destination first and then the whole catalogue', () => {
    expect(destinationsFor('auditar')).toEqual([AUDIT_PROFILE, ...PERFILES])
    expect(defaultDestination('auditar')).toBe(AUDIT_PROFILE)
  })

  it('leaves every other tool on the catalogue and its first destination', () => {
    for (const tool of ['comprimir', 'redimensionar', 'convertir', 'quitar-exif'] as const) {
      expect(destinationsFor(tool)).toBe(PERFILES)
      expect(defaultDestination(tool)).toBe(PERFILES[0])
    }
  })

  it('measures with the destination chosen, and ignores a weight ceiling', () => {
    expect(profileForTool('auditar', choices())).toBe(AUDIT_PROFILE)
    expect(planForTool('auditar', choices())).toEqual(toOutputPlan(AUDIT_PROFILE))
    expect(planForTool('auditar', choices()).maxBytes).toBeUndefined()
  })

  it('can measure what another destination would save, such as WebP', () => {
    const web = PERFILES[0]
    if (web === undefined) throw new Error('the catalogue is empty')

    expect(planForTool('auditar', choices(web)).format).toBe('webp')
  })

  it('keeps the compressor on its own budget', () => {
    expect(planForTool('comprimir', choices()).maxBytes).toBe(100_000)
    expect(NO_BUDGET.maxBytes).toBeNull()
  })
})
