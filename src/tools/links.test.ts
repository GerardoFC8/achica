import { describe, expect, it } from 'vitest'
import { linksIn, pathFor } from './links'
import { REGISTRY, TOOL_IDS, isToolId } from './registry'

describe('links', () => {
  it('finds a tool in each language from the registry', () => {
    expect(pathFor('redimensionar', 'es')).toBe('/redimensionar-imagenes/')
    expect(pathFor('redimensionar', 'en')).toBe('/en/resize-images/')
    expect(pathFor('convertir', 'en')).toBe('/en/convert-images/')
    expect(pathFor('comprimir', 'es')).toBe('/')
  })

  it('lists every tool once per language, in registry order', () => {
    for (const language of REGISTRY.languages) {
      expect(linksIn(language).map((link) => link.id)).toEqual(TOOL_IDS)
    }
  })

  it('keeps every English route under /en/ and no Spanish one', () => {
    for (const tool of TOOL_IDS) {
      expect(pathFor(tool, 'en').startsWith('/en/')).toBe(true)
      expect(pathFor(tool, 'es').startsWith('/en/')).toBe(false)
    }
  })

  it('knows which strings are tools', () => {
    expect(isToolId('convertir')).toBe(true)
    expect(isToolId('no-existe')).toBe(false)
    expect(isToolId('')).toBe(false)
  })
})
