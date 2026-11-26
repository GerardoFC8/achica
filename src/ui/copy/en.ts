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
  Auditoría: 'Audit',
  Discord: 'Discord',
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
  'auditoria-mismo-formato': {
    label: 'Same format and size',
    note: 'Recompresses each image without changing its format or its dimensions, so the saving is what swapping the file for a lighter one would give, with no change to the page. It assumes neither a new format nor the size an image is painted at.',
  },
  'discord-sticker-gif': {
    label: 'Discord animated sticker (GIF)',
    note: 'A square 320 × 320 px canvas with a transparent background and a GIF of up to 512,000 bytes. If it does not fit, it lowers the frames per second and the colours, and flags the result if it is still too heavy. GIF only has all-or-nothing transparency, so soft edges come out jagged.',
  },
  'discord-sticker-apng': {
    label: 'Discord animated sticker (APNG)',
    note: 'A square 320 × 320 px canvas and an APNG of up to 512,000 bytes, with soft transparency. It is saved as .png, because Discord rejects the .apng extension. If it does not fit, it lowers the frames per second and the colours.',
  },
  'discord-emoji-gif': {
    label: 'Discord animated emoji (GIF)',
    note: 'Fits inside 128 × 128 px without being enlarged, keeps its proportions and weighs up to 256,000 bytes. If it does not fit, it lowers the frames per second and the colours.',
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
      download: (done, count) => (done === 1 ? 'Download 1 image' : `Download ${count} as a ZIP`),
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
      download: (done, count) => (done === 1 ? 'Download 1 image' : `Download ${count} as a ZIP`),
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
      download: (done, count) => (done === 1 ? 'Download 1 image' : `Download ${count} as a ZIP`),
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
      download: (done, count) => (done === 1 ? 'Download 1 image' : `Download ${count} as a ZIP`),
      resultAlt: (name) => `${name}, cleaned`,
    },
    discord: {
      heading: 'Drop the animation or video you want to turn into a Discord sticker or emoji here',
      hint: 'GIF, APNG, animated WebP or video (MP4, WebM)',
      dropNote: 'A video plays in this tab while it is prepared, so the tab has to stay visible.',
      start: (pending, count) => `Prepare ${count} ${plural(pending, 'animation', 'animations')}`,
      running: 'Preparing',
      finished: (done, count) => `${count} ${plural(done, 'animation', 'animations')} ready`,
      again: 'Prepare again',
      emptyFile: 'Empty file, there is no animation to prepare',
      tableLabel: 'Animation queue',
      weightHeader: 'Weight against the Discord limit',
      download: (done, count) =>
        done === 1 ? 'Download 1 animation' : `Download ${count} as a ZIP`,
      resultAlt: (name) => `${name}, fitted for Discord`,
    },
    auditar: {
      heading: 'Drop the HAR file of the page you want to measure here',
      start: (pending, count) =>
        `Measure the saving on ${count} ${plural(pending, 'image', 'images')}`,
      running: 'Measuring',
      finished: (done, count) => `${count} ${plural(done, 'image', 'images')} measured`,
      again: 'Measure again',
      emptyFile: 'Empty file, there is nothing to measure',
      tableLabel: 'Images in the HAR',
      weightHeader: 'Weight before and after',
      download: (done, count) => (done === 1 ? 'Download 1 image' : `Download ${count} as a ZIP`),
      resultAlt: (name) => `${name}, recompressed`,
    },
  },

  nav: {
    label: 'Tools',
    tools: {
      comprimir: 'Compress',
      redimensionar: 'Resize',
      convertir: 'Convert',
      'quitar-exif': 'Remove EXIF',
      discord: 'Discord',
      auditar: 'Audit a page',
    },
  },

  drop: {
    pick: 'or choose files',
    promise: 'Nothing leaves your device',
  },

  audit: {
    pick: 'or choose a file',
    howTo:
      'Export the HAR from the Network tab of your browser developer tools, with the response contents included.',
    privacy:
      'The file is read in your browser, and cookies and headers are neither shown nor stored.',
    warning: 'A HAR can carry your session data: it is best not to share it.',
    reading: 'Reading the HAR',
    errors: {
      notJson:
        'This file is not JSON, so it is not a HAR. Export it again from the Network tab of your developer tools',
      notHar:
        'It is JSON, but not a HAR: it has no list of requests. Export it from the Network tab of your developer tools',
      tooManyEntries: (count, max) =>
        `The HAR has ${count} requests and the maximum is ${max}. Export one from a single visit to the page`,
      tooLarge: (size, max) =>
        `The file weighs ${size} and the maximum is ${max}. Export a HAR from a single visit to the page`,
      noImages: (entries, count) =>
        entries === 0
          ? 'The HAR has no image requests. Check that you exported it after the page had loaded'
          : `The HAR has ${count} ${plural(entries, 'image', 'images')}, but ${plural(entries, 'it cannot be measured', 'none can be measured')}`,
      noImagesNoContent:
        'Some responses came out with no content: export the HAR again with the response contents included',
      severalFiles: 'Drop a single HAR file at a time',
      readFailed:
        'The file could not be read. If it is very large, the browser may have run out of memory: try a smaller HAR',
    },
    summary: {
      line: (measurable, count, total, weight, destination) =>
        `${count} measurable ${plural(measurable, 'image', 'images')} out of ${total} in the HAR · ${weight} in total · destination “${destination}”`,
      alreadyFine: (n, count) => `${count} ${plural(n, 'was', 'were')} already fine`,
      skippedTitle: (_n, count) => `Not measurable: ${count}`,
      duplicates: (n, count) => `${count} repeated ${plural(n, 'request', 'requests')} ignored`,
      unknownType: 'unknown type',
      reasons: {
        'no-content': 'no content in the HAR: export it again with the contents included',
        cached: 'served from the browser cache, so there is no content to measure',
        'unsupported-format': 'a format achica does not optimise yet (SVG, GIF…)',
        'unreadable-content': 'unreadable content',
        partial: 'partial download: only a piece of the file',
        'failed-request': 'failed request',
      },
    },
  },

  toolbar: {
    destination: 'Destination',
    saveToFolder: 'Save to a folder',
    cancel: 'Cancel',
    stripLabel: 'No re-encoding',
    stripTitle:
      'Removes the metadata from the file without touching the pixels. Keeps the colour profile and the orientation.',
  },

  destination: {
    ourAdvice: 'Our advice',
    theirLimit: 'File size limit Discord publishes',
    source: 'Source',
    verifiedAt: (date) => `verified on ${date}`,
    notAGuarantee:
      'The file is fitted to the size limits Discord publishes, but there is no guarantee that Discord accepts it: worth testing it.',
    canvasReduction: 'If it does not fit, reduce the canvas to 256 px',
    canvasReductionNote: 'Discord accepted it in our tests, but its screen asks for 320 × 320',
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

  video: {
    title: 'Video',
    onlyVideos:
      "Only used for video files. Frames per second is a maximum: the result never goes above the video's own rate, so a 10 fps video comes out at 10 fps even if you ask for 15.",
    start: 'Start (s)',
    length: 'Length (s)',
    fps: 'Frames per second (max)',
    capNote: (seconds, frames) =>
      `The cap of ${seconds} s and ${frames} frames is achica's, not Discord's: playing the segment takes as long as it lasts, and the frames are held in memory.`,
    problems: {
      empty: 'Type a number.',
      notNumber: 'That is not a number. Type, for example, 2.5.',
      negative: 'It cannot be negative.',
    },
    adjusted: (value) => `Adjusted to ${value}, the tool's limit.`,
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
    limitBar: (weight, limit) => `came to ${weight}, against a limit of ${limit}`,
    bar: (from, weight, budget) =>
      budget === null
        ? `${from} came down to ${weight}, with no limit`
        : `${from} came down to ${weight}, against a limit of ${budget}`,
  },

  note: {
    pending: 'Queued',
    cancelled: 'Cancelled',
    alreadyFine: 'Already fine: not reduced',
    shrunk: (size) => `Shrunk to ${size} to fit`,
    converted: (size, format) => `${size} · turned into ${format} to fit`,
    convertedAndShrunk: (size, format) => `Turned into ${format} and shrunk to ${size} to fit`,
    stripUnchanged: (keptOrientation) =>
      keptOrientation
        ? 'It only had the orientation, which is kept: left as it was'
        : 'It had no metadata: left as it was',
    animation: {
      fps: (fps) => `${fps} fps`,
      colors: (colors) => `${colors} colours`,
      fullColor: 'full colour',
      canvas: (size) => `canvas ${size}`,
      steps: {
        fps: (to) => `lowered to ${to} fps`,
        palette: (colors) => `${colors}-colour palette`,
        scale: (percent) => `size reduced to ${percent}%`,
        canvas: (px) => `canvas reduced to ${px} px`,
        diffOff: 'cropping to what changes turned off',
      },
      clip: (from, to, total) => `Segment from ${from} to ${to} s of ${total} s`,
      otherDestination: 'made for another destination',
      fits: 'Fits the limit',
      over: (size, limit) =>
        `Does not fit the limit of ${limit}: this is the smallest version that could be made (${size})`,
    },
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
    harUrl: 'Address in the HAR',
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
    frames: 'Frames',
    duration: 'Duration',
    fps: 'Frames per second',
    colors: 'Colours',
    clip: 'Video segment',
    clipValue: (from, length, total) => `from ${from} s, ${length} s of ${total} s`,
    processedWithOther: (limit) => `max. ${limit} (other destination)`,
    adjusted: 'Adjusted',
    adjustedNothing: 'nothing, it fitted as it was',
    preview: 'Preview',
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
    animation: {
      notAnimated:
        'This image is not animated. Discord already rescales still images by itself: use Compress or Resize',
      unsupportedBrowser: 'This browser cannot read animations. Try Chrome, Edge or Firefox',
      unsupportedFormat:
        'Only GIF, APNG and animated WebP animations can be read. For any other image use Compress or Convert',
      corrupt: 'The animation is damaged or cut off, so it could not be read. Try another file',
      tooLarge: 'The animation is too large. Try a shorter or smaller one',
      resizeFailed: 'The frames could not be resized. Try a smaller animation',
      compressionUnavailable:
        'This browser cannot compress the APNG. Try Chrome, Edge or Firefox, or choose GIF',
      encodeFailed: 'The output animation could not be generated',
    },
    video: {
      codecUnsupported:
        'This browser cannot read the codec of this video (for example, HEVC). Try Chrome, Edge or Firefox, or convert it to H.264',
      stalled: 'Keep this tab visible while the video is being prepared, and try again',
      noVideoTrack: 'The file has no picture, only audio. Choose an MP4 or WebM video',
      unsupportedVideo: 'Only MP4 and WebM videos can be read. Convert the file to one of those',
      // A decode that fails after the metadata loaded is what Firefox reports for HEVC,
      // so this message cannot blame the file alone.
      corrupt:
        'The video could not be read: it may be damaged, or use a codec this browser does not play (for example HEVC, common in phone videos). Try Chrome or Edge, another file, or convert it to H.264',
      aborted: 'Reading the video was cancelled',
      internal: 'The video could not be prepared. Try again or try another file',
    },
  },
}
