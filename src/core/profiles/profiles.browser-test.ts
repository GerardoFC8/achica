import { describe, expect, it } from 'vitest'
import { PERFILES_GENERICOS, toOutputPlan } from './index'
import { processImage } from '../pipeline'

/**
 * Every shipped profile, applied to a real photo.
 *
 * A profile is data, so the way it goes wrong is not a crash: it is a limit
 * that quietly does not hold. This checks the output against what each profile
 * promised, which is the only claim the interface will be making to the user.
 */

const FIXTURE_URLS = import.meta.glob('../../../test/fixtures/**/Landscape_6.jpg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

async function photoBytes(): Promise<ArrayBuffer> {
  const url = Object.values(FIXTURE_URLS)[0]
  if (url === undefined) throw new Error('Landscape_6.jpg fixture not found')
  return (await fetch(url)).arrayBuffer()
}

describe('shipped profiles applied end to end', () => {
  it.each(PERFILES_GENERICOS.map((profile) => [profile.id, profile] as const))(
    'honours every limit declared by %s',
    async (_id, profile) => {
      const result = await processImage(await photoBytes(), toOutputPlan(profile))

      expect(result.ok).toBe(true)
      if (!result.ok) return

      const outcome = result.value

      if (profile.format !== 'keep') expect(outcome.format).toBe(profile.format)
      if (profile.maxWidth !== undefined)
        expect(outcome.width).toBeLessThanOrEqual(profile.maxWidth)
      if (profile.maxHeight !== undefined) {
        expect(outcome.height).toBeLessThanOrEqual(profile.maxHeight)
      }
      if (profile.maxBytes !== undefined) {
        expect(outcome.withinBudget).toBe(true)
        expect(outcome.bytesAfter).toBeLessThanOrEqual(profile.maxBytes)
      }

      // A profile that produced a bigger file than it was handed would be
      // worse than useless, whatever else it got right.
      expect(outcome.bytesAfter).toBeLessThan(outcome.bytesBefore)
    },
  )

  it('keeps the aspect ratio through a profile that bounds both sides', async () => {
    const thumbnail = PERFILES_GENERICOS.find((profile) => profile.id === 'miniatura')
    expect(thumbnail).toBeDefined()
    if (thumbnail === undefined) return

    const result = await processImage(await photoBytes(), toOutputPlan(thumbnail))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The source is 1800x1200 after orientation, so a 400x400 box gives 400x267.
    expect(result.value.width).toBe(400)
    expect(result.value.height).toBe(267)
  })
})
