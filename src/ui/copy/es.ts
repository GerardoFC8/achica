import type { Profile, ProfileGroup } from '../../core/profiles'
import type { RowKind } from '../row-model'
import type { FilterId, SortKey } from '../queue-view'
import type { ToolId } from '../../tools/registry'
import type { OutputFormat } from '../../core/codecs/encode'
import type { SkipReason } from '../../core/har'

/**
 * Every sentence the interface says, in Spanish, the base language (D54).
 *
 * The shape of this object is the contract: `Copy` is its type, and the
 * English catalogue has to satisfy it, so a sentence added here and forgotten
 * there fails to compile instead of showing up in Spanish on the English page.
 *
 * Numbers arrive already formatted. Choosing between "imagen" and "imágenes"
 * still needs the count itself, so plural sentences take both.
 */

const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many)

/**
 * The Discord destinations' names inside their own panel, by id. The group
 * header already says "Discord", so the option keeps only what tells them
 * apart; the toolbar button keeps the full label from the catalogue.
 */
const SHORT_LABELS: Readonly<Record<string, string>> = {
  'discord-sticker-gif': 'Sticker GIF',
  'discord-sticker-apng': 'Sticker APNG',
  'discord-emoji-gif': 'Emoji GIF',
}

/**
 * The words that change from tool to tool: the same queue, table and workers
 * serve every tool, so only the verb moves. Typed by `ToolId`, which is what
 * makes a tool without its words (or a word missing in English) not compile.
 */
export interface ToolWords {
  /** The drop zone's h1. */
  readonly heading: string
  /** The toolbar's action button. */
  readonly start: (pending: number, count: string) => string
  /** What a row says while its file is being worked on. */
  readonly running: string
  /** A short line under the heading, for a tool that takes a narrower set of inputs. */
  readonly hint?: string
  /** A plain fact the user needs before dropping, said under the hint. */
  readonly dropNote?: string
  /** The toolbar's download button once something is done: one file, or a ZIP. */
  readonly download: (done: number, count: string) => string
  /** The totals line once something has finished. */
  readonly finished: (done: number, count: string) => string
  /** The selection action that runs the same files again. */
  readonly again: string
  readonly emptyFile: string
  /** The table's accessible name. */
  readonly tableLabel: string
  /** The weight column's header: only compressing has a budget to measure against. */
  readonly weightHeader: string
  /** The alt text of the result picture in the comparator. */
  readonly resultAlt: (name: string) => string
}

/**
 * What a strip-only run removed, as the classes a sentence names. The row
 * model derives them from the core's report (never from what was expected to
 * be there) and the catalogue turns them into words, so each language owns its
 * word order and its list joining.
 */
export type StripPart =
  | 'exif-unreadable'
  | 'gps'
  | 'camera'
  | 'exif'
  | 'xmp'
  | 'iptc'
  | 'comment'
  | 'thumbnail'
  | 'mpf'
  | 'png-text'
  | 'png-time'
  | 'other'

export type StripFacts = {
  readonly parts: readonly StripPart[]
  /** The formatted size of what followed the end of the image, or null. */
  readonly trailing: string | null
  /** The orientation was written back into the cleaned file. */
  readonly keptOrientation: boolean
}

/** Spanish joins with "e" before a word that starts with the sound i. */
const joinEs = (items: readonly string[]): string => {
  if (items.length < 2) return items.join('')
  const last = items[items.length - 1] ?? ''
  const and = /^(hi(?!e)|i)/i.test(last) ? 'e' : 'y'
  return `${items.slice(0, -1).join(', ')} ${and} ${last}`
}

const STRIP_PARTS_ES: Readonly<Record<StripPart, string>> = {
  'exif-unreadable': 'un EXIF ilegible',
  gps: 'ubicación GPS',
  camera: 'datos de la cámara',
  exif: 'datos EXIF',
  xmp: 'XMP',
  iptc: 'IPTC',
  comment: 'comentarios',
  thumbnail: 'una miniatura incrustada',
  mpf: 'imágenes adicionales (MPF)',
  'png-text': 'texto del PNG',
  'png-time': 'la fecha de modificación',
  other: 'otros bloques de datos',
}

const stripList = (facts: StripFacts): string =>
  joinEs([
    ...facts.parts.map((part) => STRIP_PARTS_ES[part]),
    ...(facts.trailing === null ? [] : [`${facts.trailing} tras el fin de imagen`]),
  ])

export const es = {
  /** The language of this catalogue, as written in the page's lang attribute. */
  lang: 'es' as 'es' | 'en',
  /** The number locale used when the browser offers none in this language. */
  numberLocale: 'es-419',

  /** The way to the other language, as a plain link a crawler can follow. */
  /** The link to the other language. Its href comes from the registry (tools/links.ts). */
  otherLanguage: { label: 'English', lang: 'en' as 'es' | 'en' },

  tools: {
    comprimir: {
      heading: 'Arrastra aquí las imágenes que quieres comprimir',
      start: (pending, count) => `Comprimir ${count} ${plural(pending, 'imagen', 'imágenes')}`,
      finished: (done, count) =>
        `${count} ${plural(done, 'imagen comprimida', 'imágenes comprimidas')}`,
      running: 'Comprimiendo',
      again: 'Recomprimir',
      emptyFile: 'Archivo vacío, no hay nada que comprimir',
      tableLabel: 'Cola de compresión',
      weightHeader: 'Peso contra presupuesto',
      download: (done, count) =>
        done === 1 ? 'Descargar 1 imagen' : `Descargar ${count} en un ZIP`,
      resultAlt: (name) => `${name}, comprimida`,
    },
    redimensionar: {
      heading: 'Arrastra aquí las imágenes que quieres redimensionar',
      start: (pending, count) => `Redimensionar ${count} ${plural(pending, 'imagen', 'imágenes')}`,
      running: 'Redimensionando',
      finished: (done, count) =>
        `${count} ${plural(done, 'imagen redimensionada', 'imágenes redimensionadas')}`,
      again: 'Redimensionar de nuevo',
      emptyFile: 'Archivo vacío, no hay nada que redimensionar',
      tableLabel: 'Cola de redimensionado',
      weightHeader: 'Peso antes y después',
      download: (done, count) =>
        done === 1 ? 'Descargar 1 imagen' : `Descargar ${count} en un ZIP`,
      resultAlt: (name) => `${name}, redimensionada`,
    },
    convertir: {
      heading: 'Arrastra aquí las imágenes que quieres convertir',
      start: (pending, count) => `Convertir ${count} ${plural(pending, 'imagen', 'imágenes')}`,
      running: 'Convirtiendo',
      finished: (done, count) =>
        `${count} ${plural(done, 'imagen convertida', 'imágenes convertidas')}`,
      again: 'Convertir de nuevo',
      emptyFile: 'Archivo vacío, no hay nada que convertir',
      tableLabel: 'Cola de conversión',
      weightHeader: 'Peso antes y después',
      download: (done, count) =>
        done === 1 ? 'Descargar 1 imagen' : `Descargar ${count} en un ZIP`,
      resultAlt: (name) => `${name}, convertida`,
    },
    'quitar-exif': {
      heading: 'Arrastra aquí las imágenes de las que quieres quitar los metadatos',
      start: (pending, count) => `Limpiar ${count} ${plural(pending, 'imagen', 'imágenes')}`,
      running: 'Limpiando',
      finished: (done, count) =>
        `${count} ${plural(done, 'imagen limpiada', 'imágenes limpiadas')}`,
      again: 'Limpiar de nuevo',
      emptyFile: 'Archivo vacío, no hay nada que limpiar',
      tableLabel: 'Cola de limpieza',
      weightHeader: 'Peso antes y después',
      download: (done, count) =>
        done === 1 ? 'Descargar 1 imagen' : `Descargar ${count} en un ZIP`,
      resultAlt: (name) => `${name}, limpiada`,
    },
    discord: {
      heading:
        'Arrastra aquí la animación o el video que quieres convertir en sticker o emoji de Discord',
      hint: 'GIF, APNG, WebP animado o video (MP4, WebM)',
      dropNote:
        'Un video se reproduce en esta pestaña mientras se prepara, así que hay que mantenerla visible.',
      start: (pending, count) => `Preparar ${count} ${plural(pending, 'animación', 'animaciones')}`,
      running: 'Preparando',
      finished: (done, count) =>
        `${count} ${plural(done, 'animación lista', 'animaciones listas')}`,
      again: 'Preparar de nuevo',
      emptyFile: 'Archivo vacío, no hay ninguna animación que preparar',
      tableLabel: 'Cola de animaciones',
      weightHeader: 'Peso contra el límite de Discord',
      download: (done, count) =>
        done === 1 ? 'Descargar 1 animación' : `Descargar ${count} en un ZIP`,
      resultAlt: (name) => `${name}, ajustada para Discord`,
    },
    auditar: {
      heading: 'Arrastra aquí el archivo HAR de la página que quieres medir',
      start: (pending, count) =>
        `Medir el ahorro de ${count} ${plural(pending, 'imagen', 'imágenes')}`,
      running: 'Midiendo',
      finished: (done, count) => `${count} ${plural(done, 'imagen medida', 'imágenes medidas')}`,
      again: 'Medir de nuevo',
      emptyFile: 'Archivo vacío, no hay nada que medir',
      tableLabel: 'Imágenes del HAR',
      weightHeader: 'Peso antes y después',
      download: (done, count) =>
        done === 1 ? 'Descargar 1 imagen' : `Descargar ${count} en un ZIP`,
      resultAlt: (name) => `${name}, recomprimida`,
    },
  } satisfies Record<ToolId, ToolWords>,

  nav: {
    label: 'Herramientas',
    tools: {
      comprimir: 'Comprimir',
      redimensionar: 'Redimensionar',
      convertir: 'Convertir',
      'quitar-exif': 'Quitar EXIF',
      discord: 'Discord',
      auditar: 'Auditar web',
    } satisfies Record<ToolId, string>,
  },

  drop: {
    pick: 'o elige archivos',
    promise: 'Nada sale de tu dispositivo',
  },

  audit: {
    pick: 'o elige un archivo',
    howTo:
      'Exporta el HAR desde la pestaña Red de las herramientas de desarrollo de tu navegador, con el contenido de las respuestas incluido.',
    privacy:
      'El archivo se lee en tu navegador, y las cookies y las cabeceras no se muestran ni se guardan.',
    warning: 'Un HAR puede llevar datos de tu sesión: no conviene compartirlo.',
    reading: 'Leyendo el HAR',
    errors: {
      notJson:
        'Este archivo no es JSON, así que no es un HAR. Expórtalo de nuevo desde la pestaña Red de las herramientas de desarrollo',
      notHar:
        'Es un JSON, pero no un HAR: no trae la lista de peticiones. Expórtalo desde la pestaña Red de las herramientas de desarrollo',
      tooManyEntries: (count: string, max: string) =>
        `El HAR tiene ${count} peticiones y el máximo son ${max}. Exporta uno de una sola visita a la página`,
      tooLarge: (size: string, max: string) =>
        `El archivo pesa ${size} y el máximo son ${max}. Exporta un HAR de una sola visita a la página`,
      noImages: (entries: number, count: string) =>
        entries === 0
          ? 'El HAR no trae ninguna petición de imagen. Comprueba que lo exportaste después de cargar la página'
          : `El HAR trae ${count} ${plural(entries, 'imagen', 'imágenes')}, pero ${plural(entries, 'no se puede medir', 'ninguna se puede medir')}`,
      noImagesNoContent:
        'Algunas respuestas salieron sin contenido: vuelve a exportar el HAR con el contenido de las respuestas incluido',
      severalFiles: 'Arrastra un solo archivo HAR a la vez',
      readFailed:
        'No se pudo leer el archivo. Si es muy grande, el navegador puede haberse quedado sin memoria: prueba con un HAR más pequeño',
    },
    summary: {
      line: (
        measurable: number,
        count: string,
        total: string,
        weight: string,
        destination: string,
      ) =>
        `${count} ${plural(measurable, 'imagen medible', 'imágenes medibles')} de ${total} en el HAR · pesan ${weight} · destino «${destination}»`,
      alreadyFine: (n: number, count: string) =>
        `${count} ${plural(n, 'ya estaba bien', 'ya estaban bien')}`,
      skippedTitle: (_n: number, count: string) => `No medibles: ${count}`,
      duplicates: (n: number, count: string) =>
        `${count} ${plural(n, 'petición repetida ignorada', 'peticiones repetidas ignoradas')}`,
      unknownType: 'tipo desconocido',
      reasons: {
        'no-content': 'sin contenido en el HAR: vuelve a exportarlo con el contenido incluido',
        cached: 'servida desde la caché del navegador, no hay contenido que medir',
        'unsupported-format': 'formato que achica no optimiza todavía (SVG, GIF…)',
        'unreadable-content': 'contenido ilegible',
        partial: 'descarga parcial: es solo un trozo del archivo',
        'failed-request': 'petición fallida',
      } satisfies Record<SkipReason, string>,
    },
  },

  toolbar: {
    destination: 'Destino',
    saveToFolder: 'Guardar en una carpeta',
    cancel: 'Cancelar',
    stripLabel: 'Sin recodificar',
    stripTitle:
      'Quita los metadatos del archivo sin tocar los píxeles. Conserva el perfil de color y la orientación.',
  },

  destination: {
    ourAdvice: 'Recomendación nuestra',
    source: 'Fuente',
    verifiedAt: (date: string) => `verificado el ${date}`,
    /** Said once, under the Discord destinations: the file fits the numbers, not the verdict. */
    notAGuarantee: 'Se ajusta al peso que Discord publica, pero no se garantiza que lo acepte.',
    canvasReduction: 'Si no entra, reducir el lienzo a 256 px',
    canvasReductionNote: 'Aceptado en nuestras pruebas; Discord pide 320 × 320',
    /** A Discord destination's name in its own panel, where the group already says "Discord". */
    shortLabel: (profile: Profile): string => SHORT_LABELS[profile.id] ?? profile.label,
    /** The sticker's square canvas, as the option's numbers show it. */
    canvasSize: (side: number) => `${side} × ${side}`,
    /** The emoji's longest side, as the option's numbers show it. */
    upToSide: (side: number) => `hasta ${side} px`,
    /** The selected Discord destination's explanation, under the list. */
    detail: (name: string, note: string) => `${name}. ${note}`,
    ceiling: (bytes: string) => `máx. ${bytes}`,
    originalSize: 'tamaño original',
    group: (group: ProfileGroup): string => group,
    /** The catalogue in core is written in Spanish, so this one reads it as is. */
    profile: (profile: Profile): { readonly label: string; readonly note?: string } => ({
      label: profile.label,
      ...(profile.note === undefined ? {} : { note: profile.note }),
    }),
    budgetTitle: 'Tope por archivo',
    noBudget: 'Sin tope',
    otherBudget: 'Otro',
    useBudget: 'Usar',
    invalidBudget: (min: string, max: string) => `Escribe un número de KB entre ${min} y ${max}.`,
    pngQuestion: 'Si un PNG no entra en el tope',
    pngToWebp: 'Pasarlo a WebP, que conserva la transparencia',
    pngKeep: 'Dejarlo en PNG y achicar sus dimensiones',
  },

  resize: {
    modeLabel: 'Cómo reducir',
    percent: 'Porcentaje',
    box: 'Tamaño máximo',
    otherPercent: 'Otro',
    percentUnit: '%',
    width: 'Ancho',
    height: 'Alto',
    pixelsUnit: 'px',
    use: 'Usar',
    boxHint: 'Escribe el ancho, el alto o los dos.',
    presetWidth: (px: number) => `${px} px de ancho`,
    summaryPercent: (percent: number) => `${percent} %`,
    summaryBox: (width: number | null, height: number | null) =>
      width !== null && height !== null
        ? `máx. ${width} × ${height} px`
        : width !== null
          ? `máx. ${width} px de ancho`
          : `máx. ${height ?? 0} px de alto`,
    invalidPercent: (min: string, max: string) => `Escribe un número entero entre ${min} y ${max}.`,
    invalidBox: (min: string, max: string) =>
      `Escribe números enteros de píxeles, entre ${min} y ${max}, en el ancho, el alto o los dos.`,
    rules:
      'Solo reduce: una imagen que ya es más pequeña que el límite se queda como está. Conserva la proporción y no recorta.',
    fixed: (quality: string) =>
      `Conserva el formato de cada archivo. La calidad es fija: ${quality} en los formatos con pérdida.`,
  },

  format: {
    title: 'Formato de salida',
    names: {
      jpeg: 'JPEG',
      png: 'PNG',
      webp: 'WebP',
      avif: 'AVIF',
    } satisfies Record<OutputFormat, string>,
    notes: {
      jpeg: 'No guarda transparencia: se compone sobre blanco.',
      png: 'Sin pérdida y con transparencia; suele pesar más.',
      webp: 'Pesa poco y conserva la transparencia.',
      avif: 'El que menos suele pesar; tarda más en codificar, sobre todo en lotes grandes.',
    } satisfies Record<OutputFormat, string>,
    lossless: 'sin pérdida',
    fixed: 'La calidad es fija y es la que recomendamos para cada formato.',
  },

  /** The Discord panel's section for cutting a video (the tool's own numbers, not Discord's). */
  video: {
    title: 'Video',
    onlyVideos: 'Los fps son un máximo: nunca más que los del video.',
    start: 'Inicio (s)',
    length: 'Duración (s)',
    fps: 'Fotogramas por segundo (máx.)',
    /** Whose the cap is: achica's, not Discord's. */
    capNote: (seconds: string, frames: string) =>
      `El tope de ${seconds} s y ${frames} fotogramas es de achica, no de Discord.`,
    problems: {
      empty: 'Escribe un número.',
      notNumber: 'Eso no es un número. Escribe, por ejemplo, 2,5.',
      negative: 'No puede ser negativo.',
    },
    /** A valid number that was cut to the tool's bounds. */
    adjusted: (value: string) => `Se ajustó a ${value}, el límite de la herramienta.`,
  },

  filters: {
    todos: 'Todos',
    fits: 'Entraron con margen',
    tight: 'Justos',
    over: 'No entraron',
    /** Finished, with nothing to judge: the verdict of the tools that do not weigh (D58). */
    done: 'Terminados',
    failed: 'Fallaron',
    cancelled: 'Cancelados',
    pending: 'En cola',
  } satisfies Record<FilterId, string>,

  selection: {
    selected: (count: string) => `${count} seleccionados`,
    download: (count: string) => `Descargar ${count}`,
    remove: 'Quitar',
  },

  table: {
    selectAll: 'Seleccionar todo lo visible',
    columns: {
      name: 'Archivo',
      before: 'Antes',
      after: 'Después',
      saved: 'Ahorro',
      time: 'Tiempo',
    } satisfies Record<Exclude<SortKey, 'orden'>, string>,
  },

  row: {
    select: (name: string) => `Seleccionar ${name}`,
    cancel: 'Cancelar',
    compare: 'Comparar',
    download: 'Descargar',
    downloadTitle: (name: string) => `Descargar ${name}`,
    /** The bar of a destination with an absolute limit: the track is the limit. */
    limitBar: (weight: string, limit: string) => `quedó en ${weight}, con un límite de ${limit}`,
    bar: (from: string, weight: string, budget: string | null) =>
      budget === null
        ? `${from} quedó en ${weight}, sin presupuesto`
        : `${from} quedó en ${weight}, con un presupuesto de ${budget}`,
  },

  note: {
    pending: 'En cola',
    cancelled: 'Cancelado',
    /** The audit's verdict for an image that did not come out lighter. */
    alreadyFine: 'Ya estaba bien: no se reduce',
    shrunk: (size: string) => `Se redujo a ${size} para entrar`,
    converted: (size: string, format: string) => `${size} · pasó a ${format} para entrar`,
    convertedAndShrunk: (size: string, format: string) =>
      `Pasó a ${format} y se redujo a ${size} para entrar`,
    /** Nothing was removed; it may still carry the orientation it already had. */
    stripUnchanged: (keptOrientation: boolean): string =>
      keptOrientation
        ? 'Solo tenía la orientación, que se conserva: quedó igual'
        : 'No tenía metadatos: quedó igual',
    /** What an animation came out as, and what it gave up to fit its budget. */
    animation: {
      fps: (fps: string) => `${fps} fps`,
      colors: (colors: number) => `${colors} colores`,
      fullColor: 'color completo',
      canvas: (size: string) => `lienzo ${size}`,
      steps: {
        fps: (to: string) => `se bajó a ${to} fps`,
        palette: (colors: number) => `paleta de ${colors} colores`,
        scale: (percent: number) => `tamaño reducido al ${percent} %`,
        canvas: (px: number) => `lienzo reducido a ${px} px`,
        diffOff: 'recorte por diferencias desactivado',
      },
      /** Which part of a video was kept: a choice the user made, not a failure. */
      clip: (from: string, to: string, total: string) => `Tramo de ${from} a ${to} s de ${total} s`,
      /** Said when the selected destination is no longer the one the row was made for. */
      otherDestination: 'procesada con otro destino',
      fits: 'Entra en el límite',
      over: (size: string, limit: string) =>
        `No entra en el límite de ${limit}: es la versión más pequeña que se pudo hacer (${size})`,
    },
    stripped: (facts: StripFacts) =>
      facts.parts.includes('exif-unreadable')
        ? `Se quitó ${stripList(facts)}; no se pudo conservar la orientación`
        : `Quitó ${stripList(facts)}${facts.keptOrientation ? '; conservó la orientación' : ''}`,
  },

  details: {
    target: 'Destino pide',
    ceiling: (bytes: string) => `máx. ${bytes}`,
    anySize: 'cualquier tamaño',
    sameSize: 'mismas dimensiones',
    scale: (percent: number) => `${percent} % del ancho y del alto`,
    maxBox: (width: number, height: number) => `máx. ${width} × ${height} px`,
    maxSize: (px: number) => `máx. ${px} px`,
    originalFormat: 'formato original',
    whatHappened: 'Qué pasó',
    code: 'Código',
    source: 'Origen',
    harUrl: 'Dirección en el HAR',
    progress: 'Avance',
    progressUnknown: 'no medible dentro de un archivo',
    output: 'Salida',
    quality: (value: string) => `calidad ${value}`,
    dimensions: 'Dimensiones',
    encodes: 'Pasadas de codificación',
    margin: 'Margen',
    excess: 'Exceso',
    saved: 'Ahorro',
    time: 'Tiempo en el worker',
    frames: 'Fotogramas',
    duration: 'Duración',
    fps: 'Fotogramas por segundo',
    colors: 'Colores',
    clip: 'Tramo del video',
    clipValue: (from: string, length: string, total: string) =>
      `desde ${from} s, ${length} s de ${total} s`,
    /** The target line of a row made for another destination: its own limit, said as such. */
    processedWithOther: (limit: string) => `máx. ${limit} (otro destino)`,
    adjusted: 'Se ajustó',
    adjustedNothing: 'nada, entró tal cual',
    preview: 'Vista previa',
    stripTarget: 'quitar metadatos, sin recodificar',
    removed: 'Se quitó',
    removedList: (facts: StripFacts) => stripList(facts),
    removedNothing: 'nada',
    removedBytes: 'Bytes quitados',
    reencoding: 'Recodificación',
    reencodingNone: 'ninguna, los píxeles no cambiaron',
    kept: 'Se conserva',
    keptValue: (orientation: boolean): string =>
      orientation ? 'píxeles, perfil de color y orientación' : 'píxeles y perfil de color',
  },

  totals: {
    queued: (queued: number, count: string) =>
      `${count} ${plural(queued, 'imagen en la cola', 'imágenes en la cola')}`,
    less: (percent: string) => `${percent} menos`,
    /** The batch ended heavier than it began, which a converted batch often does. */
    more: (percent: string) => `${percent} más`,
    clear: 'Vaciar la cola',
    segments: {
      fits: 'con margen',
      tight: 'justos',
      over: 'no entraron',
      done: 'terminados',
      failed: 'fallaron',
      cancelled: 'cancelados',
    } satisfies Partial<Record<RowKind, string>>,
  },

  save: {
    images: (files: number, count: string) => `${count} ${plural(files, 'imagen', 'imágenes')}`,
    failed: (detail: string) => `No se pudo guardar: ${detail}`,
    downloadedOne: (what: string) => `${what} descargada`,
    zipped: (what: string, bytes: string) => `ZIP con ${what} · ${bytes}`,
    toFolder: (what: string, bytes: string) => `${what} en la carpeta que elegiste · ${bytes}`,
  },

  compare: {
    dialog: (name: string) => `Comparar ${name}`,
    fit: 'Ajustada',
    close: 'Cerrar',
    before: 'antes',
    after: 'después',
    original: (name: string) => `${name}, original`,
    curtain: 'Cortina de comparación',
    curtainValue: (percent: number) => `${percent} % del ancho`,
    hint: 'Arrastra la cortina para cruzar el antes y el después, o muévela con las flechas. Los artefactos de compresión solo se ven a 1:1.',
  },

  errors: {
    unknownFormat: 'No es una imagen que se pueda reconocer',
    heic: 'Las fotos HEIC del iPhone no entran en esta versión. Expórtalas como JPEG desde el teléfono',
    unsupported: (format: string) =>
      `${format} no está soportado. Convierte el archivo a JPEG, PNG, WebP o AVIF`,
    decodeFailed: (format: string) => `${format} dañado, no se pudo leer la imagen`,
    encodeFailed: (format: string) => `No se pudo generar el ${format} de salida`,
    stripUnsupported: (format: string) =>
      `${format} guarda los metadatos de una forma que no se puede limpiar sin recodificar; usa Comprimir o Convertir, que también los quitan`,
    corrupt: (format: string) =>
      `${format} dañado: el archivo está cortado o su estructura no es válida, así que no se pudieron quitar los metadatos con seguridad. No se cambió nada`,
    workerCrashed:
      'El navegador cortó el proceso, probablemente por falta de memoria. Prueba con menos archivos a la vez',
    animation: {
      notAnimated:
        'Esta imagen no está animada. Discord ya reescala las estáticas por su cuenta: usa Comprimir o Redimensionar',
      unsupportedBrowser:
        'Este navegador no puede leer animaciones. Prueba con Chrome, Edge o Firefox',
      unsupportedFormat:
        'Solo se leen animaciones GIF, APNG y WebP animado. Para otro tipo de imagen usa Comprimir o Convertir',
      corrupt:
        'La animación está dañada o cortada, así que no se pudo leer. Prueba con otro archivo',
      tooLarge: 'La animación es demasiado grande. Prueba con una más corta o más pequeña',
      resizeFailed:
        'No se pudo cambiar el tamaño de los fotogramas. Prueba con una animación más pequeña',
      compressionUnavailable:
        'Este navegador no puede comprimir el APNG. Prueba con Chrome, Edge o Firefox, o elige GIF',
      encodeFailed: 'No se pudo generar la animación de salida',
    },
    /** A video that could not be turned into frames. */
    video: {
      codecUnsupported:
        'Este navegador no puede leer el códec de este video (por ejemplo, HEVC). Prueba con Chrome, Edge o Firefox, o conviértelo a H.264',
      stalled: 'Mantén esta pestaña visible mientras se prepara el video y vuelve a intentarlo',
      noVideoTrack: 'El archivo no tiene imagen, solo audio. Elige un video MP4 o WebM',
      unsupportedVideo:
        'Solo se leen videos MP4 y WebM. Convierte el archivo a uno de esos formatos',
      // A decode that fails after the metadata loaded is what Firefox reports for HEVC,
      // so this message cannot blame the file alone.
      corrupt:
        'No se pudo leer el video: puede estar dañado o usar un códec que este navegador no reproduce (por ejemplo, HEVC, frecuente en videos de móvil). Prueba con Chrome o Edge, con otro archivo, o conviértelo a H.264',
      aborted: 'Se canceló la lectura del video',
      internal: 'No se pudo preparar el video. Vuelve a intentarlo o prueba con otro archivo',
    },
  },
}

export type Copy = typeof es
