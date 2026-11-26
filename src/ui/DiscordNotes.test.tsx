import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DISCORD_PERFILES, PERFILES, type Profile } from '../core/profiles'
import { CopyProvider, en, es, type Copy } from './copy'
import { CanvasChoice, RequirementLine } from './DiscordNotes'

/**
 * Where a Discord limit comes from has to be on the screen (D48): a source a
 * person can open and the day it was checked. The picker's panel is closed in
 * a static render, so the pieces are rendered on their own.
 */

const html = (copy: Copy, node: React.ReactNode): string =>
  renderToStaticMarkup(<CopyProvider value={copy}>{node}</CopyProvider>)

describe('the source of a requirement', () => {
  it.each(DISCORD_PERFILES)('names the source and the date of $id', (profile) => {
    const markup = html(es, <RequirementLine profile={profile} />)

    expect(markup).toContain(`href="${profile.requirement.source}"`)
    expect(markup).toContain(profile.requirement.verifiedAt)
    expect(markup).toContain('support.discord.com')
  })

  it('opens in another tab without handing over the opener or the referrer', () => {
    for (const profile of DISCORD_PERFILES) {
      const markup = html(en, <RequirementLine profile={profile} />)

      expect(markup).toContain('target="_blank"')
      expect(markup).toContain('rel="noopener noreferrer"')
      expect(markup).toContain('Source:')
      expect(markup).toContain('verified on 2026-11-26')
    }
  })

  it('is the only external link, and it is plain text, not an image or a script', () => {
    const markup = html(
      es,
      <RequirementLine profile={DISCORD_PERFILES[0] as (typeof DISCORD_PERFILES)[number]} />,
    )

    expect(markup.match(/<a /g)).toHaveLength(1)
    expect(markup).not.toMatch(/<(img|script|iframe|link)/)
  })

  it('says nothing for a destination that is our own advice', () => {
    expect(html(es, <RequirementLine profile={PERFILES[0] as Profile} />)).toBe('')
  })
})

describe('the canvas option', () => {
  it('is a checkbox, off until it is ticked, with the honest sentence beside it', () => {
    const off = html(es, <CanvasChoice checked={false} onChange={() => undefined} />)
    const on = html(es, <CanvasChoice checked onChange={() => undefined} />)

    expect(off).toContain('type="checkbox"')
    expect(off).not.toContain('checked')
    expect(on).toContain('checked')
    expect(off).toContain('Si no entra, reducir el lienzo a 256 px')
    expect(off).toContain('Discord lo aceptó en nuestras pruebas, pero su pantalla pide 320 × 320')
  })

  it('reads in English too', () => {
    const markup = html(en, <CanvasChoice checked={false} onChange={() => undefined} />)

    expect(markup).toContain('If it does not fit, reduce the canvas to 256 px')
    expect(markup).toContain('320 × 320')
  })
})
