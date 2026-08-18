import { describe, expect, it } from 'vitest'
import { PERFILES, toOutputPlan } from './index'
import { processImage } from '../pipeline'

/**
 * Every shipped profile, applied to a real file.
 *
 * A profile is data, so the way it goes wrong is not a crash: it is a limit
 * that quietly does not hold. This checks the output against what each profile
 * promised, which is the only claim the interface will be making to the user.
 */

const PHOTO_URLS = import.meta.glob('../../../test/fixtures/**/Landscape_6.jpg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

const PNG_URLS = import.meta.glob('../../../test/fixtures/**/basn6a08.png', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

async function bytesOf(urls: Record<string, string>, name: string): Promise<ArrayBuffer> {
  const url = Object.values(urls)[0]
  if (url === undefined) throw new Error(`${name} fixture not found`)
  return (await fetch(url)).arrayBuffer()
}

const photoBytes = (): Promise<ArrayBuffer> => bytesOf(PHOTO_URLS, 'Landscape_6.jpg')
const pngBytes = (): Promise<ArrayBuffer> => bytesOf(PNG_URLS, 'basn6a08.png')

describe('shipped profiles applied end to end', () => {
  it.each(PERFILES.map((profile) => [profile.id, profile] as const))(
    'honours every limit declared by %s',
    async (_id, profile) => {
      const result = await processImage(await photoBytes(), toOutputPlan(profile))

      expect(result.ok).toBe(true)
      if (!result.ok) return

      const outcome = result.value

      // `keep` is a promise too, and on a JPEG source it means JPEG out.
      if (profile.format === 'keep') expect(outcome.format).toBe('jpeg')
      else expect(outcome.format).toBe(profile.format)

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
    const thumbnail = PERFILES.find((profile) => profile.id === 'miniatura')
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

/**
 * The extension promise (D49).
 *
 * Three of the four profiles hand back the format they were given, and that is
 * the guarantee the notes make to the user: the file they look for afterwards
 * has the name they expect, and a PNG's transparency survives. Asserting it on
 * a JPEG source proves nothing — JPEG is what a conversion would have produced
 * anyway — so it is checked with a PNG, where keeping and converting differ.
 */
describe('the extension promise', () => {
  const keepers = PERFILES.filter((profile) => profile.format === 'keep')

  it('ships at least one converting profile and several that keep', () => {
    // Guards the test below against silently becoming vacuous.
    expect(keepers.length).toBeGreaterThan(0)
    expect(PERFILES.some((profile) => profile.format !== 'keep')).toBe(true)
  })

  it.each(keepers.map((profile) => [profile.id, profile] as const))(
    'leaves a PNG as a PNG through %s',
    async (_id, profile) => {
      const result = await processImage(await pngBytes(), toOutputPlan(profile))

      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.value.format).toBe('png')
      // PNG is lossless, so there is no quality to report and reporting one
      // would imply a knob the format does not have.
      expect(result.value.quality).toBeNull()
    },
  )

  it('converts a PNG to WebP through the web profile, because that is its point', async () => {
    const web = PERFILES.find((profile) => profile.id === 'web-articulo')
    expect(web).toBeDefined()
    if (web === undefined) return

    const result = await processImage(await pngBytes(), toOutputPlan(web))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.format).toBe('webp')
  })
})

/**
 * The compression promise on a lossless format (D50).
 *
 * A profile that keeps the format has no quality to lower, so the only
 * compression it can offer is a better-packed PNG. The source here is written
 * by `@jsquash/png/encode` on purpose: that is what an ordinary PNG from a
 * screenshot tool or an export dialog looks like, and it is the file the user
 * actually drops in.
 */
describe('a PNG through a profile that keeps the format', () => {
  async function ordinaryPngBytes(): Promise<ArrayBuffer> {
    const { default: naiveEncode } = await import('@jsquash/png/encode')
    const { decodeImage } = await import('../codecs/decode')

    const decoded = await decodeImage('jpeg', await photoBytes())
    if (!decoded.ok) throw new Error('fixture failed to decode')
    return naiveEncode(decoded.value)
  }

  it.each(
    PERFILES.filter((profile) => profile.format === 'keep').map(
      (profile) => [profile.id, profile] as const,
    ),
  )('comes out smaller than it went in through %s', async (_id, profile) => {
    const source = await ordinaryPngBytes()

    const result = await processImage(source, toOutputPlan(profile))

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.format).toBe('png')
    expect(result.value.bytesAfter).toBeLessThan(result.value.bytesBefore)
  })
})
