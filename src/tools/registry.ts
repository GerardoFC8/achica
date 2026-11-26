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

/**
 * The tools the site has, in the order the navigation lists them. The one
 * place a tool's id is born: `ToolId` derives from it, and the registry, the
 * loaders and the copy are typed against it, so a tool added here and
 * forgotten there fails to compile.
 */
export const TOOL_IDS = ['comprimir', 'redimensionar', 'convertir', 'quitar-exif'] as const

export type ToolId = (typeof TOOL_IDS)[number]

/** Generic so a test can inject a tool that is not one of the real ids. */
export interface Tool<Id extends string = string> {
  /** Stable identifier. The page declares it in `<body data-tool>`; loaders.ts keys on it. */
  id: Id
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

export const TOOLS: readonly Tool<ToolId>[] = [
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
  {
    id: 'redimensionar',
    applicationCategory: 'MultimediaApplication',
    locales: {
      es: {
        path: '/redimensionar-imagenes/',
        title: 'Redimensionar imágenes por lote, sin subirlas | achica',
        description:
          'Reduce el tamaño de muchas imágenes a la vez en tu navegador, por porcentaje o por una caja máxima. Sin recortar, sin ampliar y sin subirlas a ningún servidor. Sin cuentas, gratis y de código abierto.',
        ogTitle: 'achica: redimensiona muchas imágenes a la vez, sin subirlas',
        ogDescription:
          'Por porcentaje o por caja máxima, en tu navegador y sin cuentas. Ningún byte de tus imágenes sale de tu dispositivo.',
        ogImage: '/og.png',
        ogImageAlt:
          'achica, herramientas de imagen por lote: tres barras de peso sobre papel claro',
        ogLocale: 'es_ES',
        jsonLd: {
          name: 'achica: redimensionar imágenes',
          description:
            'Redimensionador de imágenes por lote que corre entero en el navegador. Sin backend, sin cuentas y sin límite de archivos.',
          operatingSystem: 'Cualquiera con un navegador actual',
          browserRequirements: 'Requiere JavaScript y WebAssembly',
          featureList: [
            'Redimensionado por lote sin límite de archivos',
            'Por porcentaje o por una caja máxima de ancho y alto',
            'Sin recortar y sin ampliar: solo reduce',
            'JPEG, PNG, WebP y AVIF',
            'Descarga en ZIP o directo a una carpeta',
            'Ninguna imagen sale del dispositivo',
          ],
        },
      },
      en: {
        path: '/en/resize-images/',
        title: 'Resize images in bulk, without uploading them | achica',
        description:
          'Make many images smaller at once in your browser, by percentage or inside a maximum box. No cropping, no upscaling and no uploading anywhere. No account, free and open source.',
        ogTitle: 'achica: resize many images at once, without uploading them',
        ogDescription:
          'By percentage or inside a maximum box, in your browser with no account. Not a byte of your images leaves your device.',
        ogImage: '/og-en.png',
        ogImageAlt: 'achica, batch image tools: three weight bars on light paper',
        ogLocale: 'en_US',
        jsonLd: {
          name: 'achica: resize images',
          description:
            'Batch image resizer that runs entirely in the browser. No backend, no account and no file limit.',
          operatingSystem: 'Any with a current browser',
          browserRequirements: 'Requires JavaScript and WebAssembly',
          featureList: [
            'Batch resizing with no file limit',
            'By percentage or inside a maximum width and height',
            'No cropping and no upscaling: it only makes images smaller',
            'JPEG, PNG, WebP and AVIF',
            'Download as a ZIP or straight into a folder',
            'No image ever leaves the device',
          ],
        },
      },
    },
  },
  {
    id: 'convertir',
    applicationCategory: 'MultimediaApplication',
    locales: {
      es: {
        path: '/convertir-imagenes/',
        title: 'Convertir imágenes por lote entre JPEG, PNG, WebP y AVIF | achica',
        description:
          'Cambia el formato de muchas imágenes a la vez entre JPEG, PNG, WebP y AVIF, en tu navegador y sin subirlas a ningún servidor. Sin cuentas, gratis y de código abierto.',
        ogTitle: 'achica: convierte muchas imágenes a la vez, sin subirlas',
        ogDescription:
          'JPEG, PNG, WebP y AVIF, en tu navegador y sin cuentas. Ningún byte de tus imágenes sale de tu dispositivo.',
        ogImage: '/og.png',
        ogImageAlt:
          'achica, herramientas de imagen por lote: tres barras de peso sobre papel claro',
        ogLocale: 'es_ES',
        jsonLd: {
          name: 'achica: convertir imágenes',
          description:
            'Conversor de formato de imágenes por lote que corre entero en el navegador. Sin backend, sin cuentas y sin límite de archivos.',
          operatingSystem: 'Cualquiera con un navegador actual',
          browserRequirements: 'Requiere JavaScript y WebAssembly',
          featureList: [
            'Conversión por lote sin límite de archivos',
            'Entre JPEG, PNG, WebP y AVIF',
            'Descarga en ZIP o directo a una carpeta',
            'Ninguna imagen sale del dispositivo',
          ],
        },
      },
      en: {
        path: '/en/convert-images/',
        title: 'Convert images in bulk between JPEG, PNG, WebP and AVIF | achica',
        description:
          'Change the format of many images at once between JPEG, PNG, WebP and AVIF, in your browser and without uploading them anywhere. No account, free and open source.',
        ogTitle: 'achica: convert many images at once, without uploading them',
        ogDescription:
          'JPEG, PNG, WebP and AVIF, in your browser with no account. Not a byte of your images leaves your device.',
        ogImage: '/og-en.png',
        ogImageAlt: 'achica, batch image tools: three weight bars on light paper',
        ogLocale: 'en_US',
        jsonLd: {
          name: 'achica: convert images',
          description:
            'Batch image format converter that runs entirely in the browser. No backend, no account and no file limit.',
          operatingSystem: 'Any with a current browser',
          browserRequirements: 'Requires JavaScript and WebAssembly',
          featureList: [
            'Batch conversion with no file limit',
            'Between JPEG, PNG, WebP and AVIF',
            'Download as a ZIP or straight into a folder',
            'No image ever leaves the device',
          ],
        },
      },
    },
  },
  {
    id: 'quitar-exif',
    applicationCategory: 'MultimediaApplication',
    locales: {
      es: {
        path: '/quitar-exif/',
        title: 'Quitar EXIF y metadatos de imágenes por lote, sin subirlas | achica',
        description:
          'Quita el EXIF, la ubicación GPS, el XMP, el IPTC, los comentarios y los datos añadidos tras la imagen de muchos JPEG, PNG y WebP a la vez, en tu navegador. Sin recodificar: los píxeles no cambian. Conserva el perfil de color y la orientación. Sin cuentas, gratis y de código abierto.',
        ogTitle: 'achica: quita el EXIF de muchas imágenes a la vez, sin subirlas',
        ogDescription:
          'JPEG, PNG y WebP, en tu navegador y sin recodificar. Ningún byte de tus imágenes sale de tu dispositivo.',
        ogImage: '/og.png',
        ogImageAlt:
          'achica, herramientas de imagen por lote: tres barras de peso sobre papel claro',
        ogLocale: 'es_ES',
        jsonLd: {
          name: 'achica: quitar EXIF',
          description:
            'Limpiador de metadatos de imágenes por lote que corre entero en el navegador. Sin backend y sin cuentas.',
          operatingSystem: 'Cualquiera con un navegador actual',
          browserRequirements: 'Requiere JavaScript',
          featureList: [
            'Quita EXIF, ubicación GPS, XMP, IPTC, comentarios y datos añadidos tras la imagen',
            'Sin recodificar: los píxeles no cambian',
            'JPEG, PNG y WebP; AVIF todavía no',
            'Conserva el perfil de color y la orientación',
            'Descarga en ZIP o directo a una carpeta',
            'Ninguna imagen sale del dispositivo',
          ],
        },
      },
      en: {
        path: '/en/remove-exif/',
        title: 'Remove EXIF and metadata from images in bulk, without uploading them | achica',
        description:
          'Remove EXIF, GPS location, XMP, IPTC, comments and data appended after the image from many JPEG, PNG and WebP files at once, in your browser. No re-encoding: the pixels do not change. Keeps the colour profile and the orientation. No account, free and open source.',
        ogTitle: 'achica: remove EXIF from many images at once, without uploading them',
        ogDescription:
          'JPEG, PNG and WebP, in your browser and without re-encoding. Not a byte of your images leaves your device.',
        ogImage: '/og-en.png',
        ogImageAlt: 'achica, batch image tools: three weight bars on light paper',
        ogLocale: 'en_US',
        jsonLd: {
          name: 'achica: remove EXIF',
          description:
            'Batch image metadata remover that runs entirely in the browser. No backend and no account.',
          operatingSystem: 'Any with a current browser',
          browserRequirements: 'Requires JavaScript',
          featureList: [
            'Removes EXIF, GPS location, XMP, IPTC, comments and data appended after the image',
            'No re-encoding: the pixels do not change',
            'JPEG, PNG and WebP; AVIF not yet',
            'Keeps the colour profile and the orientation',
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

/** Narrows a string a page declared to a tool the site actually has. */
export function isToolId(value: string): value is ToolId {
  return (TOOL_IDS as readonly string[]).includes(value)
}
