import type { GenericProfile } from './types'

/**
 * Our own recommendations, not anybody else's rules.
 *
 * The distinction matters and the interface has to keep it. A paperwork
 * profile says "this office demands 500 KB" and carries a source to prove it.
 * These say "this size travels well", which is advice — the note explains the
 * reasoning so the user can disagree with it.
 *
 * Nothing here claims to be an external requirement, because none of it was
 * verified against one.
 */
export const PERFILES_GENERICOS: readonly GenericProfile[] = [
  {
    id: 'web-articulo',
    label: 'Imagen para artículo web',
    group: 'Web',
    format: 'webp',
    maxWidth: 1600,
    quality: 78,
    stripMetadata: true,
    note: 'WebP a 1600 px de ancho: se ve nítida en pantallas grandes y pesa mucho menos que un JPEG equivalente.',
  },
  {
    id: 'correo-adjunto',
    label: 'Adjunto de correo',
    group: 'Correo',
    format: 'jpeg',
    maxBytes: 500_000,
    maxWidth: 2000,
    stripMetadata: true,
    note: 'Bajo 500 KB entran varias fotos en un solo correo sin que el envío se trabe ni la bandeja del otro se llene.',
  },
  {
    id: 'mensajeria',
    label: 'Enviar por mensajería',
    group: 'Mensajería',
    format: 'jpeg',
    maxBytes: 300_000,
    maxWidth: 1600,
    stripMetadata: true,
    note: 'Las aplicaciones de mensajería recomprimen lo que les mandes. Entregarles algo ya liviano evita que lo hagan dos veces.',
  },
  {
    id: 'miniatura',
    label: 'Miniatura',
    group: 'Miniatura',
    format: 'webp',
    maxWidth: 400,
    maxHeight: 400,
    quality: 72,
    stripMetadata: true,
    note: 'Cabe en un cuadrado de 400 px conservando la proporción. Para listados, avatares y previsualizaciones.',
  },
]
