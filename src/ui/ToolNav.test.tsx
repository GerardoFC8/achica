import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ToolId } from '../tools/registry'
import { CopyProvider, en, es, type Copy } from './copy'
import { ToolProvider } from './tool-context'
import { ToolNav } from './ToolNav'

const html = (copy: Copy, tool: ToolId): string =>
  renderToStaticMarkup(
    <CopyProvider value={copy}>
      <ToolProvider value={tool}>
        <ToolNav />
      </ToolProvider>
    </CopyProvider>,
  )

describe('ToolNav', () => {
  it('links to the other tools in Spanish, from the registry', () => {
    const markup = html(es, 'comprimir')

    expect(markup).toContain('href="/redimensionar-imagenes/"')
    expect(markup).toContain('href="/convertir-imagenes/"')
    expect(markup).not.toContain('/en/')
  })

  it('links to the other tools in English on the English page', () => {
    const markup = html(en, 'convertir')

    expect(markup).toContain('href="/en/"')
    expect(markup).toContain('href="/en/resize-images/"')
    expect(markup).not.toContain('href="/en/convert-images/"')
    expect(markup).toContain('>Compress</a>')
  })

  it('marks the current tool, and does not make it a link', () => {
    const markup = html(es, 'redimensionar')

    expect(markup.match(/aria-current="page"/g)).toHaveLength(1)
    expect(markup).toMatch(/<span[^>]*aria-current="page"[^>]*>Redimensionar<\/span>/)
    expect(markup).not.toContain('href="/redimensionar-imagenes/"')
    expect(markup.match(/<a /g)).toHaveLength(3)
  })

  it('is a labelled landmark', () => {
    expect(html(es, 'comprimir')).toContain('<nav aria-label="Herramientas">')
    expect(html(en, 'comprimir')).toContain('<nav aria-label="Tools">')
  })
})
