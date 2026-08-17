import { err, ok, type Result } from './result'

/**
 * Identifies an image by its bytes, never by its filename.
 *
 * A `.jpg` that is really a PNG is an ordinary, innocent user mistake — the
 * file came off a phone, went through a chat app, got renamed by someone
 * trying to be helpful. Trusting the extension turns that into a decode
 * failure the user cannot explain, so the extension is not consulted here at
 * all.
 */

export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'heic' | 'gif' | 'tiff' | 'bmp'

/** The formats the pipeline can actually decode today. HEIC is deliberately absent. */
export type SupportedFormat = 'jpeg' | 'png' | 'webp' | 'avif'

export type DetectionError =
  | { readonly code: 'empty-file' }
  | { readonly code: 'unknown-format'; readonly leadingBytes: string }
  | { readonly code: 'unsupported-format'; readonly format: ImageFormat }

const SUPPORTED: ReadonlySet<string> = new Set<SupportedFormat>(['jpeg', 'png', 'webp', 'avif'])

function isSupported(format: ImageFormat): format is SupportedFormat {
  return SUPPORTED.has(format)
}

/*
 * Brand order matters and is the subtle part of ISO-BMFF sniffing.
 *
 * `mif1` is the generic HEIF brand and AVIF files list it among their
 * compatible brands too. Checking HEIF first would therefore label a
 * perfectly ordinary AVIF as HEIC. AVIF is checked first for that reason.
 */
const AVIF_BRANDS: ReadonlySet<string> = new Set(['avif', 'avis'])

const HEIC_BRANDS: ReadonlySet<string> = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'hevm',
  'hevs',
  'mif1',
  'msf1',
])

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false
  return signature.every((byte, index) => bytes[index] === byte)
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  if (bytes.length < end) return ''
  return String.fromCharCode(...bytes.subarray(start, end))
}

/**
 * Collects the major brand plus every compatible brand from the `ftyp` box.
 *
 * Reading only the major brand is not enough: a real HEIF can declare `mif1`
 * as its major brand and mention `heic` only in the compatible list.
 */
function isoBrands(bytes: Uint8Array): string[] {
  if (ascii(bytes, 4, 8) !== 'ftyp') return []

  const declaredSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0)
  // Trust the smaller of what the box claims and what actually arrived, so a
  // truncated or lying header cannot walk us off the end.
  const end = Math.min(declaredSize, bytes.length)

  const brands = [ascii(bytes, 8, 12)]
  for (let at = 16; at + 4 <= end; at += 4) {
    brands.push(ascii(bytes, at, at + 4))
  }

  return brands.filter((brand) => brand.length === 4)
}

function detectIsoBmff(bytes: Uint8Array): ImageFormat | null {
  const brands = isoBrands(bytes)
  if (brands.length === 0) return null

  if (brands.some((brand) => AVIF_BRANDS.has(brand))) return 'avif'
  if (brands.some((brand) => HEIC_BRANDS.has(brand))) return 'heic'

  // Some other ISO-BMFF file — an MP4, most likely. Not an image.
  return null
}

/** Returns the format, or null when the bytes match nothing we recognise. */
export function detectFormat(bytes: Uint8Array): ImageFormat | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'gif' // GIF87a and GIF89a
  if (startsWith(bytes, [0x42, 0x4d])) return 'bmp'
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00])) return 'tiff' // little-endian
  if (startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) return 'tiff' // big-endian

  // WebP is a RIFF container: the format tag sits after the 4-byte length.
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'webp'

  return detectIsoBmff(bytes)
}

/**
 * Detects the format and decides whether the pipeline can handle it.
 *
 * The three failures are distinct on purpose, because the interface owes the
 * user a different sentence for each: an empty file, something that is not an
 * image at all, and a real image in a format we do not decode yet — the last
 * of which can tell the user exactly what to change.
 */
export function detectSupportedFormat(bytes: Uint8Array): Result<SupportedFormat, DetectionError> {
  if (bytes.length === 0) return err({ code: 'empty-file' })

  const format = detectFormat(bytes)

  if (format === null) {
    const leadingBytes = [...bytes.subarray(0, 4)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join(' ')
    return err({ code: 'unknown-format', leadingBytes })
  }

  if (!isSupported(format)) return err({ code: 'unsupported-format', format })

  return ok(format)
}
