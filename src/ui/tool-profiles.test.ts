import { describe, expect, it } from 'vitest'
import { DISCORD_PERFILES, PERFILES, toOutputPlan } from '../core/profiles'
import { NO_BUDGET } from './budget'
import { DEFAULT_FORMAT } from './format-choice'
import { DEFAULT_RESIZE } from './resize-choice'
import {
  AUDIT_PROFILE,
  defaultDestination,
  destinationsFor,
  isSticker,
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
  canvasReduction: false,
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

describe('what Discord offers', () => {
  const [stickerGif, stickerApng, emojiGif] = DISCORD_PERFILES
  if (stickerGif === undefined || stickerApng === undefined || emojiGif === undefined) {
    throw new Error('the Discord catalogue changed shape')
  }

  it('offers its own three destinations, the GIF sticker first', () => {
    expect(destinationsFor('discord')).toBe(DISCORD_PERFILES)
    expect(defaultDestination('discord')).toBe(stickerGif)
    expect(stickerGif.id).toBe('discord-sticker-gif')
  })

  it('knows which of them has a canvas to reduce', () => {
    expect(isSticker(stickerGif)).toBe(true)
    expect(isSticker(stickerApng)).toBe(true)
    expect(isSticker(emojiGif)).toBe(false)
    expect(isSticker(PERFILES[0] ?? stickerGif)).toBe(PERFILES[0] === undefined)
  })

  it('plans an animation at the profile limit, with the canvas fixed unless asked', () => {
    const plan = planForTool('discord', choices(stickerGif))

    expect(plan.maxBytes).toBe(512_000)
    expect(plan.animation).toEqual({
      layout: { kind: 'sticker', size: 320 },
      format: 'gif',
    })
    expect(plan.animation?.allowCanvasReduction).toBeUndefined()
  })

  it('asks for the 256 px canvas only when the box is ticked, and only for a sticker', () => {
    const ticked = (destination: typeof stickerGif) => ({
      ...choices(destination),
      canvasReduction: true,
    })

    expect(planForTool('discord', ticked(stickerGif)).animation?.allowCanvasReduction).toBe(true)
    expect(planForTool('discord', ticked(stickerApng)).animation).toMatchObject({
      format: 'apng',
      allowCanvasReduction: true,
    })
    // An emoji is shrunk instead, so the choice must not leak into its plan.
    expect(planForTool('discord', ticked(emojiGif)).animation?.allowCanvasReduction).toBeUndefined()
    expect(planForTool('discord', ticked(emojiGif)).maxBytes).toBe(256_000)
  })

  it('measures every row against the same profile the plan was made from', () => {
    const ticked = { ...choices(stickerGif), canvasReduction: true }

    expect(profileForTool('discord', ticked).animation?.allowCanvasReduction).toBe(true)
    expect(profileForTool('discord', choices(stickerGif))).toBe(stickerGif)
  })

  it('does not hand the weight ceiling or the other tools choices to Discord', () => {
    expect(planForTool('discord', choices(stickerGif)).format).toBe('keep')
  })

  it('never gives an animation to the tools whose destinations are not Discord', () => {
    const web = PERFILES[0] ?? stickerGif

    for (const tool of ['comprimir', 'redimensionar', 'convertir', 'quitar-exif'] as const) {
      expect(planForTool(tool, choices(web)).animation, tool).toBeUndefined()
    }
  })
})
