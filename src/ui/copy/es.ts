import type { Profile, ProfileGroup } from '../../core/profiles'
import type { RowKind } from '../row-model'
import type { FilterId, SortKey } from '../queue-view'

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

export const es = {
  /** The language of this catalogue, as written in the page's lang attribute. */
  lang: 'es' as 'es' | 'en',
  /** The number locale used when the browser offers none in this language. */
  numberLocale: 'es-419',

  /** The way to the other language, as a plain link a crawler can follow. */
  otherLanguage: { label: 'English', href: '/en/', lang: 'en' },

  drop: {
    heading: 'Arrastra aquí las imágenes que quieres comprimir',
    pick: 'o elige archivos',
    promise: 'Nada sale de tu dispositivo',
  },

  toolbar: {
    destination: 'Destino',
    saveToFolder: 'Guardar en una carpeta',
    download: (done: number, count: string) =>
      done === 1 ? 'Descargar 1 imagen' : `Descargar ${count} en un ZIP`,
    cancel: 'Cancelar',
    compress: (pending: number, count: string) =>
      `Comprimir ${count} ${plural(pending, 'imagen', 'imágenes')}`,
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

  filters: {
    todos: 'Todos',
    fits: 'Entraron con margen',
    tight: 'Justos',
    over: 'No entraron',
    failed: 'Fallaron',
    cancelled: 'Cancelados',
    pending: 'En cola',
  } satisfies Record<FilterId, string>,

  selection: {
    selected: (count: string) => `${count} seleccionados`,
    recompress: 'Recomprimir',
    download: (count: string) => `Descargar ${count}`,
    remove: 'Quitar',
  },

  table: {
    label: 'Cola de compresión',
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
    running: 'Comprimiendo',
    cancelled: 'Cancelado',
    shrunk: (size: string) => `Se redujo a ${size} para entrar`,
    converted: (size: string, format: string) => `${size} · pasó a ${format} para entrar`,
    convertedAndShrunk: (size: string, format: string) =>
      `Pasó a ${format} y se redujo a ${size} para entrar`,
  },

  details: {
    target: 'Destino pide',
    ceiling: (bytes: string) => `máx. ${bytes}`,
    anySize: 'cualquier tamaño',
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
  },

  totals: {
    compressed: (done: number, count: string) =>
      `${count} ${plural(done, 'imagen comprimida', 'imágenes comprimidas')}`,
    queued: (queued: number, count: string) =>
      `${count} ${plural(queued, 'imagen en la cola', 'imágenes en la cola')}`,
    less: (percent: string) => `${percent} menos`,
    clear: 'Vaciar la cola',
    segments: {
      fits: 'con margen',
      tight: 'justos',
      over: 'no entraron',
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
    compressed: (name: string) => `${name}, comprimida`,
    curtain: 'Cortina de comparación',
    curtainValue: (percent: number) => `${percent} % del ancho`,
    hint: 'Arrastra la cortina para cruzar el antes y el después, o muévela con las flechas. Los artefactos de compresión solo se ven a 1:1.',
  },

  errors: {
    emptyFile: 'Archivo vacío, no hay nada que comprimir',
    unknownFormat: 'No es una imagen que se pueda reconocer',
    heic: 'Las fotos HEIC del iPhone no entran en esta versión. Expórtalas como JPEG desde el teléfono',
    unsupported: (format: string) =>
      `${format} no está soportado. Convierte el archivo a JPEG, PNG, WebP o AVIF`,
    decodeFailed: (format: string) => `${format} dañado, no se pudo leer la imagen`,
    encodeFailed: (format: string) => `No se pudo generar el ${format} de salida`,
    workerCrashed:
      'El navegador cortó el proceso, probablemente por falta de memoria. Prueba con menos archivos a la vez',
  },
}

export type Copy = typeof es
