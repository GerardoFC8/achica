import { describe, expect, it } from 'vitest'
import { PERFILES } from '../../core/profiles'
import { copyFor, en, es } from '.'
import { PROFILE_TEXT } from './en'

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
