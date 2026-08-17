import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { detectFormat, detectSupportedFormat } from './detect'
import { CORRUPT_FIXTURES, FIXTURES, ORIENTATION_FIXTURES } from '../../test/fixtures/paths'

const HEADERS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'test',
  'fixtures',
  'generated',
  'headers',
)

async function bytesOf(path: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path))
}

const header = (name: string): Promise<Uint8Array> => bytesOf(join(HEADERS, name))

describe('detectFormat', () => {
  it('reads a JPEG by its signature', async () => {
    expect(detectFormat(await bytesOf(FIXTURES.noExif))).toBe('jpeg')
    expect(detectFormat(await bytesOf(FIXTURES.cameraLandscape))).toBe('jpeg')
  })

  it('reads a PNG by its signature', async () => {
    expect(detectFormat(await bytesOf(FIXTURES.rgbaPng))).toBe('png')
    expect(detectFormat(await bytesOf(FIXTURES.interlacedPng))).toBe('png')
  })

  it('reads a WebP past the RIFF length field', async () => {
    // The format tag is at offset 8, not 4: the four bytes in between are the
    // RIFF chunk size, which differs per file.
    expect(detectFormat(await bytesOf(FIXTURES.sampleWebp))).toBe('webp')
  })

  it('ignores the extension entirely', async () => {
    const bytes = await bytesOf(FIXTURES.pngDisguisedAsJpeg)

    expect(FIXTURES.pngDisguisedAsJpeg.endsWith('.jpg')).toBe(true)
    expect(detectFormat(bytes)).toBe('png')
  })

  it('still recognises a JPEG whose data is truncated', async () => {
    // Detection reads the header, so a half-written file is still identifiable.
    // Failing later, during decode, gives the user a far better message than
    // "unknown format".
    expect(detectFormat(await bytesOf(FIXTURES.truncatedJpeg))).toBe('jpeg')
  })

  describe('ISO-BMFF containers', () => {
    it('calls an AVIF an AVIF even though it also declares mif1', async () => {
      // The trap: mif1 is the generic HEIF brand and AVIF files carry it in
      // their compatible list. Checking HEIF first would misfile every AVIF.
      expect(detectFormat(await header('avif.bin'))).toBe('avif')
    })

    it('reads HEIC from the major brand', async () => {
      expect(detectFormat(await header('heic.bin'))).toBe('heic')
    })

    it('reads HEIC from the compatible brands when the major brand is mif1', async () => {
      // A real HEIF can declare mif1 as its major brand and mention heic only
      // further along, so reading the first brand alone is not enough.
      expect(detectFormat(await header('heif-mif1-major.bin'))).toBe('heic')
    })

    it('does not mistake an MP4 for an image', async () => {
      expect(detectFormat(await header('mp4.bin'))).toBeNull()
    })
  })

  it('returns null for bytes it does not recognise', () => {
    expect(detectFormat(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull()
    expect(detectFormat(new Uint8Array())).toBeNull()
  })

  it('does not read past the end of a short buffer', () => {
    // Every prefix of a valid PNG signature, to prove the length guards hold.
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

    for (let length = 0; length < signature.length; length += 1) {
      expect(() => detectFormat(new Uint8Array(signature.slice(0, length)))).not.toThrow()
      expect(detectFormat(new Uint8Array(signature.slice(0, length)))).toBeNull()
    }
  })

  it('does not walk off the end when a ftyp box lies about its size', () => {
    const lying = new Uint8Array(16)
    new DataView(lying.buffer).setUint32(0, 0xffffffff) // claims four gigabytes
    lying.set([0x66, 0x74, 0x79, 0x70], 4) // "ftyp"
    lying.set([0x61, 0x76, 0x69, 0x66], 8) // "avif"

    expect(() => detectFormat(lying)).not.toThrow()
    expect(detectFormat(lying)).toBe('avif')
  })
})

describe('detectSupportedFormat', () => {
  it('accepts the formats the pipeline decodes', async () => {
    const supported = [FIXTURES.noExif, FIXTURES.rgbaPng, FIXTURES.sampleWebp]

    for (const path of supported) {
      const result = detectSupportedFormat(await bytesOf(path))
      expect(result.ok, path).toBe(true)
    }
  })

  it('reports an empty file as its own failure, not as an unknown format', async () => {
    const result = detectSupportedFormat(await bytesOf(FIXTURES.emptyFile))

    expect(result).toEqual({ ok: false, error: { code: 'empty-file' } })
  })

  it('reports HEIC as unsupported rather than unknown', async () => {
    // The distinction is the whole point: HEIC is a real image in a format we
    // deliberately left out of v1, so the interface can tell the user exactly
    // what to change on their phone. "Unknown format" would strand them.
    const result = detectSupportedFormat(await header('heic.bin'))

    expect(result).toEqual({ ok: false, error: { code: 'unsupported-format', format: 'heic' } })
  })

  it('reports other real image formats as unsupported too', async () => {
    const gif = detectSupportedFormat(await header('gif.bin'))

    expect(gif).toEqual({ ok: false, error: { code: 'unsupported-format', format: 'gif' } })
  })

  it('reports an unknown format with the bytes that were actually there', () => {
    const result = detectSupportedFormat(new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00]))

    expect(result).toEqual({
      ok: false,
      error: { code: 'unknown-format', leadingBytes: 'de ad be ef' },
    })
  })

  it('accepts corrupt PNGs whose signature survives, leaving the decoder to fail', async () => {
    // Detection is not validation. A file with an intact signature and a bad
    // CRC is a PNG, and saying so lets the decode step report the real cause.
    const withGoodSignature = CORRUPT_FIXTURES.filter(({ defect }) => !defect.includes('signature'))
    expect(withGoodSignature.length).toBeGreaterThan(0)

    for (const { path } of withGoodSignature) {
      expect(detectFormat(await bytesOf(path)), path).toBe('png')
    }
  })

  it('agrees with every orientation fixture being a JPEG', async () => {
    for (const path of Object.values(ORIENTATION_FIXTURES)) {
      const result = detectSupportedFormat(await bytesOf(path))
      expect(result.ok && result.value, path).toBe('jpeg')
    }
  })
})
