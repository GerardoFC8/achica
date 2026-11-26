/**
 * The registry of tools: one place that says which pages the site has and
 * what each one tells crawlers and link previews (D57).
 *
 * Plain data on purpose, with no runtime imports and no DOM. vite.config.ts,
 * the scripts in scripts/ (through Node's own type stripping) and src/ all read
 * this file, so anything that needs a loader or a browser does not belong here.
 *
 * A page lives at `/<slug>/` in Spanish and `/en/<slug-en>/` in English, always
 * with the trailing slash; the compressor is the root, `/` and `/en/`.
 */

/** The languages a page can be written in. Each one is a separate static page (D54). */
export const LANGUAGES = ['es', 'en'] as const

export type Language = (typeof LANGUAGES)[number]

/** What one tool says in one language: its route, its head and its structured data. */
export interface ToolLocale {
  /** Route with leading and trailing slash, e.g. `/` or `/en/`. */
  path: string
  title: string
  description: string
  ogTitle: string
  ogDescription: string
  /** Absolute path to the preview image under public/, e.g. `/og.png`. */
  ogImage: string
  ogImageAlt: string
  /** Open Graph locale, e.g. `es_ES`. */
  ogLocale: string
  /** The language-specific fields of the WebApplication JSON-LD. */
  jsonLd: {
    name: string
    description: string
    operatingSystem: string
    browserRequirements: string
    featureList: readonly string[]
  }
}

export interface Tool {
  /** Stable identifier. The page declares it in `<body data-tool>`; loaders.ts keys on it. */
  id: string
  /** schema.org `applicationCategory`, shared by every language. */
  applicationCategory: string
  locales: Record<Language, ToolLocale>
}

/** What every page shares. */
export const SITE = {
  /** Origin without trailing slash; crawlers resolve nothing, so every URL is absolute. */
  origin: 'https://achica.gfcode.dev',
  name: 'achica',
  themeColor: '#f2f1ec',
  ogImageWidth: 1200,
  ogImageHeight: 630,
  /** The language `x-default` points to. */
  defaultLanguage: 'es' as Language,
} as const

export const TOOLS: readonly Tool[] = [
  {
    id: 'comprimir',
    applicationCategory: 'MultimediaApplication',
    locales: {
      es: {
        path: '/',
        title: 'Comprimir imágenes por lote, sin subirlas | achica',
        description:
          'Comprime muchas imágenes a la vez en tu navegador, sin subirlas a ningún servidor. Sin cuentas, sin límite de archivos, gratis y de código abierto.',
        ogTitle: 'achica: comprime muchas imágenes a la vez, sin subirlas',
        ogDescription:
          'En tu navegador, sin cuentas y sin límite de archivos. Ningún byte de tus imágenes sale de tu dispositivo.',
        ogImage: '/og.png',
        ogImageAlt: 'achica, compresor de imágenes por lote: tres barras de peso sobre papel claro',
        ogLocale: 'es_ES',
        jsonLd: {
          name: 'achica',
          description:
            'Compresor de imágenes por lote que corre entero en el navegador. Sin backend, sin cuentas y sin límite de archivos.',
          operatingSystem: 'Cualquiera con un navegador actual',
          browserRequirements: 'Requiere JavaScript y WebAssembly',
          featureList: [
            'Compresión por lote sin límite de archivos',
            'JPEG, PNG, WebP y AVIF',
            'Perfiles por destino: web, correo, mensajería y miniatura',
            'Un tope de peso por archivo: 100 KB, 200 KB o el número que quieras',
            'Descarga en ZIP o directo a una carpeta',
            'Ninguna imagen sale del dispositivo',
          ],
        },
      },
      en: {
        path: '/en/',
        title: 'Compress images in bulk, without uploading them | achica',
        description:
          'Compress many images at once in your browser, without uploading them anywhere. No account, no file limit, free and open source.',
        ogTitle: 'achica: compress many images at once, without uploading them',
        ogDescription:
          'In your browser, with no account and no file limit. Not a byte of your images leaves your device.',
        ogImage: '/og-en.png',
        ogImageAlt: 'achica, a batch image compressor: three weight bars on light paper',
        ogLocale: 'en_US',
        jsonLd: {
          name: 'achica',
          description:
            'Batch image compressor that runs entirely in the browser. No backend, no account and no file limit.',
          operatingSystem: 'Any with a current browser',
          browserRequirements: 'Requires JavaScript and WebAssembly',
          featureList: [
            'Batch compression with no file limit',
            'JPEG, PNG, WebP and AVIF',
            'Destinations instead of quality numbers: web, email, messaging and thumbnail',
            'A size limit per file: 100 KB, 200 KB or any number',
            'Download as a ZIP or straight into a folder',
            'No image ever leaves the device',
          ],
        },
      },
    },
  },
]

/** The registry as one value, for the consumers that take it whole. */
export const REGISTRY = { languages: LANGUAGES, site: SITE, tools: TOOLS }
