import type { ProfileGroup } from '../../core/profiles'
import type { Copy } from './es'

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

export const en: Copy = {
  lang: 'en',
  numberLocale: 'en-US',

  otherLanguage: { label: 'Español', href: '/', lang: 'es' },

  drop: {
    heading: 'Drop the images you want to compress here',
    pick: 'or choose files',
    promise: 'Nothing leaves your device',
  },

  toolbar: {
    destination: 'Destination',
    saveToFolder: 'Save to a folder',
    download: (done, count) => (done === 1 ? 'Download 1 image' : `Download ${count} as a ZIP`),
    cancel: 'Cancel',
    compress: (pending, count) => `Compress ${count} ${plural(pending, 'image', 'images')}`,
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

  filters: {
    todos: 'All',
    fits: 'Fit with room',
    tight: 'Just fit',
    over: 'Did not fit',
    failed: 'Failed',
    cancelled: 'Cancelled',
    pending: 'Queued',
  },

  selection: {
    selected: (count) => `${count} selected`,
    recompress: 'Recompress',
    download: (count) => `Download ${count}`,
    remove: 'Remove',
  },

  table: {
    label: 'Compression queue',
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
    running: 'Compressing',
    cancelled: 'Cancelled',
    shrunk: (size) => `Shrunk to ${size} to fit`,
    converted: (size, format) => `${size} · turned into ${format} to fit`,
    convertedAndShrunk: (size, format) => `Turned into ${format} and shrunk to ${size} to fit`,
  },

  details: {
    target: 'Destination asks for',
    ceiling: (bytes) => `max. ${bytes}`,
    anySize: 'any size',
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
  },

  totals: {
    compressed: (done, count) => `${count} ${plural(done, 'image', 'images')} compressed`,
    queued: (queued, count) => `${count} ${plural(queued, 'image', 'images')} in the queue`,
    less: (percent) => `${percent} smaller`,
    clear: 'Clear the queue',
    segments: {
      fits: 'with room',
      tight: 'just fit',
      over: 'did not fit',
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
    compressed: (name) => `${name}, compressed`,
    curtain: 'Comparison curtain',
    curtainValue: (percent) => `${percent}% of the width`,
    hint: 'Drag the curtain across to see before and after, or move it with the arrow keys. Compression artefacts only show at 1:1.',
  },

  errors: {
    emptyFile: 'Empty file, there is nothing to compress',
    unknownFormat: 'Not an image that can be recognised',
    heic: 'iPhone HEIC photos are not supported in this version. Export them as JPEG from the phone',
    unsupported: (format) =>
      `${format} is not supported. Convert the file to JPEG, PNG, WebP or AVIF`,
    decodeFailed: (format) => `Damaged ${format}, the image could not be read`,
    encodeFailed: (format) => `Could not produce the output ${format}`,
    workerCrashed:
      'The browser stopped the process, probably for lack of memory. Try fewer files at a time',
  },
}
