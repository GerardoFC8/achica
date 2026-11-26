/**
 * What the first bytes of a file say it is. The route is chosen by bytes, never
 * by the extension or by `file.type`: a phone's .MOV, a renamed .webm and a
 * file the browser typed as an empty string all look the same by name.
 *
 * Only the two containers the <video> element of every supported browser can
 * play are accepted:
 *
 * - ISO base media (MP4, M4V, MOV): a box whose type at byte 4 is `ftyp`.
 *   Image files in the same family (AVIF, HEIC) also start that way, so the
 *   major brand is checked against the image brands and refused: a <video>
 *   cannot play them and the error should say "not a video", not "codec".
 *   An audio-only `M4A ` is accepted on purpose; the element then reports no
 *   video track, which is a more useful error than "unsupported".
 * - Matroska and WebM: the EBML magic 1A 45 DF A3.
 */
export type VideoContainer = 'iso-bmff' | 'matroska'

/** Major brands of ISO-BMFF files that hold images, not video. */
const IMAGE_BRANDS: ReadonlySet<string> = new Set([
  'avif',
  'avis',
  'heic',
  'heix',
  'heim',
  'heis',
  'hevc',
  'hevx',
  'hevm',
  'hevs',
  'mif1',
  'msf1',
  'miaf',
])

/** Enough to read the box header and the major brand. */
export const SNIFF_BYTES = 12

export function sniffVideoContainer(bytes: Uint8Array): VideoContainer | null {
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf) {
    return bytes[3] === 0xa3 ? 'matroska' : null
  }
  if (bytes.length >= 12) {
    const text = (from: number): string =>
      String.fromCharCode(
        bytes[from] ?? 0,
        bytes[from + 1] ?? 0,
        bytes[from + 2] ?? 0,
        bytes[from + 3] ?? 0,
      )
    if (text(4) !== 'ftyp') return null
    return IMAGE_BRANDS.has(text(8)) ? null : 'iso-bmff'
  }
  return null
}
