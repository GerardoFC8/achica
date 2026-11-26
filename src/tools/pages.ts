/**
 * Turns the registry into the files a static host serves: one HTML page per
 * tool and language, and the sitemap that lists them all (D57).
 *
 * Pure functions from data to strings. No Node, no DOM, and no runtime import:
 * the registry arrives as an argument, which is also what lets a test inject a
 * tool that is not published. scripts/pages.mjs does the writing, and
 * test/pages.test.ts fails when the committed files drift from this output.
 *
 * The markup is laid out the way Prettier lays it out (a tag that does not fit
 * in 100 columns puts one attribute per line), so `npm run pages` followed by
 * a format check changes nothing.
 */

import type { Language, Tool, ToolLocale } from './registry.ts'

/** The registry, in the shape these functions take. */
export interface Registry {
  languages: readonly Language[]
  site: {
    origin: string
    name: string
    themeColor: string
    ogImageWidth: number
    ogImageHeight: number
    defaultLanguage: Language
  }
  tools: readonly Tool[]
}

export interface Page {
  tool: Tool
  language: Language
  locale: ToolLocale
  /** The file the page is written to, relative to the site root. */
  file: string
}

const WIDTH = 100
const INDENT = '    '

const escapeAttribute = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')

const escapeText = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')

type Attributes = readonly (readonly [string, string])[]

/** A void element: on one line if it fits, one attribute per line if not. */
function tag(name: string, attributes: Attributes): string {
  const pairs = attributes.map(([key, value]) => `${key}="${escapeAttribute(value)}"`)
  const line = `${INDENT}<${name} ${pairs.join(' ')} />`

  if (line.length <= WIDTH) return line

  return [`${INDENT}<${name}`, ...pairs.map((pair) => `${INDENT}  ${pair}`), `${INDENT}/>`].join(
    '\n',
  )
}

const meta = (key: 'name' | 'property', name: string, content: string): string =>
  tag('meta', [
    [key, name],
    ['content', content],
  ])

/** Where a route's file lives, relative to the site root: `/en/` is `en/index.html`. */
export function fileForPath(path: string): string {
  return `${path.slice(1)}index.html`
}

/** The absolute URL of a route. */
export function urlForPath(registry: Registry, path: string): string {
  return `${registry.site.origin}${path}`
}

/** Every page of the registry, in registry order. */
export function listPages(registry: Registry): Page[] {
  return registry.tools.flatMap((tool) =>
    registry.languages.map((language) => {
      const locale = tool.locales[language]
      return { tool, language, locale, file: fileForPath(locale.path) }
    }),
  )
}

/** The HTML of one tool in one language, before the build fills in the first screen. */
export function renderPage(registry: Registry, tool: Tool, language: Language): string {
  const { site } = registry
  const locale = tool.locales[language]
  const url = urlForPath(registry, locale.path)
  const json = (value: string): string => JSON.stringify(value)

  const lines = [
    '<!doctype html>',
    `<html lang="${language}">`,
    '  <head>',
    tag('meta', [['charset', 'UTF-8']]),
    meta('name', 'viewport', 'width=device-width, initial-scale=1.0'),
    `${INDENT}<title>${escapeText(locale.title)}</title>`,
    meta('name', 'description', locale.description),
    tag('link', [
      ['rel', 'canonical'],
      ['href', url],
    ]),
    ...registry.languages.map((other) =>
      tag('link', [
        ['rel', 'alternate'],
        ['hreflang', other],
        ['href', urlForPath(registry, tool.locales[other].path)],
      ]),
    ),
    tag('link', [
      ['rel', 'alternate'],
      ['hreflang', 'x-default'],
      ['href', urlForPath(registry, tool.locales[site.defaultLanguage].path)],
    ]),
    meta('name', 'theme-color', site.themeColor),
    tag('link', [
      ['rel', 'icon'],
      ['href', '/favicon.svg'],
      ['type', 'image/svg+xml'],
    ]),
    tag('link', [
      ['rel', 'apple-touch-icon'],
      ['href', '/apple-touch-icon.png'],
    ]),
    '',
    `${INDENT}<!--`,
    `${INDENT}  Read by the link previews of WhatsApp, X, LinkedIn and Slack, none of`,
    `${INDENT}  which run JavaScript. Absolute URLs because a crawler resolves nothing.`,
    `${INDENT}-->`,
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', site.name),
    meta('property', 'og:locale', locale.ogLocale),
    ...registry.languages
      .filter((other) => other !== language)
      .map((other) => meta('property', 'og:locale:alternate', tool.locales[other].ogLocale)),
    meta('property', 'og:url', url),
    meta('property', 'og:title', locale.ogTitle),
    meta('property', 'og:description', locale.ogDescription),
    meta('property', 'og:image', `${site.origin}${locale.ogImage}`),
    meta('property', 'og:image:width', String(site.ogImageWidth)),
    meta('property', 'og:image:height', String(site.ogImageHeight)),
    meta('property', 'og:image:alt', locale.ogImageAlt),
    meta('name', 'twitter:card', 'summary_large_image'),
    '',
    `${INDENT}<script type="application/ld+json">`,
    '      {',
    '        "@context": "https://schema.org",',
    '        "@type": "WebApplication",',
    `        "name": ${json(locale.jsonLd.name)},`,
    `        "url": ${json(url)},`,
    `        "description": ${json(locale.jsonLd.description)},`,
    `        "applicationCategory": ${json(tool.applicationCategory)},`,
    `        "operatingSystem": ${json(locale.jsonLd.operatingSystem)},`,
    `        "browserRequirements": ${json(locale.jsonLd.browserRequirements)},`,
    `        "inLanguage": ${json(language)},`,
    '        "isAccessibleForFree": true,',
    '        "license": "https://opensource.org/licenses/MIT",',
    '        "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },',
    '        "featureList": [',
    locale.jsonLd.featureList.map((feature) => `          ${json(feature)}`).join(',\n'),
    '        ]',
    '      }',
    `${INDENT}</script>`,
    '  </head>',
    // The page names its tool the way it names its language in <html lang>:
    // main.tsx and the prerender read it to know which tool to load (D57).
    `  <body data-tool="${escapeAttribute(tool.id)}">`,
    '    <!--',
    '      Empty in the source. The build fills it with the first screen rendered',
    '      ahead of time (scripts/prerender.mjs), so the page reads the same before',
    '      and after the script runs, and to readers that never run it.',
    '    -->',
    '    <div id="app"></div>',
    '    <script type="module" src="/src/main.tsx"></script>',
    '  </body>',
    '</html>',
    '',
  ]

  return lines.join('\n')
}

/** The sitemap: every page, each with the alternates it shares with its twins. */
export function renderSitemap(registry: Registry): string {
  const entries = listPages(registry).map(({ tool, locale }) =>
    [
      '  <url>',
      `    <loc>${urlForPath(registry, locale.path)}</loc>`,
      ...registry.languages.map(
        (other) =>
          `    <xhtml:link rel="alternate" hreflang="${other}" href="${urlForPath(registry, tool.locales[other].path)}" />`,
      ),
      '  </url>',
    ].join('\n'),
  )

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset',
    '  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    '  xmlns:xhtml="http://www.w3.org/1999/xhtml"',
    '>',
    ...entries,
    '</urlset>',
    '',
  ].join('\n')
}
