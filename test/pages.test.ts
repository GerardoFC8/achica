import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loaders } from '../src/tools/loaders'
import { listPages, renderPage, renderSitemap, type Registry } from '../src/tools/pages'
import { REGISTRY, type Tool } from '../src/tools/registry'

const ROOT = join(import.meta.dirname, '..')

/** The working tree may be CRLF (core.autocrlf); the generator writes LF. */
const read = (file: string): string =>
  readFileSync(join(ROOT, file), 'utf8').replaceAll('\r\n', '\n')

/**
 * A tool that does not exist, injected next to the real ones: it proves the
 * generator and the checks work for a second tool without publishing a page.
 */
const FICTIONAL: Tool = {
  id: 'ficticia',
  applicationCategory: 'MultimediaApplication',
  locales: {
    es: {
      path: '/ficticia/',
      title: 'Una herramienta que no existe | achica',
      description: 'Descripción de prueba con "comillas" y & ampersand.',
      ogTitle: 'achica: una herramienta que no existe',
      ogDescription: 'Texto de prueba.',
      ogImage: '/og.png',
      ogImageAlt: 'Imagen de prueba',
      ogLocale: 'es_ES',
      jsonLd: {
        name: 'achica ficticia',
        description: 'Prueba.',
        operatingSystem: 'Cualquiera',
        browserRequirements: 'Requiere JavaScript',
        featureList: ['Una', 'Dos'],
      },
    },
    en: {
      path: '/en/fictional/',
      title: 'A tool that does not exist | achica',
      description: 'Test description.',
      ogTitle: 'achica: a tool that does not exist',
      ogDescription: 'Test text.',
      ogImage: '/og-en.png',
      ogImageAlt: 'Test image',
      ogLocale: 'en_US',
      jsonLd: {
        name: 'achica fictional',
        description: 'Test.',
        operatingSystem: 'Any',
        browserRequirements: 'Requires JavaScript',
        featureList: ['One', 'Two'],
      },
    },
  },
}

const WITH_FICTIONAL: Registry = { ...REGISTRY, tools: [...REGISTRY.tools, FICTIONAL] }

describe('the committed pages', () => {
  // The anti-drift guard: edit the registry, run `npm run pages`, commit both.
  for (const { tool, language, file } of listPages(REGISTRY)) {
    it(`${file} is what the registry generates`, () => {
      expect(read(file)).toBe(renderPage(REGISTRY, tool, language))
    })
  }

  it('public/sitemap.xml is what the registry generates', () => {
    expect(read('public/sitemap.xml')).toBe(renderSitemap(REGISTRY))
  })
})

describe('the registry', () => {
  for (const [name, registry] of [
    ['the real one', REGISTRY],
    ['with an extra tool', WITH_FICTIONAL],
  ] as const) {
    describe(name, () => {
      const pages = listPages(registry)

      it('has unique ids', () => {
        const ids = registry.tools.map((tool) => tool.id)
        expect(new Set(ids).size).toBe(ids.length)
      })

      it('has unique routes and files, each with its slashes', () => {
        const paths = pages.map((page) => page.locale.path)
        expect(new Set(paths).size).toBe(paths.length)
        expect(new Set(pages.map((page) => page.file)).size).toBe(pages.length)
        for (const path of paths) expect(path).toMatch(/^\/([^/]+\/)*$/)
      })

      it('keeps every English route under /en/', () => {
        for (const { locale, language } of pages) {
          expect(locale.path.startsWith('/en/')).toBe(language === 'en')
        }
      })

      it('has reciprocal hreflang: each page names its twins and every twin names it back', () => {
        for (const { tool, language, locale } of pages) {
          const html = renderPage(registry, tool, language)
          for (const other of registry.languages) {
            const href = `${registry.site.origin}${tool.locales[other].path}`
            expect(html).toContain(`hreflang="${other}" href="${href}"`)
            expect(renderPage(registry, tool, other)).toContain(
              `hreflang="${language}" href="${registry.site.origin}${locale.path}"`,
            )
          }
          const fallback = tool.locales[registry.site.defaultLanguage].path
          expect(html).toContain(`hreflang="x-default" href="${registry.site.origin}${fallback}"`)
        }
      })
    })
  }

  it('has a loader for every real tool', () => {
    for (const tool of REGISTRY.tools) expect(loaders).toHaveProperty(tool.id)
  })
})

describe('the generator', () => {
  const pages = listPages(WITH_FICTIONAL)
  const fictional = pages.filter((page) => page.tool.id === 'ficticia')

  it('lists a file per language for the extra tool', () => {
    expect(fictional.map((page) => page.file)).toEqual([
      'ficticia/index.html',
      'en/fictional/index.html',
    ])
  })

  it.each(fictional)('writes a complete page for $file', ({ tool, language, locale }) => {
    const html = renderPage(WITH_FICTIONAL, tool, language)

    expect(html).toContain(`<html lang="${language}">`)
    expect(html).toContain('<body data-tool="ficticia">')
    expect(html).toContain('<div id="app"></div>')
    expect(html).toContain(`href="https://achica.gfcode.dev${locale.path}"`)
    expect(html).toContain('rel="canonical"')
    expect(html).toContain(`<title>${locale.title}</title>`)
    expect(html).toContain('property="og:image:alt"')
    expect(html).toContain('name="twitter:card"')

    const jsonLd = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1]
    const parsed = JSON.parse(jsonLd ?? '') as Record<string, unknown>
    expect(parsed['@type']).toBe('WebApplication')
    expect(parsed['name']).toBe(locale.jsonLd.name)
    expect(parsed['inLanguage']).toBe(language)
    expect(parsed['featureList']).toEqual(locale.jsonLd.featureList)
  })

  it('escapes what would break an attribute', () => {
    const html = renderPage(WITH_FICTIONAL, FICTIONAL, 'es')
    expect(html).toContain(
      'content="Descripción de prueba con &quot;comillas&quot; y &amp; ampersand."',
    )
  })

  it('lists every page in the sitemap, with its alternates', () => {
    const sitemap = renderSitemap(WITH_FICTIONAL)

    for (const { locale } of pages) {
      expect(sitemap).toContain(`<loc>https://achica.gfcode.dev${locale.path}</loc>`)
    }
    expect(sitemap.match(/<url>/g)).toHaveLength(pages.length)
    expect(sitemap).toContain('hreflang="en" href="https://achica.gfcode.dev/en/fictional/"')
  })
})
