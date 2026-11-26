import { describe, expect, it } from 'vitest'
import { DISCORD_PERFILES, PERFILES } from '../../core/profiles'
import { copyFor, en, es } from '.'
import { PROFILE_TEXT } from './en'
import { AUDIT_PROFILE } from '../tool-profiles'

/**
 * The type makes the English catalogue complete; these check what a type
 * cannot: that every destination reads in English, and that no Spanish
 * sentence was pasted in and left there.
 */

/** Every sentence a catalogue can produce, functions called with stand-ins. */
function sentencesOf(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (typeof value === 'function') {
    try {
      return sentencesOf((value as (...args: unknown[]) => unknown)(2, '2', '2'))
    } catch {
      // Takes a richer argument, such as a profile; covered on its own below.
      return []
    }
  }
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(sentencesOf)
  return []
}

describe('the English catalogue', () => {
  it('names and explains every destination', () => {
    for (const profile of PERFILES) {
      const text = en.destination.profile(profile)
      expect(PROFILE_TEXT[profile.id], profile.id).toBeDefined()
      expect(text.label).not.toBe(profile.label)
      expect(text.note?.length ?? 0).toBeGreaterThan(20)
    }
  })

  it('names and explains the Discord destinations too', () => {
    for (const profile of DISCORD_PERFILES) {
      const text = en.destination.profile(profile)
      expect(PROFILE_TEXT[profile.id], profile.id).toBeDefined()
      expect(text.label).not.toBe(profile.label)
      expect(text.note?.length ?? 0).toBeGreaterThan(20)
      expect(en.destination.group(profile.group)).toBe('Discord')
    }
  })

  it('names and explains the audit destination too', () => {
    const text = en.destination.profile(AUDIT_PROFILE)

    expect(PROFILE_TEXT[AUDIT_PROFILE.id]).toBeDefined()
    expect(text.label).not.toBe(AUDIT_PROFILE.label)
    expect(text.note?.length ?? 0).toBeGreaterThan(20)
    expect(en.destination.group(AUDIT_PROFILE.group)).not.toBe(AUDIT_PROFILE.group)
  })

  it('carries no Spanish', () => {
    // Codes, not sentences: 'en' would trip the guard below on its own.
    const { otherLanguage, lang, numberLocale, ...rest } = en
    expect([lang, numberLocale]).toEqual(['en', 'en-US'])
    // The link to the Spanish page is the one place Spanish belongs.
    expect(otherLanguage.label).toBe('Español')

    for (const sentence of sentencesOf(rest)) {
      expect(sentence, sentence).not.toMatch(
        /[áéíóúñ¿¡]|\b(de|del|la|las|el|los|que|con|sin|contra|para|por|una|en|y)\b/i,
      )
    }
  })

  it('has as many sentences as the Spanish one', () => {
    expect(sentencesOf(en)).toHaveLength(sentencesOf(es).length)
  })
})

describe('copyFor', () => {
  it('follows the page language and falls back to Spanish', () => {
    expect(copyFor('en')).toBe(en)
    expect(copyFor('es')).toBe(es)
    expect(copyFor('')).toBe(es)
  })
})

describe('the reasons an image cannot be measured', () => {
  // Every SkipReason the reader can report. The catalogue is typed by it, so a
  // new reason does not compile without words; this also checks the words are
  // there and are not a leftover of the other language.
  const REASONS = [
    'no-content',
    'cached',
    'unsupported-format',
    'unreadable-content',
    'partial',
    'failed-request',
  ] as const

  it.each([es, en])('has words for each of them in $lang', (copy) => {
    const words = copy.audit.summary.reasons

    expect(Object.keys(words).toSorted()).toEqual([...REASONS].toSorted())
    for (const reason of REASONS) expect(words[reason].length, reason).toBeGreaterThan(8)
  })

  it('tells the user how to fix a missing body, in both languages', () => {
    expect(es.audit.summary.reasons['no-content']).toMatch(/exportarlo.*contenido/)
    expect(en.audit.summary.reasons['no-content']).toMatch(/export it again.*contents/)
  })

  it('does not say the page "would weigh" anything', () => {
    for (const sentence of [...sentencesOf(es.audit), ...sentencesOf(en.audit)]) {
      expect(sentence).not.toMatch(/tu página pesaría|your page would weigh/i)
    }
  })
})
