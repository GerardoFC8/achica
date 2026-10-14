import { describe, expect, it } from 'vitest'
import { render } from './prerender'

describe('the prerendered first screen', () => {
  const html = render()

  it('is the work surface, headed by what to do there', () => {
    expect(html).toMatch(/<h1[^>]*>Arrastra aquí las imágenes que quieres comprimir<\/h1>/)
    expect(html).toContain('Nada sale de tu dispositivo')
  })

  it('carries the file input, so the page is usable the moment it loads', () => {
    expect(html).toContain('type="file"')
  })

  it('holds one main landmark, not one inside another', () => {
    expect(html.match(/<main[\s>]/g)).toHaveLength(1)
  })
})
