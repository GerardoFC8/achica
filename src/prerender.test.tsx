import { describe, expect, it } from 'vitest'
import { render } from './prerender'

describe('the prerendered first screen', () => {
  const html = render('es')

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

  it('links to the other language as a page a crawler can follow', () => {
    expect(html).toMatch(/<a[^>]*href="\/en\/"[^>]*hrefLang="en"/)
  })

  it('renders the English page in English', () => {
    const english = render('en')

    expect(english).toMatch(/<h1[^>]*>Drop the images you want to compress here<\/h1>/)
    expect(english).toContain('Image for a web article')
    expect(english).toMatch(/<a[^>]*href="\/"[^>]*hrefLang="es"/)
  })
})
