/**
 * The smoke test: the whole product, against the production build, in both
 * browsers it targets.
 *
 * It runs on `vite preview` rather than the dev server on purpose — that is
 * the build that ships, served with the same COOP and COEP headers the host
 * sends, so a header problem or a bundling problem fails here instead of after
 * a deploy.
 *
 * The check that matters most is the network audit. "No byte leaves your
 * device" is the product's whole argument, and phase 0 could only measure it
 * from inside the page, where Resource Timing is a floor and not a record.
 * Playwright sees every request the browser makes, which is the instrument
 * that claim always needed.
 *
 * Several batches per browser, because the product has several paths through
 * it. The compressor's default destination converts to WebP; the others keep
 * the format, and a PNG kept as PNG is packed by oxipng (D50). Running only the
 * default would ship the second path without it ever touching the build (D51).
 * The resize and convert tools each get their own page and their own batches,
 * and those read the result back out of the ZIP: the dimensions of every
 * image, and the signature of every converted file.
 *
 * Before any browser, the page is read from Node with no JavaScript at all:
 * that is what a crawler or a link preview gets, and it has to carry the
 * title, the first screen and the preview image on its own (D52).
 *
 * The folder save is not here and cannot be: showDirectoryPicker needs a user
 * gesture and opens a native dialog no automation can drive. It is covered by
 * fakes in src/output/save.browser-test.ts and verified by hand.
 *
 * Given a URL it tests that instead, which is how a deploy gets checked
 * against the real host: `node scripts/smoke.mjs https://achica.gfcode.dev`.
 * There it also lists any same-origin request the page did not make itself —
 * the edge injects its own, and naming them is the point of the audit.
 *
 * Run: npm run build && npm run smoke
 */

import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'
import { chromium, firefox } from 'playwright'
import { preview } from 'vite'
import { listPages, urlForPath } from '../src/tools/pages.ts'
import { REGISTRY } from '../src/tools/registry.ts'
import { entry as harEntry, har as harDocument } from '../test/helpers/har-builders.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = (path) => join(ROOT, 'test', 'fixtures', path)

/**
 * What is inside a ZIP, read from its central directory with Node's own zlib:
 * no dependency, and no trust in the local headers, which a streaming writer
 * may leave without sizes.
 */
function readZip(bytes) {
  const end = bytes.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'))
  if (end < 0) throw new Error('no end-of-directory record')

  const count = bytes.readUInt16LE(end + 10)
  let at = bytes.readUInt32LE(end + 16)
  const entries = []

  for (let i = 0; i < count; i++) {
    const method = bytes.readUInt16LE(at + 10)
    const size = bytes.readUInt32LE(at + 20)
    const nameLength = bytes.readUInt16LE(at + 28)
    const extraLength = bytes.readUInt16LE(at + 30)
    const commentLength = bytes.readUInt16LE(at + 32)
    const local = bytes.readUInt32LE(at + 42)
    const name = bytes.toString('utf8', at + 46, at + 46 + nameLength)

    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28)
    const raw = bytes.subarray(start, start + size)
    entries.push({ name, data: method === 0 ? raw : inflateRawSync(raw) })

    at += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/** Width and height from a PNG's IHDR, or from a JPEG's first SOF marker. */
function dimensionsOf(data) {
  if (data.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
  }
  if (data[0] === 0xff && data[1] === 0xd8) {
    let at = 2
    while (at + 9 < data.length) {
      if (data[at] !== 0xff) throw new Error('lost the JPEG marker stream')
      const marker = data[at + 1]
      // SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC), which are not frames.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: data.readUInt16BE(at + 7), height: data.readUInt16BE(at + 5) }
      }
      at += 2 + data.readUInt16BE(at + 2)
    }
  }
  return null
}

const isJpeg = (data) => data[0] === 0xff && data[1] === 0xd8
const isWebp = (data) =>
  data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP'

/** The entry that came out of a given input, matched by its stem. */
const stemOf = (name) => name.replace(/\.[^.]+$/, '')

/** Every converted file says what it is in its first bytes, not only in its name. */
const verifySignature = (format, test) => (entries, batch) => {
  for (const entry of entries) {
    check(`${entry.name} is really ${format}`, test(entry.data))
  }
  check('one entry per input', entries.length === batch.files.length)
}

/** The resize batch: every image comes out at half its original sides. */
async function verifyHalved(entries, batch) {
  for (const file of batch.files) {
    const stem = stemOf(file.split(/[\\/]/).pop())
    const entry = entries.find((candidate) => stemOf(candidate.name) === stem)
    const before = dimensionsOf(await readFile(file))
    const after = entry === undefined ? null : dimensionsOf(entry.data)

    check(
      `${stem} is half its size`,
      before !== null &&
        after !== null &&
        after.width === Math.round(before.width / 2) &&
        after.height === Math.round(before.height / 2),
      `${before?.width}x${before?.height} -> ${after?.width}x${after?.height}`,
    )
  }
}

/*
 * A dirty JPEG built here, with no dependency: the clean fixture plus an EXIF
 * block (camera strings and a GPS position), an XMP packet, a COM segment and
 * a tail after the EOI, each carrying a sentinel the output must not contain.
 * "Nothing survived" is a raw byte search, not the stripper's own report.
 */
const le32 = (value) => {
  const out = Buffer.alloc(4)
  out.writeUInt32LE(value)
  return out
}
const le16 = (value) => {
  const out = Buffer.alloc(2)
  out.writeUInt16LE(value)
  return out
}
const segment = (marker, payload) =>
  Buffer.concat([
    Buffer.from([0xff, marker]),
    Buffer.from([(payload.length + 2) >> 8, (payload.length + 2) & 0xff]),
    payload,
  ])

const SENTINELS = {
  make: Buffer.from('SMOKE_CAMERA_MAKE_ZX81'),
  model: Buffer.from('SMOKE_CAMERA_MODEL_QQ9'),
  xmp: Buffer.from('SMOKE_XMP_CREATOR_JANE'),
  comment: Buffer.from('SMOKE_COMMENT_HELLO'),
  tail: Buffer.from('SMOKE_TAIL_AFTER_EOI'),
  // 40/1, 26/1, 4631/100 and 79/1, 58/1, 5614/100 as RATIONALs, plus the
  // seconds alone: eight bytes that appear nowhere else.
  latitude: Buffer.concat([40, 1, 26, 1, 4631, 100].map(le32)),
  longitude: Buffer.concat([79, 1, 58, 1, 5614, 100].map(le32)),
  seconds: Buffer.concat([4631, 100].map(le32)),
}

function dirtyJpeg(clean) {
  const entry = (tag, type, count, value) =>
    Buffer.concat([le16(tag), le16(type), le32(count), value])
  const text = (sentinel) => {
    const bytes = Buffer.concat([sentinel, Buffer.from([0])])
    return bytes.length % 2 === 0 ? bytes : Buffer.concat([bytes, Buffer.from([0])])
  }
  const make = text(SENTINELS.make)
  const model = text(SENTINELS.model)
  // IFD0 has three entries, so its data starts at 8 + 2 + 3 * 12 + 4.
  const makeAt = 8 + 2 + 3 * 12 + 4
  const modelAt = makeAt + make.length
  const gpsAt = modelAt + model.length
  const latAt = gpsAt + 2 + 4 * 12 + 4
  const lonAt = latAt + SENTINELS.latitude.length
  const gps = Buffer.concat([
    le16(4),
    entry(1, 2, 2, Buffer.from([0x4e, 0, 0, 0])),
    entry(2, 5, 3, le32(latAt)),
    entry(3, 2, 2, Buffer.from([0x57, 0, 0, 0])),
    entry(4, 5, 3, le32(lonAt)),
    le32(0),
  ])
  const tiff = Buffer.concat([
    Buffer.from('II'),
    le16(42),
    le32(8),
    le16(3),
    entry(0x010f, 2, make.length, le32(makeAt)),
    entry(0x0110, 2, model.length, le32(modelAt)),
    entry(0x8825, 4, 1, le32(gpsAt)),
    le32(0),
    make,
    model,
    gps,
    SENTINELS.latitude,
    SENTINELS.longitude,
  ])
  const xmp = Buffer.concat([
    Buffer.from('http://ns.adobe.com/xap/1.0/\0'),
    Buffer.from(`<x:xmpmeta><dc:creator>${SENTINELS.xmp}</dc:creator></x:xmpmeta>`),
  ])

  // The clean fixture opens with SOI and a bare 16-byte JFIF segment.
  if (clean.readUInt16BE(2) !== 0xffe0 || clean.readUInt16BE(4) !== 16) {
    throw new Error('the clean JPEG is expected to open with a bare JFIF segment')
  }
  if (clean.readUInt16BE(clean.length - 2) !== 0xffd9)
    throw new Error('the clean JPEG lacks an EOI')
  return Buffer.concat([
    clean.subarray(0, 20),
    segment(0xe1, Buffer.concat([Buffer.from('Exif\0\0'), tiff])),
    segment(0xe1, xmp),
    segment(0xfe, SENTINELS.comment),
    clean.subarray(20),
    SENTINELS.tail,
  ])
}

// Two files, so the batch ends in a ZIP and the names can be told apart.
const DIRTY_NAMES = ['foto-sucia.jpg', 'otra-foto.jpg']
const dirtyInputs = () =>
  DIRTY_NAMES.map((name) => ({
    name,
    mimeType: 'image/jpeg',
    buffer: dirtyJpeg(readFileSync(fixture('generated/no-exif.jpg'))),
  }))

/** The strip batch: no sentinel survives, and the names and the dimensions stay. */
async function verifyCleaned(entries, batch) {
  for (const { name: expected, buffer: original } of batch.inputs()) {
    const entry = entries.find((candidate) => candidate.name === expected)
    check(
      `${expected}: the name is kept`,
      entry !== undefined,
      entries.map((e) => e.name).join(', '),
    )
    if (entry === undefined) continue

    for (const [name, sentinel] of Object.entries(SENTINELS)) {
      check(`${expected}: the ${name} sentinel was in the input`, original.indexOf(sentinel) !== -1)
      check(`${expected}: no ${name} sentinel in the output`, entry.data.indexOf(sentinel) === -1)
    }
    check(`${expected}: the output is a JPEG`, isJpeg(entry.data))
    check(`${expected}: the output is smaller`, entry.data.length < original.length)

    const before = dimensionsOf(original)
    const after = dimensionsOf(entry.data)
    check(
      `${expected}: the dimensions are the original ones`,
      before !== null &&
        after !== null &&
        before.width === after.width &&
        before.height === after.height,
      `${before?.width}x${before?.height} -> ${after?.width}x${after?.height}`,
    )
  }
}

/*
 * Discord (S6a). The ZIP is read back and each file is judged by its own
 * bytes, the way Discord would see it: the extension it is saved under, the
 * signature, the size it declares and the weight. None of it trusts the
 * interface's own verdict.
 */
const STICKER_LIMIT = 512_000
const EMOJI_LIMIT = 256_000

/** The logical screen of a GIF, from its header. */
const gifScreen = (data) => ({ width: data.readUInt16LE(6), height: data.readUInt16LE(8) })

const isPng = (data) => data.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'

/** A chunk of a PNG by name, found by walking the chunk list and not by searching the bytes. */
function hasPngChunk(data, wanted) {
  let at = 8
  while (at + 8 <= data.length) {
    const length = data.readUInt32BE(at)
    if (data.toString('latin1', at + 4, at + 8) === wanted) return true
    at += 12 + length
  }
  return false
}

/** A sticker as a GIF: .gif, GIF89a, a 320 x 320 screen, and under 512 000 bytes. */
function verifyStickerGif(entries, batch) {
  check('one entry per animation that could be made', entries.length === batch.done)
  for (const entry of entries) {
    const screen = gifScreen(entry.data)
    check(`${entry.name} is a .gif`, entry.name.endsWith('.gif'))
    check(`${entry.name} says GIF89a`, entry.data.toString('latin1', 0, 6) === 'GIF89a')
    check(
      `${entry.name} has a 320x320 screen`,
      screen.width === 320 && screen.height === 320,
      `${screen.width}x${screen.height}`,
    )
    check(
      `${entry.name} weighs at most 512 000 bytes`,
      entry.data.length <= STICKER_LIMIT,
      `${entry.data.length}`,
    )
  }
}

/** A sticker as an APNG: saved as .png (never .apng), PNG signature, acTL, 320 x 320. */
function verifyStickerApng(entries, batch) {
  check('one entry per animation', entries.length === batch.done)
  for (const entry of entries) {
    check(`${entry.name} is a .png and not an .apng`, /\.png$/.test(entry.name))
    check(`${entry.name} has the PNG signature`, isPng(entry.data))
    check(`${entry.name} has an acTL chunk, so it animates`, hasPngChunk(entry.data, 'acTL'))
    const size = dimensionsOf(entry.data)
    check(
      `${entry.name} is 320x320 in its IHDR`,
      size !== null && size.width === 320 && size.height === 320,
      `${size?.width}x${size?.height}`,
    )
    check(
      `${entry.name} weighs at most 512 000 bytes`,
      entry.data.length <= STICKER_LIMIT,
      `${entry.data.length}`,
    )
  }
}

/** An emoji: a GIF no bigger than 128 px on either side, under 256 000 bytes. */
function verifyEmoji(entries, batch) {
  check('one file per animation', entries.length === batch.done)
  for (const entry of entries) {
    const screen = gifScreen(entry.data)
    check(
      `${entry.name} is a GIF`,
      entry.name.endsWith('.gif') && entry.data.toString('latin1', 0, 6) === 'GIF89a',
    )
    check(
      `${entry.name} fits inside 128x128`,
      screen.width > 0 && screen.width <= 128 && screen.height > 0 && screen.height <= 128,
      `${screen.width}x${screen.height}`,
    )
    check(
      `${entry.name} weighs at most 256 000 bytes`,
      entry.data.length <= EMOJI_LIMIT,
      `${entry.data.length}`,
    )
  }
}

/**
 * What a GIF says about its own timing: how many frames it has and how long
 * they last, read by walking its blocks (not by trusting the interface). Each
 * frame's delay is in hundredths of a second, as the format has it; a delay of
 * zero is counted as the ten that every viewer shows instead.
 */
function gifTiming(data) {
  let at = 13
  if (data[10] & 0x80) at += 3 * 2 ** ((data[10] & 7) + 1)
  let frames = 0
  let hundredths = 0
  let pending = 0
  while (at < data.length && data[at] !== 0x3b) {
    if (data[at] === 0x21) {
      if (data[at + 1] === 0xf9) pending = data.readUInt16LE(at + 4) || 10
      at += 2
    } else if (data[at] === 0x2c) {
      const flags = data[at + 9]
      frames += 1
      hundredths += pending
      pending = 0
      at += 10
      if (flags & 0x80) at += 3 * 2 ** ((flags & 7) + 1)
      at += 1
    } else {
      return { frames, ms: hundredths * 10, broken: true }
    }
    // Sub-blocks: a length, that many bytes, until a zero length.
    while (at < data.length && data[at] !== 0) at += data[at] + 1
    at += 1
  }
  return { frames, ms: hundredths * 10, broken: false }
}

/** The frame rate of the generated video fixtures (video-gray-steps.webm / .mp4). */
const GRAY_STEPS_FPS = 8

/**
 * A video as a sticker GIF: what a sticker is, and in addition the segment that
 * was asked for. Frames and duration are within 15 % (at least one frame) of
 * the seconds and the rate chosen in the panel, where that rate is a MAXIMUM:
 * the result never has more frames per second than the video itself, so the
 * wanted count is seconds x min(rate asked, rate of the video).
 */
const verifyVideoGif = (seconds, fps, sourceFps) => (entries, batch) => {
  verifyStickerGif(entries, batch)
  for (const entry of entries) {
    const timing = gifTiming(entry.data)
    const wantedFrames = seconds * Math.min(fps, sourceFps)
    const wantedMs = seconds * 1000
    check(`${entry.name} is a well-formed GIF`, !timing.broken)
    check(
      `${entry.name} has about ${wantedFrames} frames (seconds x fps)`,
      Math.abs(timing.frames - wantedFrames) <= Math.max(1, wantedFrames * 0.15),
      `${timing.frames}`,
    )
    check(
      `${entry.name} lasts about ${wantedMs} ms`,
      Math.abs(timing.ms - wantedMs) <= wantedMs * 0.15,
      `${timing.ms} ms`,
    )
  }
}

/** The failed row says what to do, in words, and the page is still standing. */
async function verifyNotAnimatedRow(page, batch) {
  const text = await page.locator('main').innerText()
  check(
    'the still image has its failed row, with the way out',
    batch.notAnimated.test(text),
    text.replace(/\s+/g, ' ').slice(0, 200),
  )
}

/*
 * Full names in `expected`, not stems: the extension that comes out is what
 * each destination promises, so it is what gets checked.
 */
const BATCHES = [
  {
    label: 'default destination, converted to WebP',
    destination: null,
    files: [
      fixture('vendor/exif-orientation/Landscape_6.jpg'),
      fixture('generated/no-exif.jpg'),
      fixture('generated/sample.webp'),
    ],
    expected: ['Landscape_6.webp', 'no-exif.webp', 'sample.webp'],
    oxipng: false,
  },
  {
    label: 'a destination that keeps the format',
    destination: /Adjunto de correo/,
    files: [fixture('generated/no-exif.jpg'), fixture('vendor/pngsuite/basn6a08.png')],
    expected: ['no-exif.jpg', 'basn6a08.png'],
    oxipng: true,
  },
  {
    // The second language and the weight ceiling, both against the build:
    // the English page has its own entry, and the ceiling its own path
    // through the pipeline (D53, D54).
    label: 'the English page, with a weight ceiling',
    language: 'en',
    destination: /Email attachment/,
    budget: '100 KB',
    files: [fixture('vendor/exif-orientation/Landscape_6.jpg'), fixture('generated/no-exif.jpg')],
    expected: ['Landscape_6.jpg', 'no-exif.jpg'],
    oxipng: false,
  },
  {
    // Fixtures with even sides and no EXIF rotation, so half is exact and the
    // header's width and height are the ones the user sees.
    label: 'resize, in Spanish, at the default 50 %',
    tool: 'redimensionar',
    language: 'es',
    files: [
      fixture('generated/no-exif.jpg'),
      fixture('vendor/pngsuite/basn6a08.png'),
      fixture('vendor/pngsuite/basi2c08.png'),
    ],
    expected: ['no-exif.jpg', 'basn6a08.png', 'basi2c08.png'],
    oxipng: true,
    verify: verifyHalved,
  },
  {
    label: 'convert, in English, to the default WebP',
    tool: 'convertir',
    language: 'en',
    files: [
      fixture('vendor/exif-orientation/Landscape_6.jpg'),
      fixture('generated/no-exif.jpg'),
      fixture('vendor/pngsuite/basn6a08.png'),
    ],
    expected: ['Landscape_6.webp', 'no-exif.webp', 'basn6a08.webp'],
    oxipng: false,
    verify: verifySignature('WebP', isWebp),
  },
  {
    // The cheap proof that nothing was re-encoded: no codec was fetched.
    label: 'remove EXIF, in Spanish, from a JPEG with planted metadata',
    tool: 'quitar-exif',
    language: 'es',
    inputs: dirtyInputs,
    expected: DIRTY_NAMES,
    oxipng: false,
    wasm: false,
    verify: verifyCleaned,
  },
  {
    label: 'remove EXIF, in English, from a JPEG with planted metadata',
    tool: 'quitar-exif',
    language: 'en',
    inputs: dirtyInputs,
    expected: DIRTY_NAMES,
    oxipng: false,
    wasm: false,
    verify: verifyCleaned,
  },
  {
    // A PNG with an alpha channel is the case that matters: JPEG has none, so
    // the pipeline composes it over white (it must not fail or go black).
    label: 'convert, in Spanish, to JPEG, with a transparent PNG',
    tool: 'convertir',
    language: 'es',
    format: /^JPEG/,
    files: [fixture('vendor/pngsuite/basn6a08.png'), fixture('vendor/pngsuite/basi2c08.png')],
    expected: ['basn6a08.jpg', 'basi2c08.jpg'],
    oxipng: false,
    verify: verifySignature('JPEG', isJpeg),
  },
  {
    // The default destination: the sticker as a GIF, the lightest and the one
    // that went into every real test.
    label: 'Discord, in Spanish, a sticker as GIF',
    tool: 'discord',
    language: 'es',
    files: [fixture('generated/anim-opaque.gif'), fixture('generated/anim-wide.gif')],
    done: 2,
    expected: ['anim-opaque.gif', 'anim-wide.gif'],
    oxipng: false,
    verify: verifyStickerGif,
  },
  {
    // A GIF-only source cannot be an APNG's only test: an APNG and an animated
    // WebP come in, and a .png comes out, twice under the same stem.
    label: 'Discord, in English, a sticker as APNG, from an APNG and an animated WebP',
    tool: 'discord',
    language: 'en',
    destination: /[Ss]ticker.*APNG/,
    files: [fixture('generated/anim.apng'), fixture('generated/anim.webp')],
    done: 2,
    expected: ['anim.png', 'anim-2.png'],
    oxipng: false,
    verify: verifyStickerApng,
  },
  {
    // One finished file is handed over as itself, not wrapped in a ZIP.
    label: 'Discord, in Spanish, an emoji',
    tool: 'discord',
    language: 'es',
    destination: /Emoji.*GIF/,
    files: [fixture('generated/anim-wide.gif')],
    done: 1,
    expected: ['anim-wide.gif'],
    oxipng: false,
    verify: verifyEmoji,
  },
  {
    // A still image in the batch: its row fails, with what to do, and the rest
    // of the batch is made and saved.
    label: 'Discord, in English, a still image among animations',
    tool: 'discord',
    language: 'en',
    files: [
      fixture('generated/static.png'),
      fixture('generated/anim-delays.gif'),
      fixture('generated/anim-transparent.gif'),
    ],
    done: 2,
    expected: ['anim-delays.gif', 'anim-transparent.gif'],
    oxipng: false,
    verify: verifyStickerGif,
    notAnimated: /not animated/,
    page: verifyNotAnimatedRow,
  },
  {
    // The fixture is 2 s long and 8 fps: the whole of it, and the 10 fps asked is a
    // maximum, so it comes out at the video's own 8 (16 frames, 125 ms each).
    label: 'Discord, in Spanish, a WebM video as a sticker, 0 to 2 s at 10 fps',
    tool: 'discord',
    language: 'es',
    video: { start: '0', length: '2', fps: '10' },
    files: [fixture('generated/video-gray-steps.webm')],
    done: 1,
    expected: ['video-gray-steps.gif'],
    oxipng: false,
    verify: verifyVideoGif(2, 10, GRAY_STEPS_FPS),
  },
  {
    // Only the duration changes, at the default 15 fps (above the video's 8): a second, not two.
    label: 'Discord, in English, the same video with the duration set to 1 s',
    tool: 'discord',
    language: 'en',
    video: { length: '1' },
    files: [fixture('generated/video-gray-steps.webm')],
    done: 1,
    expected: ['video-gray-steps.gif'],
    oxipng: false,
    verify: verifyVideoGif(1, 15, GRAY_STEPS_FPS),
  },
  {
    // Only where this browser can play H.264; it says so when it cannot.
    label: 'Discord, in Spanish, an MP4 video as a sticker, 0 to 1 s at 8 fps',
    tool: 'discord',
    language: 'es',
    video: { start: '0', length: '1', fps: '8' },
    needsMp4: true,
    files: [fixture('generated/video-gray-steps.mp4')],
    done: 1,
    expected: ['video-gray-steps.gif'],
    oxipng: false,
    verify: verifyVideoGif(1, 8, GRAY_STEPS_FPS),
  },
]

/**
 * What each page says, so the same run reads both languages and every tool.
 * The route of each page comes from the registry (D57), not from here: `pathOf`
 * below.
 *
 * `saved` is the compressor's alone: it is the only tool whose totals promise a
 * saving, and a converted PNG may legitimately weigh more.
 */
const WORDS = {
  es: {
    destination: /^Destino/,
    zip: /Descargar .* en un ZIP/,
    comprimir: {
      title: /comprimir/i,
      heading: /imágenes que quieres comprimir/,
      start: /Comprimir/,
      busy: 'Comprimiendo',
      finished: (count) => `${count} imágenes comprimidas`,
      saved: /% menos/,
    },
    redimensionar: {
      title: /redimensionar/i,
      heading: /imágenes que quieres redimensionar/,
      start: /Redimensionar/,
      busy: 'Redimensionando',
      finished: (count) => `${count} imágenes redimensionadas`,
    },
    convertir: {
      title: /convertir/i,
      heading: /imágenes que quieres convertir/,
      start: /Convertir/,
      busy: 'Convirtiendo',
      finished: (count) => `${count} imágenes convertidas`,
    },
    'quitar-exif': {
      title: /EXIF/,
      heading: /quieres quitar los metadatos/,
      start: /Limpiar/,
      busy: 'Limpiando',
      finished: (count) => `${count} imágenes limpiadas`,
    },
    discord: {
      title: /Discord/,
      heading: /animación o el video que quieres convertir/,
      start: /Preparar/,
      busy: 'Preparando',
      finished: (count) => `${count} ${count === 1 ? 'animación lista' : 'animaciones listas'}`,
      single: /Descargar 1 animación/,
      fields: { start: 'Inicio (s)', length: 'Duración (s)', fps: 'Fotogramas por segundo (máx.)' },
    },
    auditar: {
      title: /HAR/,
      heading: /archivo HAR de la página/,
      start: /Medir el ahorro/,
      busy: 'Midiendo',
      finished: (count) => `${count} imágenes medidas`,
    },
  },
  en: {
    destination: /^Destination/,
    zip: /Download .* as a ZIP/,
    comprimir: {
      title: /compress/i,
      heading: /images you want to compress/,
      start: /Compress/,
      busy: 'Compressing',
      finished: (count) => `${count} images compressed`,
      saved: /% smaller/,
    },
    redimensionar: {
      title: /resize/i,
      heading: /images you want to resize/,
      start: /Resize/,
      busy: 'Resizing',
      finished: (count) => `${count} images resized`,
    },
    convertir: {
      title: /convert/i,
      heading: /images you want to convert/,
      start: /Convert/,
      busy: 'Converting',
      finished: (count) => `${count} images converted`,
    },
    'quitar-exif': {
      title: /EXIF/,
      heading: /remove the metadata from/,
      start: /Clean/,
      busy: 'Cleaning',
      finished: (count) => `${count} images cleaned`,
    },
    discord: {
      title: /Discord/,
      heading: /animation or video you want to turn into/,
      start: /Prepare/,
      busy: 'Preparing',
      finished: (count) => `${count} ${count === 1 ? 'animation' : 'animations'} ready`,
      single: /Download 1 animation/,
      fields: { start: 'Start (s)', length: 'Length (s)', fps: 'Frames per second (max)' },
    },
    auditar: {
      title: /HAR/,
      heading: /HAR file of the page/,
      start: /Measure the saving/,
      busy: 'Measuring',
      finished: (count) => `${count} images measured`,
    },
  },
}

/** A tool's route in a language, from the registry. */
const pathOf = (language, toolId = 'comprimir') => {
  const locale = REGISTRY.tools.find((tool) => tool.id === toolId)?.locales[language]
  if (locale === undefined) throw new Error(`the registry has no ${toolId} in ${language}`)
  return locale.path
}

const LOCAL_HEADER = '504b0304'
const CENTRAL_ENTRY = 'PK\x01\x02'
const END_OF_DIRECTORY = 'PK\x05\x06'

const target = process.argv[2]

if (target === undefined) {
  try {
    await stat(join(ROOT, 'dist', 'index.html'))
  } catch {
    console.error('No dist/ to test. Run npm run build first.')
    process.exit(1)
  }
}

const server =
  target === undefined ? await preview({ logLevel: 'error', preview: { port: 0 } }) : null
const base = target ?? server?.resolvedUrls?.local?.[0]
if (base === undefined) throw new Error('vite preview did not report a local url')

console.log(`Testing ${base}`)

const origin = new URL(base).origin
let failed = false

const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail === '' ? '' : ` — ${detail}`}`)
  if (!ok) failed = true
}

/** One batch on a fresh page, so each network audit starts from the first byte. */
async function runBatch(browser, batch, downloads) {
  const page = await browser.newPage({ acceptDownloads: true })

  try {
    /*
     * Every request the page makes, from the first byte. A blob: or data:
     * URL never touches the network, so only real schemes are recorded.
     */
    const foreign = []
    /** Same-origin requests nothing in our bundle asks for: the edge's own. */
    const injected = []
    /*
     * The oxipng wasm the page fetched. Both builds, single and multithreaded,
     * ship under the same name, so this proves oxipng ran — not which build.
     */
    const oxipng = []
    /** Every .wasm the page asked for: a codec fetched is a codec that ran. */
    const wasm = []
    page.on('request', (request) => {
      const url = request.url()
      if (!/^https?:/.test(url)) return
      if (url.includes('oxipng')) oxipng.push(url)
      if (new URL(url).pathname.endsWith('.wasm')) wasm.push(url)
      if (!url.startsWith(origin)) foreign.push(url)
      else if (url.includes('/cdn-cgi/')) injected.push(url)
    })

    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))

    const language = batch.language ?? 'es'
    const toolId = batch.tool ?? 'comprimir'
    const common = WORDS[language]
    const words = { ...common, ...common[toolId] }

    await page.goto(new URL(pathOf(language, toolId), base).href)
    // The prerendered screen is usable to look at before the script has mounted.
    await page.waitForSelector('body[data-ready="true"]', { timeout: 30_000 })
    check(
      'the work surface is the first screen',
      await page.getByRole('heading', { level: 1, name: words.heading }).isVisible(),
    )

    const isolated = await page.evaluate(() => globalThis.crossOriginIsolated)
    check('cross-origin isolated', isolated === true)

    if (batch.needsMp4) {
      // H.264 in MP4 is a codec the browser may not ship (Playwright's Chromium
      // and Firefox often lack it): the page's own player is the judge.
      const canPlay = await page.evaluate(() =>
        document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E"'),
      )
      if (canPlay === '') {
        console.log('  SKIPPED this browser cannot play H.264 in MP4 (canPlayType is empty)')
        return
      }
      check('this browser can play H.264 in MP4', true, canPlay)
    }

    if (batch.destination) {
      await page.getByRole('button', { name: words.destination }).click()
      await page.getByRole('button', { name: batch.destination }).click()
      check(
        'the destination switches',
        await page
          .getByRole('button', {
            name: new RegExp(`${words.destination.source}.*${batch.destination.source}`),
          })
          .isVisible(),
      )
    }

    if (batch.format !== undefined) {
      // The converter's picker: its options are the formats themselves.
      await page.getByRole('button', { name: words.destination }).click()
      await page.getByRole('button', { name: batch.format }).click()
      check(
        'the format switches',
        await page
          .getByRole('button', {
            name: new RegExp(`${words.destination.source}.*${batch.format.source.slice(1)}`),
          })
          .isVisible(),
      )
    }

    if (batch.budget !== undefined) {
      await page.getByRole('button', { name: words.destination }).click()
      await page.getByRole('button', { name: batch.budget, exact: true }).click()
      await page.keyboard.press('Escape')
      check(
        'the ceiling is set',
        await page
          .getByRole('button', { name: new RegExp(`${words.destination.source}.*${batch.budget}`) })
          .isVisible(),
      )
    }

    if (batch.video !== undefined) {
      // The Video section of the destination panel, by its labels.
      await page.getByRole('button', { name: words.destination }).click()
      for (const [field, value] of Object.entries(batch.video)) {
        await page.getByLabel(words.fields[field], { exact: true }).fill(value)
      }
      await page.keyboard.press('Escape')
      check(
        'the segment is set in the panel',
        await page.getByRole('button', { name: words.destination }).isVisible(),
      )
    }

    // A batch either names fixture files or builds its own bytes.
    const inputs = batch.inputs?.() ?? batch.files
    const count = inputs.length
    // Files that come out: a batch that includes one that cannot be made ends
    // with fewer than it started with.
    const finished = batch.done ?? count
    const single = finished === 1
    await page.setInputFiles('input[type=file]', inputs)
    await page.getByRole('button', { name: words.start }).click()
    await page.waitForFunction(
      (busy) => !(document.body.textContent ?? '').includes(busy),
      words.busy,
      { timeout: 120_000 },
    )

    // The whole footer, not one element inside it: the count and the saving
    // live in separate lines, and reading only the first one asserts nothing
    // about the number the user came for.
    const summary = (await page.locator('footer').innerText()).replace(/\s+/g, ' ')
    check(
      words.saved === undefined
        ? 'the batch reports what it did'
        : 'the batch reports what it saved',
      summary.includes(words.finished(finished)) &&
        (words.saved === undefined || words.saved.test(summary)),
      summary,
    )

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.getByRole('button', { name: single ? words.single : words.zip }).click(),
    ])

    const archive = join(downloads, download.suggestedFilename())
    await download.saveAs(archive)

    const bytes = await readFile(archive)

    if (single) {
      // One file is handed over as itself: its name and its bytes are the proof.
      check(
        'the one file comes out as itself, not in a ZIP',
        bytes.subarray(0, 4).toString('hex') !== LOCAL_HEADER,
      )
      for (const entry of batch.expected) {
        check(`the download is ${entry}`, download.suggestedFilename() === entry)
      }
      if (batch.verify !== undefined) {
        await batch.verify([{ name: download.suggestedFilename(), data: bytes }], {
          ...batch,
          done: 1,
        })
      }
      if (batch.page !== undefined) await batch.page(page, batch)
      check('nothing threw on the page', errors.length === 0, errors.join('; '))
      check(
        'no byte left the device',
        foreign.length === 0,
        foreign.length === 0 ? '' : foreign.join(', '),
      )
      return
    }
    // latin1 keeps every byte addressable as a character, which is what
    // scanning for the signatures below needs.
    const raw = bytes.toString('latin1')

    check('the archive is a ZIP', bytes.subarray(0, 4).toString('hex') === LOCAL_HEADER)
    check('the archive is complete', raw.includes(END_OF_DIRECTORY))
    check(
      'one entry per file',
      raw.split(CENTRAL_ENTRY).length - 1 === finished,
      `${raw.split(CENTRAL_ENTRY).length - 1} entries`,
    )
    for (const entry of batch.expected) {
      check(`the archive holds ${entry}`, raw.includes(entry))
    }

    if (batch.verify !== undefined) await batch.verify(readZip(bytes), batch)
    if (batch.page !== undefined) await batch.page(page, batch)

    check(
      batch.oxipng ? 'the PNG went through oxipng' : 'oxipng stayed unloaded',
      oxipng.length > 0 === batch.oxipng,
      oxipng.join(', '),
    )
    if (batch.wasm === false) {
      check('no .wasm was requested (nothing was re-encoded)', wasm.length === 0, wasm.join(', '))
    }
    check('nothing threw on the page', errors.length === 0, errors.join('; '))
    check(
      'no byte left the device',
      foreign.length === 0,
      foreign.length === 0 ? '' : foreign.join(', '),
    )

    if (injected.length > 0) {
      // Not a failure: same origin, no image data, and gone the moment the
      // project is self-hosted. Named rather than hidden.
      console.log(`  note the host injected ${injected.length} request(s): ${injected.join(', ')}`)
    }
  } finally {
    await page.close()
  }
}

/**
 * What a reader that never runs JavaScript gets: a crawler, or the bot behind
 * a link preview. Fetched from Node and not from a browser on purpose, because
 * a browser would run the script and hide an empty page behind the live one.
 */
async function runDiscoverability() {
  for (const [language, all] of Object.entries(WORDS)) {
    const words = all.comprimir
    const path = pathOf(language)
    console.log(`\nwithout JavaScript, ${path}: what crawlers and link previews read`)

    const response = await fetch(new URL(path, base))
    const html = await response.text()
    // Attribute by attribute, because a formatter is free to break a tag across
    // lines and to put its attributes in any order.
    const meta = (attribute, name) =>
      [...html.matchAll(/<meta\s([^>]*)>/g)]
        .map(([, attributes]) => attributes)
        .find((attributes) => attributes.includes(`${attribute}="${name}"`))
        ?.match(/content="([^"]*)"/)?.[1]

    check('the page answers', response.ok, `${response.status}`)
    check('the page says its language', html.includes(`<html lang="${language}">`))
    check(
      'the title names the task',
      words.title.test(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? ''),
    )
    check('there is a description', (meta('name', 'description') ?? '').length > 50)
    check(
      'the first screen is in the HTML, not only in the script',
      new RegExp(`<h1[^>]*>[^<]*${words.heading.source}[^<]*</h1>`).test(html),
    )
    check(
      'it points to its other-language twin',
      /hreflang="es"/.test(html) && /hreflang="en"/.test(html),
    )

    const jsonLd = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1]
    let parsed = null
    try {
      parsed = JSON.parse(jsonLd ?? '')
    } catch {
      // Reported by the check below.
    }
    check('the structured data parses', parsed?.['@type'] === 'WebApplication')

    // The preview image is an absolute URL to the live host, so it is checked
    // by its path against the origin under test.
    const image = meta('property', 'og:image')
    check('there is a preview image', image !== undefined)
    if (image !== undefined) {
      const asset = await fetch(new URL(new URL(image).pathname, base))
      check(`${new URL(image).pathname} is served`, asset.ok, `${asset.status}`)
    }
  }

  console.log('\nwhat every page shares')
  for (const path of ['/favicon.svg', '/apple-touch-icon.png', '/robots.txt', '/sitemap.xml']) {
    const asset = await fetch(new URL(path, base))
    check(`${path} is served`, asset.ok, `${asset.status}`)
  }
}

/**
 * Every page the registry lists, read from Node with no JavaScript (D57): its
 * language, its twins and its canonical, and the sitemap that has to list them
 * all. The deep checks above cover the compressor; this one is what stops a
 * new tool from shipping a page that crawlers cannot place.
 */
async function runRegistryPages() {
  console.log('\nevery page of the registry')

  for (const { tool, language, locale } of listPages(REGISTRY)) {
    const response = await fetch(new URL(locale.path, base))
    const html = await response.text()
    const label = `${tool.id} ${language} ${locale.path}`

    check(`${label} answers`, response.ok, `${response.status}`)
    check(`${label} says its language`, html.includes(`<html lang="${language}">`))
    check(`${label} declares its tool`, html.includes(`<body data-tool="${tool.id}">`))
    for (const other of REGISTRY.languages) {
      const href = urlForPath(REGISTRY, tool.locales[other].path)
      check(
        `${label} points to its ${other} twin`,
        html.includes(`hreflang="${other}"`) && html.includes(`href="${href}"`),
      )
    }
    check(
      `${label} is its own canonical`,
      html.includes(`rel="canonical"`) &&
        html.includes(`href="${urlForPath(REGISTRY, locale.path)}"`),
    )
  }

  const sitemap = await (await fetch(new URL('/sitemap.xml', base))).text()
  for (const { tool, language, locale } of listPages(REGISTRY)) {
    check(
      `sitemap.xml lists ${tool.id} ${language}`,
      sitemap.includes(`<loc>${urlForPath(REGISTRY, locale.path)}</loc>`),
    )
  }
}

/*
 * The audit (D60), in two flows against the built page.
 *
 * The first reads a HAR that a real browser recorded: a local server serves a
 * page with a JPEG, a PNG, a WebP, an image used twice, an SVG and a 404, a
 * Playwright context records it with the contents embedded, and that file is
 * the audit's input. The audit page must then measure what is measurable, list
 * the SVG and the 404 with their reasons, ship the right names in the ZIP, and
 * ask the recorded server for nothing at all.
 *
 * The second reads a HAR written by hand with every secret a HAR can carry
 * planted as a sentinel. None of them may reach the page's HTML, the names in
 * the ZIP or the network, and the hosts the HAR names must never be asked for.
 */

const AUDIT_WORDS = {
  es: {
    destinationLabel: 'Mismo formato y tamaño',
    line: (measurable, total) => `${measurable} imágenes medibles de ${total} en el HAR`,
    skippedTitle: (count) => `No medibles: ${count}`,
    unsupported: 'formato que achica no optimiza todavía',
    failed: 'petición fallida',
    noContent: 'sin contenido en el HAR',
    ignored: /peticiones? repetidas? ignoradas?/,
  },
  en: {
    destinationLabel: 'Same format and size',
    line: (measurable, total) => `${measurable} measurable images out of ${total} in the HAR`,
    skippedTitle: (count) => `Not measurable: ${count}`,
    unsupported: 'a format achica does not optimise yet',
    failed: 'failed request',
    noContent: 'no content in the HAR',
    ignored: /repeated requests? ignored/,
  },
}

/** A tiny server that plays the page whose HAR gets recorded, and counts every hit. */
async function startRecordedSite() {
  const files = {
    '/img/photo.jpg': ['image/jpeg', await readFile(fixture('generated/no-exif.jpg'))],
    '/img/logo.png': ['image/png', await readFile(fixture('vendor/pngsuite/basn6a08.png'))],
    '/img/pic.webp': ['image/webp', await readFile(fixture('generated/sample.webp'))],
    '/img/icon.svg': [
      'image/svg+xml',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>'),
    ],
  }
  const page = [
    '<!doctype html><meta charset="utf-8"><title>recorded</title>',
    '<img src="/img/photo.jpg"><img src="/img/photo.jpg"><img src="/img/logo.png">',
    '<img src="/img/pic.webp"><img src="/img/icon.svg"><img src="/img/missing.jpg">',
  ].join('')

  const hits = []
  const server = createServer((request, response) => {
    hits.push(request.url)
    // Every visit refetches, so the same URL can be recorded twice.
    const headers = { 'Cache-Control': 'no-store' }
    const served = files[request.url ?? '']
    if (served !== undefined) {
      response.writeHead(200, { ...headers, 'Content-Type': served[0] })
      response.end(served[1])
    } else if (request.url === '/') {
      response.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8' })
      response.end(page)
    } else {
      // The missing image answers 404 as an image: a browser records the
      // content type the server sent, and a 404 page in HTML is not an image entry.
      response.writeHead(404, { ...headers, 'Content-Type': 'image/jpeg' })
      response.end()
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    origin: `http://127.0.0.1:${port}`,
    hits,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

/** Records the HAR a real browser writes for that page, with the bodies embedded. */
async function recordHar(engine, site, directory) {
  const path = join(directory, 'recorded.har')
  const browser = await engine.launch()
  try {
    const context = await browser.newContext({ recordHar: { path, content: 'embed' } })
    const page = await context.newPage()
    for (let visit = 0; visit < 2; visit += 1) {
      await page.goto(`${site.origin}/`, { waitUntil: 'networkidle' })
    }
    // The HAR is written when the context closes.
    await context.close()
  } finally {
    await browser.close()
  }
  return path
}

/** Watches every request a page makes, and keeps the ones that left its own origin. */
function watchRequests(page) {
  const foreign = []
  const all = []
  page.on('request', (request) => {
    const url = request.url()
    if (!/^https?:/.test(url)) return
    all.push(url)
    if (!url.startsWith(origin)) foreign.push(url)
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  return { foreign, all, errors }
}

/** Opens the audit page, hands it a HAR file and waits for its images to be listed. */
async function loadAuditPage(page, language, harPath, startName) {
  await page.goto(new URL(pathOf(language, 'auditar'), base).href)
  // A file handed to the prerendered input before React mounts is dropped.
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30_000 })
  await page.setInputFiles('input[type=file]', harPath)
  await page.getByRole('button', { name: startName }).waitFor({ timeout: 30_000 })
}

/** Runs the measurement and downloads the ZIP; returns the entries read back from it. */
async function measureAndZip(page, words, count, downloads) {
  await page.getByRole('button', { name: words.start }).click()
  await page.waitForFunction(
    (busy) => !(document.body.textContent ?? '').includes(busy),
    words.busy,
    { timeout: 120_000 },
  )
  const footer = (await page.locator('footer').innerText()).replace(/\s+/g, ' ')
  check('the footer reports the images measured', footer.includes(words.finished(count)), footer)

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByRole('button', { name: words.zip }).click(),
  ])
  const archive = join(downloads, download.suggestedFilename())
  await download.saveAs(archive)
  return { footer, bytes: await readFile(archive) }
}

async function runRecordedHar(engineName, engine, language, downloads) {
  const site = await startRecordedSite()
  const all = WORDS[language]
  const words = { ...all, ...all.auditar }
  const audit = AUDIT_WORDS[language]

  try {
    const harPath = await recordHar(engine, site, downloads)
    const hitsWhileRecording = site.hits.length
    const recorded = JSON.parse(await readFile(harPath, 'utf8'))
    const entries = recorded.log.entries

    // How Playwright writes embedded content: base64 text, with the encoding said.
    const jpegEntry = entries.find((item) => item.request.url.endsWith('/img/photo.jpg'))
    check(
      `${engineName}: Playwright embeds the body as base64 text`,
      jpegEntry?.response.content.encoding === 'base64' &&
        typeof jpegEntry.response.content.text === 'string',
      JSON.stringify({
        encoding: jpegEntry?.response.content.encoding,
        mimeType: jpegEntry?.response.content.mimeType,
      }),
    )
    const svgEntry = entries.find((item) => item.request.url.endsWith('/img/icon.svg'))
    const missingEntry = entries.find((item) => item.request.url.endsWith('/img/missing.jpg'))
    console.log(
      `  note the HAR has ${entries.length} entries; photo.jpg x${entries.filter((item) => item.request.url.endsWith('/photo.jpg')).length}; svg encoding=${svgEntry?.response.content.encoding ?? 'text'} mime=${svgEntry?.response.content.mimeType}; 404 mime=${missingEntry?.response.content.mimeType}`,
    )

    const browser = await engine.launch()
    try {
      const page = await browser.newPage({ acceptDownloads: true })
      const watched = watchRequests(page)

      await loadAuditPage(page, language, harPath, words.start)

      // Measurable: the JPEG, the PNG and the WebP. The repeated one counts once.
      const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
      check(
        'the summary counts 3 measurable images of 5 in the HAR',
        body.includes(audit.line(3, 5)) && body.includes(audit.destinationLabel),
        body.slice(0, 400),
      )
      // The SVG and the 404 are listed, as text, with their reasons.
      await page.getByText(audit.skippedTitle(2)).click()
      const listed = (await page.locator('section').first().innerText()).replace(/\s+/g, ' ')
      check('the repeated request is counted as ignored', audit.ignored.test(listed), listed)

      const svgUrl = `${site.origin}/img/icon.svg`
      const missingUrl = `${site.origin}/img/missing.jpg`
      check('the SVG is listed with its address', listed.includes(svgUrl), listed)
      check('the SVG says why', listed.includes(audit.unsupported), listed)
      check('the 404 is listed with its address', listed.includes(missingUrl), listed)
      check('the 404 says why', listed.includes(audit.failed), listed)

      // Nothing in the page points at the recorded server.
      const pointers = await page.evaluate((host) => {
        const found = []
        for (const element of document.querySelectorAll('*')) {
          for (const attribute of ['href', 'src', 'srcset', 'action']) {
            const value = element.getAttribute(attribute)
            if (value !== null && value.includes(host))
              found.push(`${element.tagName} ${attribute}`)
          }
        }
        return found
      }, new URL(site.origin).host)
      check(
        'no link or picture points at the recorded server',
        pointers.length === 0,
        pointers.join(', '),
      )

      const { bytes } = await measureAndZip(page, words, 3, downloads)
      const names = readZip(bytes)
        .map((entry) => entry.name)
        .toSorted()
      check(
        'the ZIP holds the three measurable images, by their names',
        names.join(',') === 'logo.png,photo.jpg,pic.webp',
        names.join(','),
      )

      check('nothing threw on the page', watched.errors.length === 0, watched.errors.join('; '))
      check(
        'no byte left the device during the audit',
        watched.foreign.length === 0,
        watched.foreign.join(', '),
      )
      check(
        'the recorded server was not asked for anything',
        site.hits.length === hitsWhileRecording,
        site.hits.slice(hitsWhileRecording).join(', '),
      )

      // The control: the same instruments do see a request to that server, so
      // the checks above were able to fail.
      await page.evaluate(
        (url) => fetch(url, { mode: 'no-cors' }).catch(() => undefined),
        `${site.origin}/control`,
      )
      await page.waitForTimeout(300)
      check(
        'control: a request to the recorded server is seen by both instruments',
        watched.foreign.some((url) => url.endsWith('/control')) &&
          site.hits.slice(hitsWhileRecording).includes('/control'),
        `${watched.foreign.join(', ')} | ${site.hits.slice(hitsWhileRecording).join(', ')}`,
      )
      await page.close()
    } finally {
      await browser.close()
    }
  } finally {
    await site.close()
  }
}

const HOSTILE_SENTINELS = {
  query: 'SMOKE_SENTINEL_QUERY_TOKEN',
  user: 'SMOKE_SENTINEL_USER',
  pass: 'SMOKE_SENTINEL_PASS',
  header: 'SMOKE_SENTINEL_AUTH_BEARER',
  cookie: 'SMOKE_SENTINEL_COOKIE_SID',
  fragment: 'SMOKE_SENTINEL_FRAGMENT',
  skipped: 'SMOKE_SENTINEL_SKIPPED',
}

async function runHostileHar(engineName, engine, language, downloads) {
  const all = WORDS[language]
  const words = { ...all, ...all.auditar }
  const audit = AUDIT_WORDS[language]
  const host = 'har-host.smoke.test'
  const secrets = [HOSTILE_SENTINELS.header, HOSTILE_SENTINELS.cookie]

  const jpeg = (await readFile(fixture('generated/no-exif.jpg'))).toString('base64')
  const png = (await readFile(fixture('vendor/pngsuite/basn6a08.png'))).toString('base64')
  const image = (url, mimeType, text) =>
    harEntry({ url, mimeType, text, encoding: 'base64', size: 1_000 }, secrets)

  const document_ = harDocument([
    image(
      `https://${HOSTILE_SENTINELS.user}:${HOSTILE_SENTINELS.pass}@${host}/img/hero.jpg?token=${HOSTILE_SENTINELS.query}#${HOSTILE_SENTINELS.fragment}`,
      'image/jpeg',
      jpeg,
    ),
    image(`https://${host}/img/logo.png?v=${HOSTILE_SENTINELS.query}`, 'image/png', png),
    ...Array.from({ length: 10 }, (_, index) =>
      image(
        `https://${host}/cdn/${index}/thumb.jpg?sig=${HOSTILE_SENTINELS.query}`,
        'image/jpeg',
        jpeg,
      ),
    ),
    harEntry(
      {
        url: `https://${host}/img/icon.svg?x=${HOSTILE_SENTINELS.skipped}`,
        status: 200,
        mimeType: 'image/svg+xml',
        text: '<svg xmlns="http://www.w3.org/2000/svg"/>',
        size: 40,
      },
      secrets,
    ),
    harEntry(
      { url: `https://${host}/img/gone.jpg`, status: 404, mimeType: 'image/jpeg', size: 0 },
      secrets,
    ),
    harEntry(
      { url: `https://${host}/img/bare.webp`, status: 200, mimeType: 'image/webp', size: 5_000 },
      secrets,
    ),
  ])
  const harPath = join(downloads, 'hostile.har')
  await writeFile(harPath, document_)

  const browser = await engine.launch()
  try {
    const page = await browser.newPage({ acceptDownloads: true })
    const watched = watchRequests(page)

    await loadAuditPage(page, language, harPath, words.start)
    check(
      'the 12 images of the hostile HAR are measurable',
      (await page.locator('body').innerText()).replace(/\s+/g, ' ').includes(audit.line(12, 15)),
    )
    await page.getByText(audit.skippedTitle(3)).click()
    const listed = (await page.locator('section').first().innerText()).replace(/\s+/g, ' ')
    check(
      'the three that cannot be measured say why',
      [audit.unsupported, audit.failed, audit.noContent].every((text) => listed.includes(text)),
      listed,
    )

    const { bytes } = await measureAndZip(page, words, 12, downloads)

    const html = await page.content()
    const names = readZip(bytes).map((entry) => entry.name)
    const raw = bytes.toString('latin1')
    for (const [label, sentinel] of Object.entries(HOSTILE_SENTINELS)) {
      check(`the ${label} sentinel is not in the page HTML`, !html.includes(sentinel))
      check(
        `the ${label} sentinel is not in the ZIP`,
        !raw.includes(sentinel) && !names.some((name) => name.includes(sentinel)),
      )
    }
    check(
      'the ZIP has one entry per image, all distinct',
      new Set(names).size === 12 && names.length === 12,
      names.join(','),
    )
    check(
      'no request went to a host of the HAR',
      !watched.all.some((url) => url.includes(host)),
      watched.all.filter((url) => url.includes(host)).join(', '),
    )
    check('no byte left the device', watched.foreign.length === 0, watched.foreign.join(', '))
    check('nothing threw on the page', watched.errors.length === 0, watched.errors.join('; '))
    await page.close()
  } finally {
    await browser.close()
  }
}

try {
  await runDiscoverability()
  await runRegistryPages()

  for (const [name, engine] of [
    ['chromium', chromium],
    ['firefox', firefox],
  ]) {
    const downloads = await mkdtemp(join(tmpdir(), 'achica-smoke-'))
    const browser = await engine.launch()

    try {
      for (const batch of BATCHES) {
        console.log(`\n${name}: ${batch.label}`)
        await runBatch(browser, batch, downloads)
      }

      // Each browser records its own HAR and reads it back, one language each
      // way round, so both pages and both recorders are exercised.
      const [recorded, hostile] = name === 'chromium' ? ['es', 'en'] : ['en', 'es']
      console.log(`\n${name}: audit, from a HAR the browser recorded (${recorded})`)
      await runRecordedHar(name, engine, recorded, downloads)
      console.log(`\n${name}: audit, from a hand-made hostile HAR (${hostile})`)
      await runHostileHar(name, engine, hostile, downloads)
    } finally {
      await browser.close()
      await rm(downloads, { recursive: true, force: true })
    }
  }
} finally {
  await server?.close()
}

if (failed) process.exitCode = 1
