import { describe, expect, it } from 'vitest'
import { decodeImage } from './decode'
import { detectSupportedFormat } from '../detect'

/**
 * Covers three of the four things phase 1 has to prove: the orientation is
 * right, transparency survives, and a corrupt file produces a typed error
 * rather than an exception. The fourth, fitting a weight budget, arrives with
 * the encoder.
 */

const FIXTURE_URLS = import.meta.glob('../../../test/fixtures/**/*.{jpg,png,webp,bin}', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

async function load(name: string): Promise<ArrayBuffer> {
  const key = Object.keys(FIXTURE_URLS).find((path) => path.endsWith(`/${name}`))
  if (key === undefined) throw new Error(`fixture not found: ${name}`)

  const url = FIXTURE_URLS[key]
  if (url === undefined) throw new Error(`fixture url missing: ${name}`)

  return (await fetch(url)).arrayBuffer()
}

/** Reduces a sampled pixel to a colour name, so JPEG's lossiness cannot matter. */
function colourAt(image: ImageData, x: number, y: number): string {
  const index = (y * image.width + x) * 4
  const r = image.data[index] ?? 0
  const g = image.data[index + 1] ?? 0
  const b = image.data[index + 2] ?? 0

  if (r > 200 && g > 200 && b > 200) return 'white'
  if (r > 200) return 'red'
  if (g > 200) return 'green'
  if (b > 200) return 'blue'
  return `${r},${g},${b}`
}

function corners(image: ImageData): [string, string, string, string] {
  const w = image.width
  const h = image.height
  return [
    colourAt(image, 4, 4),
    colourAt(image, w - 4, 4),
    colourAt(image, 4, h - 4),
    colourAt(image, w - 4, h - 4),
  ]
}

async function decodeOrThrow(name: string, format: 'jpeg' | 'png' | 'webp'): Promise<ImageData> {
  const result = await decodeImage(format, await load(name))
  if (!result.ok) throw new Error(`decode failed for ${name}: ${result.error.detail}`)
  return result.value
}

/**
 * Measured against Chromium's own orientation handling, not derived from the
 * specification text. If our reading of EXIF were wrong, deriving these would
 * have encoded the same mistake in both the fixture and the expectation.
 */
const EXPECTED = [
  { orientation: 1, size: [64, 32], corners: ['red', 'green', 'blue', 'white'] },
  { orientation: 2, size: [64, 32], corners: ['green', 'red', 'white', 'blue'] },
  { orientation: 3, size: [64, 32], corners: ['white', 'blue', 'green', 'red'] },
  { orientation: 4, size: [64, 32], corners: ['blue', 'white', 'red', 'green'] },
  { orientation: 5, size: [32, 64], corners: ['red', 'blue', 'green', 'white'] },
  { orientation: 6, size: [32, 64], corners: ['blue', 'red', 'white', 'green'] },
  { orientation: 7, size: [32, 64], corners: ['white', 'green', 'blue', 'red'] },
  { orientation: 8, size: [32, 64], corners: ['green', 'white', 'red', 'blue'] },
] as const

describe('EXIF orientation', () => {
  it.each(EXPECTED)(
    'applies orientation $orientation to the pixels',
    async ({ orientation, size, corners: expected }) => {
      const image = await decodeOrThrow(`orientation-${orientation}.jpg`, 'jpeg')

      expect([image.width, image.height]).toEqual([...size])
      expect(corners(image)).toEqual([...expected])
    },
  )

  it('leaves an image without EXIF exactly as stored', async () => {
    const image = await decodeOrThrow('no-exif.jpg', 'jpeg')

    expect([image.width, image.height]).toEqual([64, 32])
    expect(corners(image)).toEqual(['red', 'green', 'blue', 'white'])
  })

  it('orients a real camera photo, not just our synthetic ones', async () => {
    // Orientation 6 stores a landscape photo rotated, so applying the tag has
    // to give landscape back. Getting this wrong is the sideways-phone-photo
    // bug, and a synthetic fixture alone would not prove it against a file
    // carrying a full APP1 with thumbnail and vendor tags.
    const landscape = await decodeOrThrow('Landscape_6.jpg', 'jpeg')
    const portrait = await decodeOrThrow('Portrait_6.jpg', 'jpeg')

    expect(landscape.width).toBeGreaterThan(landscape.height)
    expect(portrait.height).toBeGreaterThan(portrait.width)
  })
})

describe('transparency', () => {
  it('keeps the alpha channel of an RGBA png', async () => {
    const image = await decodeOrThrow('basn6a08.png', 'png')
    const alphas = new Set<number>()

    for (let i = 3; i < image.data.length; i += 4) {
      alphas.add(image.data[i] ?? 255)
    }

    expect(alphas.size).toBeGreaterThan(1)
    expect(Math.min(...alphas)).toBeLessThan(255)
  })

  it('turns tRNS transparency into real alpha', async () => {
    // tRNS is not an alpha channel: it names colours that should be treated as
    // transparent. A decoder that ignores it returns a fully opaque image and
    // the transparency is silently lost on the way out.
    const image = await decodeOrThrow('tbrn2c08.png', 'png')
    let transparent = 0

    for (let i = 3; i < image.data.length; i += 4) {
      if ((image.data[i] ?? 255) < 255) transparent += 1
    }

    expect(transparent).toBeGreaterThan(0)
  })

  it('keeps transparency on a paletted png', async () => {
    const image = await decodeOrThrow('tp1n3p08.png', 'png')
    let transparent = 0

    for (let i = 3; i < image.data.length; i += 4) {
      if ((image.data[i] ?? 255) < 255) transparent += 1
    }

    expect(transparent).toBeGreaterThan(0)
  })
})

describe('other formats', () => {
  it('decodes an interlaced png', async () => {
    const image = await decodeOrThrow('basi2c08.png', 'png')
    expect(image.width).toBe(32)
  })

  it('decodes webp', async () => {
    const image = await decodeOrThrow('sample.webp', 'webp')
    expect([image.width, image.height]).toEqual([64, 32])
  })
})

describe('failures are values, never exceptions', () => {
  /** Genuinely unreadable: the header or the image data is not there at all. */
  const UNDECODABLE = [
    'xs1n0g01.png', // broken PNG signature
    'xd0n2c08.png', // bit depth 0
    'xc9n2c08.png', // colour type 9
    'xdtn0g01.png', // no IDAT chunk
  ] as const

  /**
   * Wrong checksum, intact payload. Verified by hand: the IHDR fields are
   * valid and the IDAT zlib stream decompresses cleanly in both, so only the
   * CRC is wrong.
   *
   * The decoder reads them anyway and that is the behaviour we want. Refusing
   * would deny the user an image their own viewer opens without complaint,
   * and this tool exists to compress the photos people actually have, not to
   * audit their checksums.
   */
  const TOLERATED_DESPITE_BAD_CRC = [
    'xhdn0g08.png', // bad CRC in IHDR
    'xcsn0g01.png', // bad CRC in IDAT
  ] as const

  it.each(UNDECODABLE)('reports %s as a typed error and does not throw', async (name) => {
    const result = await decodeImage('png', await load(name))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('decode-failed')
    expect(result.error.format).toBe('png')
    expect(result.error.detail.length).toBeGreaterThan(0)
  })

  it.each(TOLERATED_DESPITE_BAD_CRC)('recovers %s rather than rejecting it', async (name) => {
    const result = await decodeImage('png', await load(name))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect([result.value.width, result.value.height]).toEqual([32, 32])
  })

  it('reports a truncated JPEG rather than returning half an image', async () => {
    const result = await decodeImage('jpeg', await load('truncated.jpg'))

    expect(result.ok).toBe(false)
  })

  it('survives being handed bytes of the wrong format', async () => {
    // Nothing upstream should ever do this, but "the decoder crashed the tab"
    // is not an acceptable answer if something does.
    const result = await decodeImage('jpeg', await load('basn6a08.png'))

    expect(result.ok).toBe(false)
  })
})

describe('detect and decode together', () => {
  it('routes a PNG wearing a .jpg extension to the PNG decoder', async () => {
    // The whole point of sniffing: the extension says JPEG, the bytes say PNG,
    // and the pipeline follows the bytes.
    const bytes = await load('png-with-jpg-extension.jpg')
    const detected = detectSupportedFormat(new Uint8Array(bytes))

    expect(detected.ok).toBe(true)
    if (!detected.ok) return
    expect(detected.value).toBe('png')

    const image = await decodeImage(detected.value, bytes)
    expect(image.ok).toBe(true)
  })
})
