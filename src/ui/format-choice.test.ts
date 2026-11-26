import { describe, expect, it } from 'vitest'
import { toOutputPlan } from '../core/profiles'
import { DEFAULT_FORMAT, FORMAT_CHOICES, profileForFormat, qualityOf } from './format-choice'

describe('profileForFormat', () => {
  it('sets the format and no size at all', () => {
    for (const format of FORMAT_CHOICES) {
      const profile = profileForFormat(format)

      expect(profile.group).toBe('Formato')
      expect(profile.format).toBe(format)
      expect(profile.stripMetadata).toBe(true)
      expect(profile.scale).toBeUndefined()
      expect(profile.maxWidth).toBeUndefined()
      expect(profile.maxHeight).toBeUndefined()
      expect(profile.maxBytes).toBeUndefined()
    }
  })

  it('uses the fixed qualities, and none for the lossless format', () => {
    expect(profileForFormat('jpeg').quality).toBe(85)
    expect(profileForFormat('webp').quality).toBe(80)
    expect(profileForFormat('avif').quality).toBe(60)
    expect(profileForFormat('png').quality).toBeUndefined()
    expect(qualityOf('png')).toBeNull()
    expect(toOutputPlan(profileForFormat('png'))).toEqual({ format: 'png' })
  })

  it('has a distinct id per format and starts at WebP', () => {
    expect(new Set(FORMAT_CHOICES.map((format) => profileForFormat(format).id)).size).toBe(4)
    expect(DEFAULT_FORMAT).toBe('webp')
  })
})
