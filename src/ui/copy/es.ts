import type { Profile, ProfileGroup } from '../../core/profiles'
import type { RowKind } from '../row-model'
import type { FilterId, SortKey } from '../queue-view'
import type { ToolId } from '../../tools/registry'
import type { OutputFormat } from '../../core/codecs/encode'

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
      resultAlt: (name) => `${name}, limpiada`,
    },
  } satisfies Record<ToolId, ToolWords>,

  nav: {
    label: 'Herramientas',
    tools: {
      comprimir: 'Comprimir',
      redimensionar: 'Redimensionar',
      convertir: 'Convertir',
      'quitar-exif': 'Quitar EXIF',
    } satisfies Record<ToolId, string>,
  },

  drop: {
    pick: 'o elige archivos',
    promise: 'Nada sale de tu dispositivo',
  },

  toolbar: {
    destination: 'Destino',
    saveToFolder: 'Guardar en una carpeta',
    download: (done: number, count: string) =>
      done === 1 ? 'Descargar 1 imagen' : `Descargar ${count} en un ZIP`,
    cancel: 'Cancelar',
    stripLabel: 'Sin recodificar',
    stripTitle:
      'Quita los metadatos del archivo sin tocar los píxeles. Conserva el perfil de color y la orientación.',
  },

  destination: {
    ourAdvice: 'Recomendación nuestra',
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
    bar: (from: string, weight: string, budget: string | null) =>
      budget === null
        ? `${from} quedó en ${weight}, sin presupuesto`
        : `${from} quedó en ${weight}, con un presupuesto de ${budget}`,
  },

  note: {
    pending: 'En cola',
    cancelled: 'Cancelado',
    shrunk: (size: string) => `Se redujo a ${size} para entrar`,
    converted: (size: string, format: string) => `${size} · pasó a ${format} para entrar`,
    convertedAndShrunk: (size: string, format: string) =>
      `Pasó a ${format} y se redujo a ${size} para entrar`,
    /** Nothing was removed; it may still carry the orientation it already had. */
    stripUnchanged: (keptOrientation: boolean): string =>
      keptOrientation
        ? 'Solo tenía la orientación, que se conserva: quedó igual'
        : 'No tenía metadatos: quedó igual',
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
  },
}

export type Copy = typeof es
