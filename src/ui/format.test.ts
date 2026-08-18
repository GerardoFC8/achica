import { describe, expect, it } from 'vitest'
import { createFormatters, DEFAULT_LOCALE, preferredLocale } from './format'

/**
 * Every number the interface shows passes through here, so the locale is an
 * argument rather than something read from the platform. That is what makes
 * these assertions the same on any machine.
 */

describe('preferredLocale', () => {
  it('keeps the browser language when it is Spanish', () => {
    expect(preferredLocale(['es-PE', 'en-US'])).toBe('es-PE')
  })

  it('skips languages the interface is not written in', () => {
    // The interface is Spanish in v1. Formatting German numbers inside Spanish
    // copy mixes two conventions in one sentence.
    expect(preferredLocale(['de-DE', 'es-AR'])).toBe('es-AR')
  })

  it('falls back to Latin American Spanish when nothing matches', () => {
    expect(preferredLocale(['en-US'])).toBe(DEFAULT_LOCALE)
    expect(preferredLocale([])).toBe(DEFAULT_LOCALE)
  })

  it('defaults to the region the paperwork profiles are for', () => {
    // Verified: `es` renders 1.234.567,89 and `es-419` renders 1,234,567.89.
    expect(DEFAULT_LOCALE).toBe('es-419')
  })
})

describe('bytes', () => {
  const { bytes } = createFormatters(DEFAULT_LOCALE)

  it('counts in thousands, because the budgets are round thousands', () => {
    // A profile that says "máx. 500 KB" has maxBytes 500000. Dividing by 1024
    // would print that same limit as 488 KB, right next to its own label.
    expect(bytes(500_000)).toBe('500 KB')
    expect(bytes(300_000)).toBe('300 KB')
  })

  it('switches to megabytes with one decimal', () => {
    expect(bytes(6_214_400)).toBe('6.2 MB')
    expect(bytes(1_000_000)).toBe('1.0 MB')
  })

  it('never prints a bare zero for a file that has bytes', () => {
    expect(bytes(400)).toBe('0.4 KB')
  })

  it('says nothing rather than zero when there is no value', () => {
    expect(bytes(null)).toBe('—')
  })
})

describe('percent and dimensions', () => {
  const { percent, dimensions, count, ms } = createFormatters(DEFAULT_LOCALE)

  it('rounds percentages, because a saving of 66.4 % is 66 %', () => {
    expect(percent(0.664)).toBe('66%')
  })

  it('marks a result that grew instead of shrinking', () => {
    // Converting a photograph to PNG with no budget can produce a bigger file.
    // Showing that as a saving would be a lie in the direction that flatters.
    expect(percent(-0.12)).toBe('-12%')
  })

  it('separates dimensions with a multiplication sign, not the letter x', () => {
    expect(dimensions(1200, 1800)).toBe('1,200 × 1,800')
  })

  it('groups thousands in counts', () => {
    expect(count(1234)).toBe('1,234')
  })

  it('reports time in whole milliseconds', () => {
    expect(ms(1234.6)).toBe('1,235 ms')
  })
})

describe('a Spanish locale from Spain', () => {
  const { bytes, percent } = createFormatters('es-ES')

  it('uses its own separators', () => {
    expect(bytes(6_214_400)).toBe('6,2 MB')
    expect(percent(0.664)).toContain('66')
  })
})
