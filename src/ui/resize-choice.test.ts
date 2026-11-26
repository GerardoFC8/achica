import { describe, expect, it } from 'vitest'
import { toOutputPlan } from '../core/profiles'
import { en, es } from './copy'
import {
  BOX_PRESETS,
  DEFAULT_RESIZE,
  parseBox,
  parsePercent,
  parsePixels,
  profileForResize,
  resizeSummary,
} from './resize-choice'

describe('parsePercent', () => {
  it('takes whole numbers from 1 to 99, with or without the sign', () => {
    expect(parsePercent('50')).toBe(50)
    expect(parsePercent(' 1 ')).toBe(1)
    expect(parsePercent('99')).toBe(99)
    expect(parsePercent('50%')).toBe(50)
    expect(parsePercent('50 %')).toBe(50)
  })

  it('refuses the edges, blanks, words and fractions, with either decimal mark', () => {
    for (const text of ['', '  ', '0', '100', '150', '-5', 'mucho', '5 0', '50,5', '50.5', '1e1']) {
      expect(parsePercent(text), text).toBeNull()
    }
  })
})

describe('parsePixels', () => {
  it('takes whole numbers from 1 to 20 000, with or without the unit', () => {
    expect(parsePixels('1')).toBe(1)
    expect(parsePixels('1920')).toBe(1920)
    expect(parsePixels('20000')).toBe(20_000)
    expect(parsePixels('800 px')).toBe(800)
    expect(parsePixels('800PX')).toBe(800)
  })

  it('refuses out-of-range, blank and fractional input', () => {
    for (const text of ['', '0', '20001', '-1', '12,5', '12.5', 'ancho']) {
      expect(parsePixels(text), text).toBeNull()
    }
  })
})

describe('parseBox', () => {
  it('accepts one side or both', () => {
    expect(parseBox('400', '')).toEqual({ mode: 'box', width: 400, height: null })
    expect(parseBox('', '300')).toEqual({ mode: 'box', width: null, height: 300 })
    expect(parseBox('400', '300')).toEqual({ mode: 'box', width: 400, height: 300 })
  })

  it('is not a choice when both are blank or either typed side is invalid', () => {
    expect(parseBox('', '')).toBeNull()
    expect(parseBox('  ', '')).toBeNull()
    expect(parseBox('400', 'x')).toBeNull()
    expect(parseBox('0', '300')).toBeNull()
    expect(parseBox('30000', '')).toBeNull()
  })
})

describe('profileForResize', () => {
  it('turns a percentage into a scale, keeping the format at the fixed quality', () => {
    const profile = profileForResize({ mode: 'percent', percent: 75 })

    expect(profile).toMatchObject({
      group: 'Tamaño',
      format: 'keep',
      scale: 0.75,
      quality: 85,
      stripMetadata: true,
    })
    expect(profile.maxWidth).toBeUndefined()
    expect(profile.note).toMatch(/75 %/)
    expect(toOutputPlan(profile)).toEqual({ format: 'keep', scale: 0.75, quality: 85 })
  })

  it('turns a box into limits, setting only the sides given', () => {
    const wide = profileForResize({ mode: 'box', width: 1920, height: null })
    expect(wide.maxWidth).toBe(1920)
    expect(wide.maxHeight).toBeUndefined()
    expect(wide.scale).toBeUndefined()

    const both = profileForResize({ mode: 'box', width: 1920, height: 1080 })
    expect(toOutputPlan(both)).toEqual({
      format: 'keep',
      maxWidth: 1920,
      maxHeight: 1080,
      quality: 85,
    })
  })

  it('gives each choice its own id, so two choices are never taken for one', () => {
    const ids = [
      DEFAULT_RESIZE,
      { mode: 'percent', percent: 25 } as const,
      ...BOX_PRESETS.map((preset) => ({ mode: 'box', ...preset }) as const),
    ].map((choice) => profileForResize(choice).id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('starts at 50 %', () => {
    expect(profileForResize(DEFAULT_RESIZE).scale).toBe(0.5)
  })

  it('names no platform in anything it says', () => {
    const text = BOX_PRESETS.map((preset) =>
      JSON.stringify(profileForResize({ mode: 'box', ...preset })),
    ).join(' ')
    expect(text).not.toMatch(/instagram|whatsapp|facebook|youtube|twitter|discord|tiktok/i)
  })
})

describe('resizeSummary', () => {
  it('reads in the page language', () => {
    expect(resizeSummary({ mode: 'percent', percent: 50 }, es.resize)).toBe('50 %')
    expect(resizeSummary({ mode: 'percent', percent: 50 }, en.resize)).toBe('50%')
    expect(resizeSummary({ mode: 'box', width: 1920, height: 1080 }, es.resize)).toBe(
      'máx. 1920 × 1080 px',
    )
    expect(resizeSummary({ mode: 'box', width: 1280, height: null }, en.resize)).toBe(
      'max. 1280 px wide',
    )
    expect(resizeSummary({ mode: 'box', width: null, height: 600 }, es.resize)).toBe(
      'máx. 600 px de alto',
    )
  })
})
