import type { ProfileGroup } from '../../core/profiles'
import type { Copy, StripFacts, StripPart } from './es'

/**
 * Every sentence the interface says, in English (D54).
 *
 * Typed as `Copy`, so it cannot miss a sentence the Spanish catalogue has.
 * Written for the English page, not translated word for word: the same facts
 * and the same voice, in sentences a native reader would write.
 */

const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many)

const GROUPS: Readonly<Record<ProfileGroup, string>> = {
  Web: 'Web',
  Correo: 'Email',
  Mensajería: 'Messaging',
  Miniatura: 'Thumbnail',
  Tamaño: 'Size',
  Formato: 'Format',
  Metadatos: 'Metadata',
}

/**
 * The destinations, by id. The catalogue in core is written in Spanish and
 * stays the source of truth for what each one does; this is how it reads in
 * English. A test checks that every destination has an entry here.
 */
export const PROFILE_TEXT: Readonly<
  Record<string, { readonly label: string; readonly note: string }>
> = {
  'web-articulo': {
    label: 'Image for a web article',
    note: 'WebP at 1600 px wide: sharp on large screens and far lighter than an equivalent JPEG. The only destination that changes the format, because here converting is the point.',
  },
  'correo-adjunto': {
    label: 'Email attachment',
    note: 'Keeps the format and limits the width to 2000 px. Still looks good on any screen, and several photos fit in one email.',
  },
  mensajeria: {
    label: 'Messaging app',
    note: 'Messaging apps recompress whatever you send them. Handing them something already light keeps it from being squeezed twice.',
  },
  miniatura: {
    label: 'Thumbnail',
    note: 'Fits inside a 400 px square, keeping its proportions. For listings, avatars and previews.',
  },
}

const STRIP_PARTS: Readonly<Record<StripPart, string>> = {
  'exif-unreadable': 'an unreadable EXIF block',
  gps: 'GPS location',
  camera: 'camera details',
  exif: 'EXIF data',
  xmp: 'XMP',
  iptc: 'IPTC',
  comment: 'comments',
  thumbnail: 'an embedded thumbnail',
  mpf: 'extra images (MPF)',
  'png-text': 'PNG text',
  'png-time': 'the modification time',
  other: 'other data blocks',
}

const joinEn = (items: readonly string[]): string =>
  items.length < 2
    ? items.join('')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`

const stripList = (facts: StripFacts): string =>
  joinEn([
    ...facts.parts.map((part) => STRIP_PARTS[part]),
    ...(facts.trailing === null ? [] : [`${facts.trailing} after the end of the image`]),
  ])

export const en: Copy = {
  lang: 'en',
  numberLocale: 'en-US',

  otherLanguage: { label: 'Español', lang: 'es' },

  tools: {
    comprimir: {
      heading: 'Drop the images you want to compress here',
      start: (pending, count) => `Compress ${count} ${plural(pending, 'image', 'images')}`,
      finished: (done, count) => `${count} ${plural(done, 'image', 'images')} compressed`,
      running: 'Compressing',
      again: 'Recompress',
      emptyFile: 'Empty file, there is nothing to compress',
      tableLabel: 'Compression queue',
      weightHeader: 'Weight against the limit',
      resultAlt: (name) => `${name}, compressed`,
    },
    redimensionar: {
      heading: 'Drop the images you want to resize here',
      start: (pending, count) => `Resize ${count} ${plural(pending, 'image', 'images')}`,
      running: 'Resizing',
      finished: (done, count) => `${count} ${plural(done, 'image', 'images')} resized`,
      again: 'Resize again',
      emptyFile: 'Empty file, there is nothing to resize',
      tableLabel: 'Resize queue',
      weightHeader: 'Weight before and after',
      resultAlt: (name) => `${name}, resized`,
    },
    convertir: {
      heading: 'Drop the images you want to convert here',
      start: (pending, count) => `Convert ${count} ${plural(pending, 'image', 'images')}`,
      running: 'Converting',
      finished: (done, count) => `${count} ${plural(done, 'image', 'images')} converted`,
      again: 'Convert again',
      emptyFile: 'Empty file, there is nothing to convert',
      tableLabel: 'Conversion queue',
      weightHeader: 'Weight before and after',
      resultAlt: (name) => `${name}, converted`,
    },
    'quitar-exif': {
      heading: 'Drop the images you want to remove the metadata from here',
      start: (pending, count) => `Clean ${count} ${plural(pending, 'image', 'images')}`,
      running: 'Cleaning',
      finished: (done, count) => `${count} ${plural(done, 'image', 'images')} cleaned`,
      again: 'Clean again',
      emptyFile: 'Empty file, there is nothing to clean',
      tableLabel: 'Cleaning queue',
      weightHeader: 'Weight before and after',
      resultAlt: (name) => `${name}, cleaned`,
    },
  },

  nav: {
    label: 'Tools',
    tools: {
      comprimir: 'Compress',
      redimensionar: 'Resize',
      convertir: 'Convert',
      'quitar-exif': 'Remove EXIF',
    },
  },

  drop: {
    pick: 'or choose files',
    promise: 'Nothing leaves your device',
  },

  toolbar: {
    destination: 'Destination',
    saveToFolder: 'Save to a folder',
    download: (done, count) => (done === 1 ? 'Download 1 image' : `Download ${count} as a ZIP`),
    cancel: 'Cancel',
    stripLabel: 'No re-encoding',
    stripTitle:
      'Removes the metadata from the file without touching the pixels. Keeps the colour profile and the orientation.',
  },

  destination: {
    ourAdvice: 'Our advice',
    ceiling: (bytes) => `max. ${bytes}`,
    originalSize: 'original size',
    group: (group) => GROUPS[group],
    profile: (profile) => PROFILE_TEXT[profile.id] ?? { label: profile.label },
    budgetTitle: 'Limit per file',
    noBudget: 'No limit',
    otherBudget: 'Other',
    useBudget: 'Use',
    invalidBudget: (min, max) => `Type a number of KB between ${min} and ${max}.`,
    pngQuestion: 'If a PNG does not fit under the limit',
    pngToWebp: 'Turn it into WebP, which keeps the transparency',
    pngKeep: 'Keep it as PNG and shrink its dimensions',
  },

  resize: {
    modeLabel: 'How to reduce',
    percent: 'Percentage',
    box: 'Maximum size',
    otherPercent: 'Other',
    percentUnit: '%',
    width: 'Width',
    height: 'Height',
    pixelsUnit: 'px',
    use: 'Use',
    boxHint: 'Type the width, the height or both.',
    presetWidth: (px) => `${px} px wide`,
    summaryPercent: (percent) => `${percent}%`,
    summaryBox: (width, height) =>
      width !== null && height !== null
        ? `max. ${width} × ${height} px`
        : width !== null
          ? `max. ${width} px wide`
          : `max. ${height ?? 0} px tall`,
    invalidPercent: (min, max) => `Type a whole number between ${min} and ${max}.`,
    invalidBox: (min, max) =>
      `Type whole numbers of pixels, between ${min} and ${max}, for the width, the height or both.`,
    rules:
      'It only makes images smaller: one that is already under the limit stays as it is. Proportions are kept and nothing is cropped.',
    fixed: (quality) =>
      `Each file keeps its format. Quality is fixed: ${quality} for the lossy formats.`,
  },

  format: {
    title: 'Output format',
    names: {
      jpeg: 'JPEG',
      png: 'PNG',
      webp: 'WebP',
      avif: 'AVIF',
    },
    notes: {
      jpeg: 'Has no transparency: it is placed over white.',
      png: 'Lossless and keeps transparency; usually heavier.',
      webp: 'Light, and keeps transparency.',
      avif: 'Usually the lightest; slower to encode, especially in large batches.',
    },
    lossless: 'lossless',
    fixed: 'Quality is fixed, the one we recommend for each format.',
  },

  filters: {
    todos: 'All',
    fits: 'Fit with room',
    tight: 'Just fit',
    over: 'Did not fit',
    done: 'Done',
    failed: 'Failed',
    cancelled: 'Cancelled',
    pending: 'Queued',
  },

  selection: {
    selected: (count) => `${count} selected`,
    download: (count) => `Download ${count}`,
    remove: 'Remove',
  },

  table: {
    selectAll: 'Select everything visible',
    columns: {
      name: 'File',
      before: 'Before',
      after: 'After',
      saved: 'Saved',
      time: 'Time',
    },
  },

  row: {
    select: (name) => `Select ${name}`,
    cancel: 'Cancel',
    compare: 'Compare',
    download: 'Download',
    downloadTitle: (name) => `Download ${name}`,
    bar: (from, weight, budget) =>
      budget === null
        ? `${from} came down to ${weight}, with no limit`
        : `${from} came down to ${weight}, against a limit of ${budget}`,
  },

  note: {
    pending: 'Queued',
    cancelled: 'Cancelled',
    shrunk: (size) => `Shrunk to ${size} to fit`,
    converted: (size, format) => `${size} · turned into ${format} to fit`,
    convertedAndShrunk: (size, format) => `Turned into ${format} and shrunk to ${size} to fit`,
    stripUnchanged: (keptOrientation) =>
      keptOrientation
        ? 'It only had the orientation, which is kept: left as it was'
        : 'It had no metadata: left as it was',
    stripped: (facts) =>
      facts.parts.includes('exif-unreadable')
        ? `Removed ${stripList(facts)}; the orientation could not be kept`
        : `Removed ${stripList(facts)}${facts.keptOrientation ? '; kept the orientation' : ''}`,
  },

  details: {
    target: 'Destination asks for',
    ceiling: (bytes) => `max. ${bytes}`,
    anySize: 'any size',
    sameSize: 'same dimensions',
    scale: (percent) => `${percent}% of the width and height`,
    maxBox: (width, height) => `max. ${width} × ${height} px`,
    maxSize: (px) => `max. ${px} px`,
    originalFormat: 'original format',
    whatHappened: 'What happened',
    code: 'Code',
    source: 'Source',
    progress: 'Progress',
    progressUnknown: 'not measurable within a file',
    output: 'Output',
    quality: (value) => `quality ${value}`,
    dimensions: 'Dimensions',
    encodes: 'Encoding passes',
    margin: 'Room left',
    excess: 'Over by',
    saved: 'Saved',
    time: 'Time in the worker',
    stripTarget: 'remove metadata, no re-encoding',
    removed: 'Removed',
    removedList: (facts) => stripList(facts),
    removedNothing: 'nothing',
    removedBytes: 'Bytes removed',
    reencoding: 'Re-encoding',
    reencodingNone: 'none, the pixels did not change',
    kept: 'Kept',
    keptValue: (orientation) =>
      orientation ? 'pixels, colour profile and orientation' : 'pixels and colour profile',
  },

  totals: {
    queued: (queued, count) => `${count} ${plural(queued, 'image', 'images')} in the queue`,
    less: (percent) => `${percent} smaller`,
    more: (percent) => `${percent} larger`,
    clear: 'Clear the queue',
    segments: {
      fits: 'with room',
      tight: 'just fit',
      over: 'did not fit',
      done: 'done',
      failed: 'failed',
      cancelled: 'cancelled',
    },
  },

  save: {
    images: (files, count) => `${count} ${plural(files, 'image', 'images')}`,
    failed: (detail) => `Could not save: ${detail}`,
    downloadedOne: (what) => `${what} downloaded`,
    zipped: (what, bytes) => `ZIP with ${what} · ${bytes}`,
    toFolder: (what, bytes) => `${what} in the folder you chose · ${bytes}`,
  },

  compare: {
    dialog: (name) => `Compare ${name}`,
    fit: 'Fit',
    close: 'Close',
    before: 'before',
    after: 'after',
    original: (name) => `${name}, original`,
    curtain: 'Comparison curtain',
    curtainValue: (percent) => `${percent}% of the width`,
    hint: 'Drag the curtain across to see before and after, or move it with the arrow keys. Compression artefacts only show at 1:1.',
  },

  errors: {
    unknownFormat: 'Not an image that can be recognised',
    heic: 'iPhone HEIC photos are not supported in this version. Export them as JPEG from the phone',
    unsupported: (format) =>
      `${format} is not supported. Convert the file to JPEG, PNG, WebP or AVIF`,
    decodeFailed: (format) => `Damaged ${format}, the image could not be read`,
    encodeFailed: (format) => `Could not produce the output ${format}`,
    stripUnsupported: (format) =>
      `${format} stores its metadata in a way that cannot be cleaned without re-encoding the image. Use Compress or Convert instead, which also remove it`,
    corrupt: (format) =>
      `Damaged ${format}: the file is cut off or its structure is invalid, so its metadata could not be removed safely. Nothing was changed`,
    workerCrashed:
      'The browser stopped the process, probably for lack of memory. Try fewer files at a time',
  },
}
