import type { SupportedFormat } from '../detect'

/**
 * File names for images that came out of somebody else's URLs.
 *
 * They end up in a ZIP and in a folder on the user's disk, so a name is a
 * security boundary: no path separators, no traversal, nothing Windows treats
 * as a device, and no two files that a case-insensitive file system would
 * merge. Everything is deterministic, so the same HAR always yields the same
 * names.
 */

const EXTENSION: Readonly<Record<SupportedFormat, string>> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
}

const MAX_NAME = 80
const MAX_PARENT = 24
const FALLBACK = 'imagen'

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  ...['jpg', 'jpeg', 'jpe', 'jfif', 'png', 'apng', 'webp', 'avif'],
  ...['gif', 'svg', 'ico', 'bmp', 'heic', 'heif', 'tif', 'tiff'],
])

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** 32-bit FNV-1a over UTF-16 code units, as 8 hex digits. Sync, no crypto. */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment // a stray % is not worth losing the name over
  }
}

const trimEdges = (value: string): string => value.replace(/^[.-]+|[.-]+$/g, '')

/** Reduces text to `[A-Za-z0-9._-]`, without edge dots or hyphens, within `max`. */
export function sanitizeStem(text: string, max: number): string {
  const flat = text.replace(/[^A-Za-z0-9._-]/g, '-').replace(/-{2,}/g, '-')
  return trimEdges(trimEdges(flat).slice(0, Math.max(0, max)))
}

/** The last path segment, decoded, without its image extension, sanitised. */
export function stemFromSegment(segment: string | undefined, max: number): string {
  if (segment === undefined) return FALLBACK
  const decoded = decode(segment)
  const dot = decoded.lastIndexOf('.')
  // The URL's extension is only a hint and may lie (a .png that is a JPEG),
  // so a known image extension is dropped and the real one is appended later.
  const hasImageExtension = dot >= 0 && IMAGE_EXTENSIONS.has(decoded.slice(dot + 1).toLowerCase())
  const stem = sanitizeStem(hasImageExtension ? decoded.slice(0, dot) : decoded, max)
  return stem === '' ? FALLBACK : stem
}

function build(stem: string, format: SupportedFormat): string {
  const extension = EXTENSION[format]
  const room = MAX_NAME - extension.length - 1
  let body = sanitizeStem(stem, room)
  if (body === '') body = FALLBACK
  // CON.jpg, NUL.x.png...: Windows reads the part before the first dot.
  if (WINDOWS_RESERVED.test(body.split('.', 1)[0] ?? '')) {
    body = sanitizeStem(`img-${body}`, room)
  }
  return `${body}.${extension}`
}

export type NameRequest = {
  /** Path segments of the image URL, still percent-encoded. */
  readonly segments: readonly string[]
  readonly format: SupportedFormat
  /** The full original URL: only ever hashed, never copied into a name. */
  readonly fullUrl: string
}

/**
 * Hands out names one image at a time, in HAR order.
 *
 * The first `thumb.jpg` keeps its plain name. Ten of them from different
 * folders need telling apart in a way a person can read, so a collision first
 * borrows the parent folder (`products-thumb.jpg`), and only then falls back
 * to a short hash of the whole URL, which is stable between runs. The hash is
 * one-way and 32 bits wide: it cannot carry a token out.
 */
export function createNamer(): (request: NameRequest) => string {
  const taken = new Set<string>()

  const claim = (name: string): string | null => {
    const key = name.toLowerCase()
    if (taken.has(key)) return null
    taken.add(key)
    return name
  }

  return ({ segments, format, fullUrl }) => {
    const stem = stemFromSegment(segments[segments.length - 1], MAX_NAME)
    const parent =
      segments.length > 1
        ? sanitizeStem(decode(segments[segments.length - 2] ?? ''), MAX_PARENT)
        : ''

    const plain = claim(build(stem, format))
    if (plain !== null) return plain

    if (parent !== '') {
      const withParent = claim(build(`${parent}-${stem}`, format))
      if (withParent !== null) return withParent
    }

    const hash = fnv1a(fullUrl)
    // Leave room for the suffix by cutting the stem, not the hash.
    const room = MAX_NAME - EXTENSION[format].length - 1 - hash.length - 1 - 8
    const cut = sanitizeStem(stem, room)
    const hashed = claim(build(`${cut}-${hash}`, format))
    if (hashed !== null) return hashed

    // Two different URLs with the same 32-bit hash and the same stem: count.
    for (let n = 2; ; n += 1) {
      const counted = claim(build(`${cut}-${hash}-${n}`, format))
      if (counted !== null) return counted
    }
  }
}
