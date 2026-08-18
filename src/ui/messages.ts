import type { JobError } from '../workers/protocol'

/**
 * A typed code becomes a sentence here, and only here.
 *
 * The core reports codes precisely so the wording is not baked into it — that
 * is what lets the same failure be shown in Spanish today and in English
 * later. Each message says what happened and what to do about it. The codec's
 * own `detail` never reaches the user: it is for a bug report, and a stack
 * trace in a table row helps nobody.
 */

const FORMAT_NAMES: Readonly<Record<string, string>> = {
  jpeg: 'JPEG',
  png: 'PNG',
  webp: 'WebP',
  avif: 'AVIF',
  heic: 'HEIC',
  gif: 'GIF',
  tiff: 'TIFF',
  bmp: 'BMP',
}

const nameOf = (format: string): string => FORMAT_NAMES[format] ?? format.toUpperCase()

export function describeJobError(error: JobError): string {
  switch (error.code) {
    case 'empty-file':
      return 'Archivo vacío, no hay nada que comprimir'

    case 'unknown-format':
      return 'No es una imagen que se pueda reconocer'

    case 'unsupported-format':
      return error.format === 'heic'
        ? 'Las fotos HEIC del iPhone no entran en esta versión. Expórtalas como JPEG desde el teléfono'
        : `${nameOf(error.format)} no está soportado. Convierte el archivo a JPEG, PNG, WebP o AVIF`

    case 'decode-failed':
      return `${nameOf(error.format)} dañado, no se pudo leer la imagen`

    case 'encode-failed':
      return `No se pudo generar el ${nameOf(error.format)} de salida`

    case 'worker-crashed':
      return 'El navegador cortó el proceso, probablemente por falta de memoria. Prueba con menos archivos a la vez'
  }
}
