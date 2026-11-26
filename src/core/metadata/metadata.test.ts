import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FIXTURES, ORIENTATION_FIXTURES } from '../../../test/fixtures/paths'
import {
  ALL_GPS_SENTINELS,
  ALL_SENTINELS,
  TEXT_SENTINELS,
  animatedWebp,
  apngFrom,
  ascii,
  cat,
  dirtyJpeg,
  dirtyPng,
  dirtyWebp,
  equalBytes,
  indexOfBytes,
  jpegSegment,
  pngChunk,
  pngChunks,
  riffChunk,
  riffChunks,
  riffFile,
  syntheticProgressiveJpeg,
  vp8xPayload,
  webpWithOrientation,
} from '../../../test/helpers/metadata-builders'
import { processImage } from '../pipeline'
import { toOutputPlan } from '../profiles/types'
import { readExif } from './exif'
import { stripMetadata, type StripOutcome } from './index'

/**
 * The stripper's tests do not trust the stripper.
 *
 * A parser that mis-walks a file would drop the same bytes it fails to report,
 * so asserting on its own report proves nothing. The checks here are raw: a
 * dirty file is assembled with sentinels, and every sentinel is searched for,
 * byte by byte, in the output.
 */

const read = (path: string): Uint8Array => new Uint8Array(readFileSync(path))
const headerFixture = (name: string): string => join(dirname(FIXTURES.sampleWebp), 'headers', name)
const cleanJpeg = read(FIXTURES.noExif)
const cleanPng = read(FIXTURES.rgbaPng)
const cleanWebp = read(FIXTURES.sampleWebp)

function strip(input: Uint8Array): StripOutcome {
  const result = stripMetadata(input)
  if (!result.ok) throw new Error(`unexpected failure: ${JSON.stringify(result.error)}`)
  return result.value
}

function expectNoSentinels(output: Uint8Array, keepExifWord = false): void {
  for (const sentinel of ALL_SENTINELS) {
    expect(
      indexOfBytes(output, sentinel),
      `sentinel survived: ${new TextDecoder().decode(sentinel)}`,
    ).toBe(-1)
  }
  // Belt and braces: the identifying words, whatever the exact bytes around them.
  for (const word of [
    'SENTINEL',
    ...(keepExifWord ? [] : ['Exif']),
    'xmpmeta',
    'MPF',
    'Photoshop',
    'JFXX',
  ]) {
    expect(indexOfBytes(output, ascii(word)), `"${word}" survived`).toBe(-1)
  }
}

/** The sentinels must really be in the dirty file, or the raw search proves nothing. */
function expectPlanted(dirty: Uint8Array, keys: (keyof typeof TEXT_SENTINELS)[]): void {
  for (const key of keys)
    expect(indexOfBytes(dirty, ascii(TEXT_SENTINELS[key])), key).toBeGreaterThan(-1)
  for (const gps of ALL_GPS_SENTINELS) expect(indexOfBytes(dirty, gps), 'gps').toBeGreaterThan(-1)
}

describe('fixtures are what the tests assume', () => {
  it('the clean files carry no sentinel and are already minimal', () => {
    for (const clean of [cleanJpeg, cleanPng, cleanWebp]) {
      expectNoSentinels(clean)
      const out = strip(clean)
      expect(equalBytes(out.bytes, clean)).toBe(true)
      expect(out.removed.kinds).toEqual([])
      expect(out.removed.bytesRemoved).toBe(0)
    }
  })
})

describe('A. sentinels do not survive', () => {
  it('JPEG: EXIF, GPS, thumbnails, XMP, COM, IPTC, MPF and trailing data are all gone', () => {
    const dirty = dirtyJpeg(cleanJpeg)
    // The sentinels really are in the dirty file, or the test proves nothing.
    expectPlanted(dirty, [
      'make',
      'model',
      'xmp',
      'comment',
      'iptc',
      'mpf',
      'exifThumb',
      'jfifThumb',
      'jfxx',
      'tail',
      'other',
    ])

    const out = strip(dirty)

    expectNoSentinels(out.bytes)
    // Stronger than "no sentinel": the output IS the clean file, byte for byte.
    expect(equalBytes(out.bytes, cleanJpeg)).toBe(true)

    expect(out.format).toBe('jpeg')
    expect(out.removed.kinds).toEqual(
      expect.arrayContaining([
        'exif',
        'xmp',
        'iptc',
        'comment',
        'thumbnail',
        'mpf',
        'trailing-data',
        'other',
      ]),
    )
    expect(out.removed.hadGps).toBe(true)
    expect(out.removed.hadCameraInfo).toBe(true)
    expect(out.removed.exifUnreadable).toBe(false)
    expect(out.removed.orientation).toBeNull()
    expect(out.removed.trailingBytes).toBe(TEXT_SENTINELS.tail.length + 5)
    expect(out.removed.bytesRemoved).toBe(dirty.length - out.bytes.length)
  })

  it('JPEG: the walker finds the real EOI, not the FFD9 inside the EXIF thumbnail', () => {
    const dirty = dirtyJpeg(cleanJpeg, { tail: false })
    // The thumbnail's FFD9 comes first in the file.
    const firstEoi = indexOfBytes(dirty, new Uint8Array([0xff, 0xd9]))
    expect(firstEoi).toBeLessThan(dirty.length - 10)

    const out = strip(dirty)

    expect(equalBytes(out.bytes, cleanJpeg)).toBe(true)
    expect(out.removed.trailingBytes).toBe(0)
  })

  it('PNG: tEXt, iTXt XMP, eXIf, tIME, private chunks and trailing data are all gone', () => {
    const dirty = dirtyPng(cleanPng)
    expectPlanted(dirty, [
      'make',
      'model',
      'xmp',
      'comment',
      'exifThumb',
      'png',
      'pngPrivate',
      'pngTime',
      'tail',
    ])

    const out = strip(dirty)

    expectNoSentinels(out.bytes)
    expect(equalBytes(out.bytes, cleanPng)).toBe(true)
    expect(out.format).toBe('png')
    expect(out.removed.kinds).toEqual(
      expect.arrayContaining(['exif', 'xmp', 'png-text', 'png-time', 'trailing-data', 'other']),
    )
    expect(out.removed.hadGps).toBe(true)
    expect(out.removed.hadCameraInfo).toBe(true)
    expect(out.removed.trailingBytes).toBe(TEXT_SENTINELS.tail.length)
    expect(out.removed.bytesRemoved).toBe(dirty.length - out.bytes.length)
    expect(out.width).toBe(32)
    expect(out.height).toBe(32)
  })

  it('WebP: EXIF, XMP, unknown chunks, the VP8X flags and trailing data are all gone', () => {
    const dirty = dirtyWebp(cleanWebp)
    expectPlanted(dirty, ['make', 'model', 'xmp', 'exifThumb', 'other', 'tail'])
    // The dirty file announces both blocks in VP8X.
    expect(riffChunks(dirty)[0]?.payload[0]).toBe(0x20 | 0x08 | 0x04)

    const out = strip(dirty)

    expectNoSentinels(out.bytes)
    expect(equalBytes(out.bytes, cleanWebp)).toBe(true)
    expect(riffChunks(out.bytes)[0]?.payload[0]).toBe(0x20) // only the ICC flag remains
    expect(out.format).toBe('webp')
    expect(out.removed.kinds).toEqual(
      expect.arrayContaining(['exif', 'xmp', 'trailing-data', 'other']),
    )
    expect(out.removed.hadGps).toBe(true)
    expect(out.removed.hadCameraInfo).toBe(true)
    expect(out.removed.trailingBytes).toBe(TEXT_SENTINELS.tail.length)
    expect(out.removed.bytesRemoved).toBe(dirty.length - out.bytes.length)
    expect(out.width).toBe(64)
    expect(out.height).toBe(32)
  })

  it('does not claim GPS when the tag exists but its directory is empty', () => {
    // Build a TIFF whose GPS pointer targets an IFD with zero entries.
    const tiff = cat(
      ascii('II'),
      new Uint8Array([42, 0, 8, 0, 0, 0]),
      new Uint8Array([1, 0]), // one entry
      new Uint8Array([0x25, 0x88, 4, 0, 1, 0, 0, 0, 26, 0, 0, 0]), // GPS pointer -> 26
      new Uint8Array([0, 0, 0, 0]), // next IFD
      new Uint8Array([0, 0, 0, 0]), // GPS IFD with count 0
    )
    expect(readExif(tiff).hadGps).toBe(false)
    expect(readExif(tiff).readable).toBe(true)
  })
})

describe('JPEG details', () => {
  it('rewrites a JFIF thumbnail to the bare 16-byte segment', () => {
    const out = strip(dirtyJpeg(cleanJpeg, { tail: false }))
    expect(out.bytes.subarray(2, 20)).toEqual(cleanJpeg.subarray(2, 20))
    expect(out.removed.kinds).toContain('thumbnail')
  })

  it('keeps APP2 ICC and APP14 Adobe, drops an APP2 that is not ICC', () => {
    const adobe = jpegSegment(0xee, cat(ascii('Adobe'), new Uint8Array([0, 100, 0, 0, 0, 0, 1])))
    const dirty = cat(
      cleanJpeg.subarray(0, 20),
      adobe,
      jpegSegment(0xe2, ascii('FPXR\0 something')),
      cleanJpeg.subarray(20),
    )
    const out = strip(dirty)
    expect(indexOfBytes(out.bytes, ascii('Adobe'))).toBeGreaterThan(-1)
    expect(indexOfBytes(out.bytes, ascii('ICC_PROFILE\0'))).toBeGreaterThan(-1)
    expect(indexOfBytes(out.bytes, ascii('FPXR'))).toBe(-1)
  })

  it('drops an APP1 that is neither EXIF nor XMP, and an unreadable EXIF is reported', () => {
    const garbage = jpegSegment(0xe1, cat(ascii('Exif\0\0'), ascii('not a tiff block at all')))
    const out = strip(cat(cleanJpeg.subarray(0, 20), garbage, cleanJpeg.subarray(20)))
    expect(equalBytes(out.bytes, cleanJpeg)).toBe(true)
    expect(out.removed.exifUnreadable).toBe(true)
    expect(out.removed.orientation).toBeNull()
  })

  it('reports image dimensions straight from SOF, without applying orientation', () => {
    const rotated = strip(read(ORIENTATION_FIXTURES[6] ?? ''))
    expect(rotated.width).toBe(64)
    expect(rotated.height).toBe(32)
  })
})

describe('F. JPEG scan walking', () => {
  const stuffed = new Uint8Array([0x12, 0xff, 0x00, 0x34, 0xff, 0x00, 0xd9, 0x56])
  const withRestarts = new Uint8Array([0x01, 0xff, 0xd0, 0x02, 0xff, 0xd7, 0x03, 0xff])

  it('keeps stuffed bytes, restart markers and fill bytes inside a scan', () => {
    const jpeg = syntheticProgressiveJpeg([{ entropy: stuffed }, { entropy: withRestarts }])
    const out = strip(jpeg)
    expect(equalBytes(out.bytes, jpeg)).toBe(true)
    expect(out.removed.kinds).toEqual([])
  })

  it('walks several scans, removing what sits between them and after the EOI', () => {
    const comment = jpegSegment(0xfe, ascii(TEXT_SENTINELS.comment))
    const app1 = jpegSegment(0xe1, cat(ascii('Exif\0\0'), new Uint8Array([0xff, 0xd9, 0xff, 0xd9])))
    const clean = syntheticProgressiveJpeg([
      { entropy: stuffed },
      { entropy: withRestarts },
      { entropy: stuffed },
    ])
    const dirty = cat(
      syntheticProgressiveJpeg([
        { entropy: stuffed, after: [comment] },
        { entropy: withRestarts, after: [app1] },
        { entropy: stuffed },
      ]),
      ascii('tail'),
    )

    const out = strip(dirty)

    expect(equalBytes(out.bytes, clean)).toBe(true)
    expect(out.removed.kinds).toEqual(expect.arrayContaining(['comment', 'exif', 'trailing-data']))
  })

  it('is a fixed point on a scan that ends exactly at the EOI', () => {
    const jpeg = syntheticProgressiveJpeg([{ entropy: new Uint8Array([0x7f]) }])
    expect(equalBytes(strip(jpeg).bytes, jpeg)).toBe(true)
  })
})

describe('orientation is kept by writing a new minimal block', () => {
  for (const orientation of [2, 3, 4, 5, 6, 7, 8]) {
    it(`JPEG ${orientation}: a dirty file strips to the generated fixture byte for byte`, () => {
      const out = strip(dirtyJpeg(cleanJpeg, { orientation }))
      expect(equalBytes(out.bytes, read(ORIENTATION_FIXTURES[orientation] ?? ''))).toBe(true)
      expect(out.removed.orientation).toBe(orientation)
      expectNoSentinels(out.bytes, true)
    })
  }

  it('orientation 1 and an absent orientation write nothing', () => {
    const one = strip(dirtyJpeg(cleanJpeg, { orientation: 1 }))
    expect(equalBytes(one.bytes, cleanJpeg)).toBe(true)
    expect(one.removed.orientation).toBeNull()
    expect(indexOfBytes(one.bytes, ascii('Exif'))).toBe(-1)

    const fixture = read(ORIENTATION_FIXTURES[1] ?? '')
    const result = strip(fixture)
    expect(indexOfBytes(result.bytes, ascii('Exif'))).toBe(-1)
    expect(result.removed.orientation).toBeNull()
  })

  it('a file whose only metadata is the minimal orientation block comes back unchanged and reports nothing removed', () => {
    for (let orientation = 2; orientation <= 8; orientation += 1) {
      const fixture = read(ORIENTATION_FIXTURES[orientation] ?? '')
      const out = strip(fixture)
      expect(equalBytes(out.bytes, fixture)).toBe(true)
      expect(out.removed.kinds).toEqual([])
      expect(out.removed.bytesRemoved).toBe(0)
      expect(out.removed.orientation).toBe(orientation)
    }
  })

  it('PNG and WebP carry the orientation in a fresh eXIf / EXIF chunk', () => {
    const png = strip(dirtyPng(cleanPng, { orientation: 6 }))
    const pngTypes = pngChunks(png.bytes).map((chunk) => chunk.type)
    expect(pngTypes.filter((type) => type === 'eXIf')).toHaveLength(1)
    expect(pngTypes[1]).toBe('eXIf') // right after IHDR
    expect(png.removed.orientation).toBe(6)
    expectNoSentinels(png.bytes)

    const webp = strip(dirtyWebp(cleanWebp, { orientation: 8 }))
    const types = riffChunks(webp.bytes).map((chunk) => chunk.type)
    expect(types.filter((type) => type === 'EXIF')).toHaveLength(1)
    expect(riffChunks(webp.bytes)[0]?.payload[0]).toBe(0x20 | 0x08)
    expect(webp.removed.orientation).toBe(8)
    expectNoSentinels(webp.bytes)
    // The EXIF chunk holds the TIFF without the Exif\0\0 prefix.
    const exif = riffChunks(webp.bytes).find((chunk) => chunk.type === 'EXIF')
    expect(readExif(exif?.payload ?? new Uint8Array(0)).orientation).toBe(8)
  })

  it('the kept orientation reads back as the original', () => {
    for (const make of [
      (o: number) => dirtyPng(cleanPng, { orientation: o }),
      (o: number) => dirtyWebp(cleanWebp, { orientation: o }),
      (o: number) => dirtyJpeg(cleanJpeg, { orientation: o }),
    ]) {
      const first = strip(make(5))
      const second = strip(first.bytes)
      expect(second.removed.orientation).toBe(5)
      expect(equalBytes(second.bytes, first.bytes)).toBe(true)
    }
  })
})

describe('C. idempotence', () => {
  const dirties: [string, Uint8Array][] = [
    ['jpeg', dirtyJpeg(cleanJpeg, { orientation: 3 })],
    ['png', dirtyPng(cleanPng, { orientation: 3 })],
    ['webp', dirtyWebp(cleanWebp, { orientation: 3 })],
    ['jpeg without orientation', dirtyJpeg(cleanJpeg)],
    ['png without orientation', dirtyPng(cleanPng)],
    ['webp without orientation', dirtyWebp(cleanWebp)],
    ['apng', dirtyPng(apngFrom(cleanPng))],
  ]

  it.each(dirties)(
    '%s: stripping twice equals stripping once, and the second pass removes nothing',
    (_name, dirty) => {
      const once = strip(dirty)
      const twice = strip(once.bytes)
      expect(equalBytes(twice.bytes, once.bytes)).toBe(true)
      expect(twice.removed.kinds).toEqual([])
      expect(twice.removed.bytesRemoved).toBe(0)
    },
  )

  it('the output is a copy, never the input buffer', () => {
    const out = strip(cleanJpeg)
    expect(out.bytes).not.toBe(cleanJpeg)
    expect(out.bytes.buffer).not.toBe(cleanJpeg.buffer)
  })
})

describe('animation survives', () => {
  it('APNG keeps acTL, fcTL and fdAT byte for byte', () => {
    const apng = apngFrom(cleanPng)
    const dirty = dirtyPng(apng)
    const out = strip(dirty)

    expect(equalBytes(out.bytes, apng)).toBe(true)
    const types = pngChunks(out.bytes).map((chunk) => chunk.type)
    expect(types).toEqual(['IHDR', 'acTL', 'fcTL', 'IDAT', 'fcTL', 'fdAT', 'IEND'])
  })

  it('animated WebP keeps ANIM and every ANMF whole, and clears the metadata flags', () => {
    const frame = riffChunks(cleanWebp).find((chunk) => chunk.type === 'VP8 ')
    if (frame === undefined) throw new Error('sample.webp has no VP8 chunk')
    const animated = animatedWebp(frame.bytes, 64, 32)
    const before = riffChunks(animated)

    const out = strip(animated)

    const after = riffChunks(out.bytes)
    expect(after.map((chunk) => chunk.type)).toEqual(['VP8X', 'ANIM', 'ANMF', 'ANMF'])
    for (const type of ['ANIM', 'ANMF']) {
      const original = before.filter((chunk) => chunk.type === type)
      const kept = after.filter((chunk) => chunk.type === type)
      expect(kept.map((chunk) => [...chunk.bytes])).toEqual(
        original.map((chunk) => [...chunk.bytes]),
      )
    }
    expect(after[0]?.payload[0]).toBe(0x02)
    expectNoSentinels(out.bytes)
    expect(out.width).toBe(64)
    expect(out.height).toBe(32)
  })
})

describe('WebP details', () => {
  it('reads dimensions of a bare VP8 file and of VP8L', () => {
    const vp8 = riffChunks(cleanWebp).find((chunk) => chunk.type === 'VP8 ')
    if (vp8 === undefined) throw new Error('no VP8 chunk')
    const plain = riffFile([vp8.bytes])
    const out = strip(plain)
    expect(equalBytes(out.bytes, plain)).toBe(true)
    expect([out.width, out.height]).toEqual([64, 32])

    // VP8L: signature 0x2f, then 14 bits of width-1 and 14 of height-1.
    const bits = (40 - 1) | ((20 - 1) << 14)
    const vp8l = riffChunk(
      'VP8L',
      new Uint8Array([
        0x2f,
        bits & 255,
        (bits >> 8) & 255,
        (bits >> 16) & 255,
        (bits >> 24) & 255,
        0,
      ]),
    )
    const lossless = strip(riffFile([vp8l]))
    expect([lossless.width, lossless.height]).toEqual([40, 20])
  })

  it('a plain (non-extended) file with a stray EXIF chunk is cleaned and the orientation is not carried', () => {
    const vp8 = riffChunks(cleanWebp).find((chunk) => chunk.type === 'VP8 ')
    if (vp8 === undefined) throw new Error('no VP8 chunk')
    const stray = riffFile([
      vp8.bytes,
      riffChunk('EXIF', cat(ascii('II'), new Uint8Array([42, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0]))),
    ])
    const out = strip(stray)
    expect(riffChunks(out.bytes).map((chunk) => chunk.type)).toEqual(['VP8 '])
    expect(out.removed.kinds).toContain('exif')
  })

  it('an orientation-only EXIF is already minimal apart from byte layout, so it is rewritten and idempotent', () => {
    const withOrientation = webpWithOrientation(cleanWebp, 6)
    const once = strip(withOrientation)
    expect(equalBytes(strip(once.bytes).bytes, once.bytes)).toBe(true)
    expect(once.removed.orientation).toBe(6)
  })
})

describe('D. hostile input never throws and always ends', () => {
  const noThrow = (input: Uint8Array): ReturnType<typeof stripMetadata> => {
    let result: ReturnType<typeof stripMetadata> | undefined
    expect(() => {
      result = stripMetadata(input)
    }).not.toThrow()
    if (result === undefined) throw new Error('no result')
    return result
  }

  const expectCorrupt = (input: Uint8Array, format: 'jpeg' | 'png' | 'webp'): string => {
    const result = noThrow(input)
    expect(result.ok).toBe(false)
    if (result.ok) return ''
    expect(result.error.code).toBe('corrupt')
    if (result.error.code !== 'corrupt') return ''
    expect(result.error.format).toBe(format)
    expect(result.error.detail).not.toMatch(/^internal/)
    expect(result.error.detail.length).toBeGreaterThan(5)
    return result.error.detail
  }

  it('truncated.jpg is a corrupt JPEG', () => {
    expectCorrupt(read(FIXTURES.truncatedJpeg), 'jpeg')
  })

  it('empty.jpg is an empty-file detection error', () => {
    const result = noThrow(read(FIXTURES.emptyFile))
    expect(result).toEqual({ ok: false, error: { code: 'empty-file' } })
  })

  it('JPEG segments of length 0 and 1', () => {
    const base = cleanJpeg.subarray(0, 2)
    expect(
      expectCorrupt(cat(base, new Uint8Array([0xff, 0xe1, 0x00, 0x00, 1, 2, 3, 4])), 'jpeg'),
    ).toMatch(/length 0/)
    expect(
      expectCorrupt(cat(base, new Uint8Array([0xff, 0xe1, 0x00, 0x01, 1, 2, 3, 4])), 'jpeg'),
    ).toMatch(/length 1/)
  })

  it('a JPEG segment longer than the file, and a file that ends inside a marker', () => {
    expectCorrupt(
      cat(cleanJpeg.subarray(0, 2), new Uint8Array([0xff, 0xe1, 0xff, 0xff, 1, 2])),
      'jpeg',
    )
    expectCorrupt(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff]), 'jpeg')
    expectCorrupt(new Uint8Array([0xff, 0xd8, 0xff]), 'jpeg')
  })

  it('a JPEG with a stray non-marker byte, with no EOI, or with no scan', () => {
    expectCorrupt(cat(cleanJpeg.subarray(0, 20), new Uint8Array([0x41, 0x42, 0x43])), 'jpeg')
    expectCorrupt(cleanJpeg.subarray(0, cleanJpeg.length - 2), 'jpeg')
    expectCorrupt(
      cat(
        new Uint8Array([0xff, 0xd8]),
        jpegSegment(0xfe, ascii('hi')),
        new Uint8Array([0xff, 0xd9]),
      ),
      'jpeg',
    )
  })

  it('random data behind a JPEG header', () => {
    let seed = 12345
    const next = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed >>> 24
    }
    for (let round = 0; round < 200; round += 1) {
      const noise = new Uint8Array(3 + (next() % 200))
      for (let index = 3; index < noise.length; index += 1) noise[index] = next()
      noise.set([0xff, 0xd8, 0xff])
      const result = noThrow(noise)
      if (!result.ok && result.error.code === 'corrupt') {
        expect(result.error.detail).not.toMatch(/^internal/)
      }
    }
    const fixed = new Uint8Array(64).fill(0x5a)
    fixed.set([0xff, 0xd8, 0xff])
    expectCorrupt(fixed, 'jpeg')
  })

  it('a PNG chunk longer than the file, a cut header, no IEND and no IHDR', () => {
    const chunks = pngChunks(cleanPng)
    const signature = cleanPng.subarray(0, 8)
    const ihdr = chunks[0]?.bytes ?? new Uint8Array(0)
    const huge = cat(
      signature,
      ihdr,
      new Uint8Array([0xff, 0xff, 0xff, 0xff]),
      ascii('IDAT'),
      new Uint8Array(8),
    )
    expect(expectCorrupt(huge, 'png')).toMatch(/longer than the file/)
    expectCorrupt(cleanPng.subarray(0, cleanPng.length - 5), 'png')
    expectCorrupt(cleanPng.subarray(0, 8 + 13 + 12 + 5), 'png')
    expectCorrupt(
      cat(signature, pngChunk('IDAT', new Uint8Array(3)), pngChunk('IEND', new Uint8Array(0))),
      'png',
    )
    expectCorrupt(
      cat(signature, pngChunk('IHDR', new Uint8Array(5)), pngChunk('IEND', new Uint8Array(0))),
      'png',
    )
  })

  it('a RIFF larger than the file, a cut VP8X, and cut ANMF chunks', () => {
    const bigger = cleanWebp.slice()
    new DataView(bigger.buffer).setUint32(4, cleanWebp.length + 100, true)
    expect(expectCorrupt(bigger, 'webp')).toMatch(/larger than the file/)

    const cutVp8x = riffFile([riffChunk('VP8X', new Uint8Array(4))])
    expect(expectCorrupt(cutVp8x, 'webp')).toMatch(/VP8X/)

    const vp8 = riffChunks(cleanWebp).find((chunk) => chunk.type === 'VP8 ')
    if (vp8 === undefined) throw new Error('no VP8 chunk')
    const animated = animatedWebp(vp8.bytes, 64, 32)
    // ANMF whose declared size runs past the RIFF end.
    const firstAnmf = riffChunks(animated).findIndex((chunk) => chunk.type === 'ANMF')
    expect(firstAnmf).toBeGreaterThan(0)
    expectCorrupt(animated.subarray(0, 12 + 18 + 14 + 30), 'webp')

    // ANMF smaller than its fixed header.
    expectCorrupt(
      riffFile([riffChunk('VP8X', vp8xPayload(0x02, 4, 4)), riffChunk('ANMF', new Uint8Array(6))]),
      'webp',
    )

    // ANMF whose sub-chunk claims more than the frame holds.
    const lying = riffChunk(
      'ANMF',
      cat(new Uint8Array(16), ascii('VP8 '), new Uint8Array([0xff, 0, 0, 0]), new Uint8Array(4)),
    )
    expectCorrupt(riffFile([riffChunk('VP8X', vp8xPayload(0x02, 4, 4)), lying]), 'webp')

    // No image chunk at all.
    expectCorrupt(riffFile([riffChunk('VP8X', vp8xPayload(0, 4, 4))]), 'webp')
  })

  it('every truncation of every dirty file ends with a typed result and never throws', () => {
    const files = [
      dirtyJpeg(cleanJpeg, { orientation: 6 }),
      dirtyPng(cleanPng, { orientation: 6 }),
      dirtyWebp(cleanWebp, { orientation: 6 }),
    ]
    for (const file of files) {
      for (let length = 0; length < file.length; length += 1) {
        const result = noThrow(file.subarray(0, length))
        if (!result.ok && result.error.code === 'corrupt') {
          expect(result.error.detail).not.toMatch(/^internal/)
        }
      }
    }
  })

  it('random byte mutations never throw, and what succeeds is stable', () => {
    let seed = 987654321
    const next = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed
    }
    const originals = [
      dirtyJpeg(cleanJpeg, { orientation: 6 }),
      dirtyPng(cleanPng, { orientation: 6 }),
      dirtyWebp(cleanWebp, { orientation: 6 }),
      syntheticProgressiveJpeg([
        { entropy: new Uint8Array([1, 0xff, 0, 2, 0xff, 0xd0]) },
        { entropy: new Uint8Array([3]) },
      ]),
    ]
    for (const original of originals) {
      for (let round = 0; round < 400; round += 1) {
        const mutated = original.slice()
        const edits = 1 + (next() % 4)
        for (let edit = 0; edit < edits; edit += 1) {
          mutated[next() % mutated.length] = next() >>> 24
        }
        const result = noThrow(mutated)
        if (!result.ok) {
          if (result.error.code === 'corrupt') expect(result.error.detail).not.toMatch(/^internal/)
          continue
        }
        const again = strip(result.value.bytes)
        expect(equalBytes(again.bytes, result.value.bytes)).toBe(true)
      }
    }
  })

  it('a hostile EXIF cannot make the reader loop or read out of bounds', () => {
    // IFD0 claims 65535 entries, its next pointer points at itself.
    const loop = cat(
      ascii('II'),
      new Uint8Array([42, 0, 8, 0, 0, 0, 0xff, 0xff]),
      new Uint8Array(40),
    )
    expect(() => readExif(loop)).not.toThrow()
    const selfPointing = cat(ascii('MM'), new Uint8Array([0, 42, 0, 0, 0, 8, 0, 0, 0, 0, 0, 8]))
    expect(() => readExif(selfPointing)).not.toThrow()
    expect(readExif(new Uint8Array(3)).readable).toBe(false)
  })
})

describe('E. formats it will not clean', () => {
  it('AVIF is refused with a typed error, never recompressed', () => {
    const header = read(headerFixture('avif.bin'))
    const result = stripMetadata(header)
    expect(result).toEqual({ ok: false, error: { code: 'strip-unsupported', format: 'avif' } })
  })

  it('other formats keep their detection errors', () => {
    expect(stripMetadata(new Uint8Array(0))).toEqual({ ok: false, error: { code: 'empty-file' } })
    const heic = stripMetadata(read(headerFixture('heic.bin')))
    expect(heic).toEqual({ ok: false, error: { code: 'unsupported-format', format: 'heic' } })
    const junk = stripMetadata(new Uint8Array([1, 2, 3, 4, 5]))
    expect(junk.ok).toBe(false)
    if (!junk.ok) expect(junk.error.code).toBe('unknown-format')
  })
})

describe('pipeline integration (stripOnly)', () => {
  it('returns a coherent outcome without decoding or encoding anything', async () => {
    const dirty = dirtyJpeg(cleanJpeg, { orientation: 6 })
    const result = await processImage(dirty.buffer, { format: 'keep', stripOnly: true })
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    const outcome = result.value

    expect(outcome.format).toBe('jpeg')
    expect(outcome.encodes).toBe(0)
    expect(outcome.quality).toBeNull()
    expect(outcome.withinBudget).toBe(true)
    expect(outcome.shrunkForBudget).toBeNull()
    expect(outcome.convertedForBudget).toBe(false)
    expect([outcome.width, outcome.height]).toEqual([64, 32])
    expect(outcome.bytesBefore).toBe(dirty.length)
    expect(outcome.bytesAfter).toBe(outcome.output.length)
    expect(outcome.metadata?.hadGps).toBe(true)
    expect(outcome.metadata?.orientation).toBe(6)
  })

  it('reports detection, unsupported and corrupt errors through PipelineError', async () => {
    const avif = new Uint8Array(readFileSync(headerFixture('avif.bin')))
    expect(await processImage(avif.buffer, { format: 'keep', stripOnly: true })).toEqual({
      ok: false,
      error: { code: 'strip-unsupported', format: 'avif' },
    })
    const cut = await processImage(read(FIXTURES.truncatedJpeg).slice().buffer, {
      format: 'keep',
      stripOnly: true,
    })
    expect(cut.ok === false && cut.error.code).toBe('corrupt')
  })

  it('a profile with stripOnly reaches the plan', () => {
    const plan = toOutputPlan({
      id: 'x',
      label: 'x',
      group: 'Metadatos',
      format: 'keep',
      stripMetadata: true,
      stripOnly: true,
    })
    expect(plan.stripOnly).toBe(true)
  })
})
