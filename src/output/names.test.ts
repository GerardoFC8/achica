import { describe, expect, it } from 'vitest'
import { outputName, uniqueNames } from './names'

/**
 * Naming is the part of saving that has no browser in it, so it is decided
 * here and both paths — writing into a folder and streaming a ZIP — get the
 * same answer. Getting it wrong costs the user a file: a collision in a folder
 * overwrites silently, and a collision inside a ZIP produces an archive whose
 * entries some tools refuse and others silently drop.
 */

describe('outputName', () => {
  it('swaps the extension for the format that was actually produced', () => {
    expect(outputName('foto.jpg', 'webp')).toBe('foto.webp')
  })

  it('leaves the rest of the name alone, dots included', () => {
    expect(outputName('captura 2026.08.11 final.png', 'jpeg')).toBe('captura 2026.08.11 final.jpg')
  })

  it('adds an extension to a name that had none', () => {
    expect(outputName('escaneo', 'png')).toBe('escaneo.png')
  })

  it('writes jpeg as .jpg, which is what everything else writes', () => {
    // The format is named jpeg throughout the core; the file extension people
    // and operating systems expect is .jpg.
    expect(outputName('foto.jpeg', 'jpeg')).toBe('foto.jpg')
  })

  it('keeps a name that is only an extension from becoming empty', () => {
    expect(outputName('.gitignore', 'png')).toBe('.gitignore.png')
  })
})

describe('uniqueNames', () => {
  it('leaves distinct names untouched', () => {
    expect(uniqueNames(['a.webp', 'b.webp'])).toEqual(['a.webp', 'b.webp'])
  })

  it('suffixes a repeat instead of overwriting it', () => {
    // Two folders of holiday photos both containing IMG_0001.jpg is the normal
    // case, not the exotic one.
    expect(uniqueNames(['foto.webp', 'foto.webp'])).toEqual(['foto.webp', 'foto-2.webp'])
  })

  it('keeps counting past the second collision', () => {
    expect(uniqueNames(['f.webp', 'f.webp', 'f.webp'])).toEqual(['f.webp', 'f-2.webp', 'f-3.webp'])
  })

  it('puts the suffix before the extension, where it belongs', () => {
    // foto.webp-2 would stop being a webp as far as the system is concerned.
    expect(uniqueNames(['foto.webp', 'foto.webp'])[1]).toMatch(/\.webp$/)
  })

  it('does not collide with a name that already looks like a suffix', () => {
    // The user really has a file called foto-2, and a second foto. Handing
    // both the same name is the exact bug this function exists to prevent.
    expect(uniqueNames(['foto.webp', 'foto-2.webp', 'foto.webp'])).toEqual([
      'foto.webp',
      'foto-2.webp',
      'foto-3.webp',
    ])
  })

  it('compares names the way a file system does, ignoring case', () => {
    // Windows and macOS treat Foto.webp and foto.webp as the same file, so
    // writing both into a folder loses one of them.
    expect(uniqueNames(['Foto.webp', 'foto.webp'])).toEqual(['Foto.webp', 'foto-2.webp'])
  })
})
