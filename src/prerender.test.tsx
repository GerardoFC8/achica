import { beforeAll, describe, expect, it } from 'vitest'
import { render } from './prerender'

describe('the prerendered first screen', () => {
  let html = ''

  beforeAll(async () => {
    html = await render('es', 'comprimir')
  })

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

  it('says it is the compressor in the navigation, linking to the others', () => {
    expect(html).toMatch(/<span[^>]*aria-current="page"[^>]*>Comprimir<\/span>/)
    expect(html).toMatch(/<a[^>]*href="\/redimensionar-imagenes\/"[^>]*>Redimensionar<\/a>/)
    expect(html).toMatch(/<a[^>]*href="\/convertir-imagenes\/"[^>]*>Convertir<\/a>/)
  })

  it('renders every other tool as its own page, its twin one language away', async () => {
    const resize = await render('es', 'redimensionar')
    expect(resize).toMatch(/<h1[^>]*>Arrastra aquí las imágenes que quieres redimensionar<\/h1>/)
    expect(resize).toMatch(/<a[^>]*href="\/en\/resize-images\/"[^>]*hrefLang="en"/)

    const convert = await render('en', 'convertir')
    expect(convert).toMatch(/<h1[^>]*>Drop the images you want to convert here<\/h1>/)
    expect(convert).toMatch(/<a[^>]*href="\/convertir-imagenes\/"[^>]*hrefLang="es"/)
    expect(convert).toMatch(/<a[^>]*href="\/en\/resize-images\/"[^>]*>Resize<\/a>/)
  })

  it('refuses a tool that is not registered', async () => {
    await expect(render('es', 'no-existe')).rejects.toThrow(/no-existe/)
  })

  it('renders the English page in English', async () => {
    const english = await render('en', 'comprimir')

    expect(english).toMatch(/<h1[^>]*>Drop the images you want to compress here<\/h1>/)
    expect(english).toContain('Image for a web article')
    expect(english).toMatch(/<a[^>]*href="\/"[^>]*hrefLang="es"/)
  })
})
