import { describe, expect, it } from 'vitest'
import {
  extensionOfKind,
  isAnimationKind,
  kindName,
  mimeTypeOfKind,
  type OutputKind,
} from './output-kind'

const KINDS: readonly OutputKind[] = ['jpeg', 'png', 'webp', 'avif', 'gif', 'apng']

describe('output kinds', () => {
  it('gives a GIF its own extension, type and name', () => {
    expect(extensionOfKind('gif')).toBe('gif')
    expect(mimeTypeOfKind('gif')).toBe('image/gif')
    expect(kindName('gif')).toBe('GIF')
  })

  it('gives an APNG a .png extension and the png type, but its own name', () => {
    expect(extensionOfKind('apng')).toBe('png')
    expect(mimeTypeOfKind('apng')).toBe('image/png')
    expect(kindName('apng')).toBe('APNG')
  })

  it('leaves the still formats as they were', () => {
    expect(extensionOfKind('jpeg')).toBe('jpg')
    expect(mimeTypeOfKind('jpeg')).toBe('image/jpeg')
    expect(mimeTypeOfKind('avif')).toBe('image/avif')
    expect(kindName('webp')).toBe('WebP')
  })

  it('tells animations from stills', () => {
    expect(KINDS.filter(isAnimationKind)).toEqual(['gif', 'apng'])
  })
})
