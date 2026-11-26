import type { OutputFormat } from '../core/codecs/encode'
import type { Profile } from '../core/profiles'

/**
 * The convert tool's one choice: which format every file comes out as.
 */

export const FORMAT_CHOICES: readonly OutputFormat[] = ['jpeg', 'png', 'webp', 'avif']

export const DEFAULT_FORMAT: OutputFormat = 'webp'

/**
 * The fixed quality of each lossy format. Ours, not the user's: the product
 * hands out destinations and not a slider (axis 2 of the spec).
 *
 * Starting points, not measurements: JPEG 85 is the common "high quality,
 * still light" setting; WebP 80 is the same idea for libwebp, whose output is
 * usually lighter than JPEG at a similar look; AVIF 60 is lower on purpose
 * because its scale is not comparable with the other two and its encoder is
 * the slowest, so chasing the top of the range costs minutes in a large batch
 * for little visible gain. They have not been checked against a corpus; if
 * that is ever done, this is the one place to change.
 *
 * PNG has no entry: it is lossless and ignores quality altogether.
 */
export const FORMAT_QUALITY: Readonly<Record<Exclude<OutputFormat, 'png'>, number>> = {
  jpeg: 85,
  webp: 80,
  avif: 60,
}

const NAMES: Readonly<Record<OutputFormat, string>> = {
  jpeg: 'JPEG',
  png: 'PNG',
  webp: 'WebP',
  avif: 'AVIF',
}

/** The quality the format is encoded at, or null for the lossless one. */
export const qualityOf = (format: OutputFormat): number | null =>
  format === 'png' ? null : FORMAT_QUALITY[format]

export function profileForFormat(format: OutputFormat): Profile {
  const quality = qualityOf(format)

  return {
    id: `convertir-${format}`,
    label: `Convertir a ${NAMES[format]}`,
    group: 'Formato',
    format,
    ...(quality === null ? {} : { quality }),
    stripMetadata: true,
    note: `Pasa cada imagen a ${NAMES[format]}, conservando las dimensiones.`,
  }
}
