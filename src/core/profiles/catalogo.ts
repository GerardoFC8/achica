import type { Profile } from './types'

/**
 * Every profile the application offers.
 *
 * All four are our own advice, not anybody else's rule, and the note on each
 * one is what lets the user disagree with it. Nothing here claims to be an
 * external requirement, because none of it was verified against one.
 *
 * Three of the four keep the format they were handed. Only "Web" converts,
 * because there the WebP is what is being asked for — the other three are
 * asked to make a file lighter, and a lighter file under a different extension
 * is not what anybody meant (D49).
 *
 * "Web" comes first: it is the default selection, and converting for the web is
 * the reason most people open this.
 */
export const PERFILES: readonly Profile[] = [
  {
    id: 'web-articulo',
    label: 'Imagen para artículo web',
    group: 'Web',
    format: 'webp',
    maxWidth: 1600,
    quality: 78,
    stripMetadata: true,
    note: 'WebP a 1600 px de ancho: se ve nítida en pantallas grandes y pesa mucho menos que un JPEG equivalente. Es el único perfil que cambia el formato, porque acá convertir es el objetivo.',
  },
  {
    id: 'correo-adjunto',
    label: 'Adjunto de correo',
    group: 'Correo',
    format: 'keep',
    maxWidth: 2000,
    quality: 78,
    stripMetadata: true,
    note: 'Conserva el formato y limita el ancho a 2000 px. Se sigue viendo bien en cualquier pantalla y entran varias fotos en un solo correo.',
  },
  {
    id: 'mensajeria',
    label: 'Enviar por mensajería',
    group: 'Mensajería',
    format: 'keep',
    maxWidth: 1600,
    quality: 72,
    stripMetadata: true,
    note: 'Las aplicaciones de mensajería recomprimen lo que les mandes. Entregarles algo ya liviano evita que lo hagan dos veces.',
  },
  {
    id: 'miniatura',
    label: 'Miniatura',
    group: 'Miniatura',
    format: 'keep',
    maxWidth: 400,
    maxHeight: 400,
    quality: 72,
    stripMetadata: true,
    note: 'Cabe en un cuadrado de 400 px conservando la proporción. Para listados, avatares y previsualizaciones.',
  },
]
