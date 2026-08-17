import { readFile, stat } from 'node:fs/promises'
import { crc32 } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { CORRUPT_FIXTURES, FIXTURES, ORIENTATION_FIXTURES } from './fixtures/paths'

/**
 * Guards the fixture corpus itself.
 *
 * A missing or silently regenerated fixture makes downstream tests pass for
 * the wrong reason, which is worse than a red suite. These checks are cheap
 * and they fail loudly.
 */

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff])
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

async function read(path: string): Promise<Buffer> {
  return readFile(path)
}

describe('fixture corpus', () => {
  it('has every orientation from 1 to 8', async () => {
    const entries = Object.entries(ORIENTATION_FIXTURES)
    expect(entries).toHaveLength(8)

    for (const [, path] of entries) {
      const bytes = await read(path)
      expect(bytes.subarray(0, 3)).toEqual(JPEG_MAGIC)
    }
  })

  it('carries exactly one EXIF segment per orientation fixture', async () => {
    // The APP1 segment we inject is a fixed size, so every oriented file is
    // the same amount larger than the EXIF-free control. This catches a
    // regeneration that quietly dropped the metadata, without duplicating the
    // EXIF parser that core/ will own.
    const control = await read(FIXTURES.noExif)
    const APP1_SEGMENT_BYTES = 36

    for (const path of Object.values(ORIENTATION_FIXTURES)) {
      const bytes = await read(path)
      expect(bytes.length - control.length).toBe(APP1_SEGMENT_BYTES)
      expect(bytes.includes(Buffer.from('Exif\0\0', 'latin1'))).toBe(true)
    }

    expect(control.includes(Buffer.from('Exif\0\0', 'latin1'))).toBe(false)
  })

  it('gives each orientation distinct bytes', async () => {
    const contents = await Promise.all(Object.values(ORIENTATION_FIXTURES).map(read))
    const distinct = new Set(contents.map((buffer) => buffer.toString('base64')))

    expect(distinct.size).toBe(8)
  })

  it('keeps the disguised PNG a real PNG despite its extension', async () => {
    const bytes = await read(FIXTURES.pngDisguisedAsJpeg)

    expect(FIXTURES.pngDisguisedAsJpeg.endsWith('.jpg')).toBe(true)
    expect(bytes.subarray(0, 8)).toEqual(PNG_MAGIC)
  })

  it('has a truncated JPEG that starts valid and ends early', async () => {
    const truncated = await read(FIXTURES.truncatedJpeg)
    const whole = await read(FIXTURES.noExif)

    expect(truncated.subarray(0, 3)).toEqual(JPEG_MAGIC)
    expect(truncated.length).toBeLessThan(whole.length)
    // A complete JPEG ends with EOI. This one must not.
    expect(truncated.subarray(-2)).not.toEqual(Buffer.from([0xff, 0xd9]))
  })

  it('has an empty file that is actually empty', async () => {
    expect((await stat(FIXTURES.emptyFile)).size).toBe(0)
  })

  it('has valid PNGs for the transparency and structure cases', async () => {
    const paths = [
      FIXTURES.rgbaPng,
      FIXTURES.truecolorWithTrns,
      FIXTURES.paletteWithTransparency,
      FIXTURES.sixteenBitPng,
      FIXTURES.interlacedPng,
    ]

    for (const path of paths) {
      const bytes = await read(path)
      expect(bytes.subarray(0, 8)).toEqual(PNG_MAGIC)
    }
  })

  it('has real camera JPEGs alongside the synthetic ones', async () => {
    for (const path of [FIXTURES.cameraLandscape, FIXTURES.cameraPortrait]) {
      const bytes = await read(path)
      expect(bytes.subarray(0, 3)).toEqual(JPEG_MAGIC)
      expect(bytes.includes(Buffer.from('Exif\0\0', 'latin1'))).toBe(true)
    }
  })

  it('keeps every corrupt fixture corrupt, and every valid one valid', async () => {
    expect(CORRUPT_FIXTURES).toHaveLength(6)

    // The same validator judges both groups. Running it only against the
    // corrupt files would prove nothing: a validator that rejects everything
    // would pass. The valid group is what gives the corrupt group meaning.
    for (const { path, defect } of CORRUPT_FIXTURES) {
      expect(findPngDefect(await read(path)), `${path} should be corrupt: ${defect}`).not.toBeNull()
    }

    const valid = [
      FIXTURES.rgbaPng,
      FIXTURES.truecolorWithTrns,
      FIXTURES.paletteWithTransparency,
      FIXTURES.sixteenBitPng,
      FIXTURES.interlacedPng,
    ]

    for (const path of valid) {
      expect(findPngDefect(await read(path)), `${path} should be intact`).toBeNull()
    }
  })
})

/**
 * Minimal PNG structural check: signature, chunk CRCs, IHDR field ranges and
 * the presence of image data. Test-only and deliberately not a decoder — it
 * exists to prove the corpus is what its README claims, nothing more.
 *
 * Returns the first defect found, or null when the file is structurally sound.
 */
function findPngDefect(bytes: Buffer): string | null {
  if (!bytes.subarray(0, 8).equals(PNG_MAGIC)) return 'broken signature'

  const chunks: string[] = []
  let at = 8

  while (at + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(at)
    const type = bytes.toString('latin1', at + 4, at + 8)
    const end = at + 8 + length

    if (end + 4 > bytes.length) return `chunk ${type} truncated`
    if (crc32(bytes.subarray(at + 4, end)) !== bytes.readUInt32BE(end)) return `bad CRC in ${type}`

    if (type === 'IHDR') {
      const depth = bytes[at + 16]
      const colourType = bytes[at + 17]
      if (depth === undefined || ![1, 2, 4, 8, 16].includes(depth)) return `bit depth ${depth}`
      if (colourType === undefined || ![0, 2, 3, 4, 6].includes(colourType)) {
        return `colour type ${colourType}`
      }
    }

    chunks.push(type)
    at = end + 4
  }

  return chunks.includes('IDAT') ? null : 'no IDAT chunk'
}
