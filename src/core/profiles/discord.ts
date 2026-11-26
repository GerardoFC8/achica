import type { ExternalProfile, Requirement } from './types'

/**
 * The Discord destinations: animated stickers and animated emoji.
 *
 * These are the first profiles whose limit is somebody else's rule, so each
 * one carries a `requirement` and the type refuses it without one (D48). They
 * are deliberately not in `PERFILES`: the compressor must not offer them, and
 * the Discord tool reads this list on its own.
 *
 * What was checked, and what was not, is written in `evidence` and not only
 * here: the interface can show it, and the next person to doubt a number can
 * see what it stands on. The pattern throughout is that Discord enforced the
 * weight and nothing else, so the weight is the one limit verified as a hard
 * one; the sizes are the documented ones, kept because they cost nothing.
 */

const STICKER_SOURCE =
  'https://support.discord.com/hc/en-us/articles/4402687377815-Tips-for-Sticker-Creators-FAQ'
const EMOJI_SOURCE =
  'https://support.discord.com/hc/en-us/articles/360036479811-How-to-Add-Custom-Emojis-on-Discord'

/**
 * The sources do not agree with themselves on the exact ceiling: 512 KB can
 * mean 512 000 or 524 288 bytes (and likewise for the emoji ceiling). The smaller one is used, so a file that
 * passes here passes either way. The evidence is Spanish like the rest of the
 * catalogue in core, because it is shown to the user as written.
 */
const AMBIGUOUS_SIZE =
  'El tamaño exacto del tope es ambiguo en las fuentes (por ejemplo, «512 KB» puede ser 512 000 o 524 288 bytes): se usa el menor por prudencia.'

const VERIFIED_AT = '2026-11-26'

const STICKER_EVIDENCE: Requirement['evidence'] = [
  'Comprobado el 2026-11-26 subiendo archivos a un servidor real de Discord.',
  'Lo único que Discord hizo cumplir fue el peso: un APNG de 730 KB fue rechazado, y los APNG de 456 KB y un GIF de 481 KB se aceptaron y se animaron.',
  'La dimensión exacta de 320 × 320 y los 5 s de duración no se hicieron cumplir en las pruebas: un APNG de 256 × 256 y un GIF de 7 s se aceptaron.',
  'Un WebP animado se rechazó como sticker («Unsupported file format»).',
  'Un archivo .apng se marcó como «asset inválido» y los mismos bytes como .png valieron, por eso el APNG se guarda como .png.',
  AMBIGUOUS_SIZE,
].join(' ')

const EMOJI_EVIDENCE: Requirement['evidence'] = [
  'Comprobado el 2026-11-26 subiendo archivos a un servidor real de Discord.',
  'Un emoji GIF animado de 127 KB se aceptó y se animó.',
  'El peso es el límite que Discord hizo cumplir; los 128 px son el tamaño que se usa como lado máximo y no se probó si Discord rechaza uno mayor.',
  AMBIGUOUS_SIZE,
].join(' ')

export const DISCORD_PERFILES: readonly ExternalProfile[] = [
  {
    id: 'discord-sticker-gif',
    label: 'Sticker animado de Discord (GIF)',
    group: 'Discord',
    format: 'keep',
    maxBytes: 512_000,
    animation: { layout: { kind: 'sticker', size: 320 }, format: 'gif' },
    stripMetadata: true,
    note: 'Lienzo cuadrado de 320 × 320 px con fondo transparente y un GIF de hasta 512 000 bytes. Si no cabe, baja los fotogramas por segundo y los colores, y marca el resultado si aun así pesa más. El GIF solo tiene transparencia de todo o nada, así que los bordes suaves quedan dentados.',
    requirement: { source: STICKER_SOURCE, verifiedAt: VERIFIED_AT, evidence: STICKER_EVIDENCE },
  },
  {
    id: 'discord-sticker-apng',
    label: 'Sticker animado de Discord (APNG)',
    group: 'Discord',
    format: 'keep',
    maxBytes: 512_000,
    animation: { layout: { kind: 'sticker', size: 320 }, format: 'apng' },
    stripMetadata: true,
    note: 'Lienzo cuadrado de 320 × 320 px y un APNG de hasta 512 000 bytes, con transparencia suave. Se guarda como .png, porque Discord rechaza la extensión .apng. Si no cabe, baja los fotogramas por segundo y los colores.',
    requirement: { source: STICKER_SOURCE, verifiedAt: VERIFIED_AT, evidence: STICKER_EVIDENCE },
  },
  {
    id: 'discord-emoji-gif',
    label: 'Emoji animado de Discord (GIF)',
    group: 'Discord',
    format: 'keep',
    maxBytes: 256_000,
    animation: { layout: { kind: 'emoji', maxSide: 128 }, format: 'gif' },
    stripMetadata: true,
    note: 'Cabe en 128 × 128 px sin ampliarse, conserva la proporción y pesa hasta 256 000 bytes. Si no cabe, baja los fotogramas por segundo y los colores.',
    requirement: { source: EMOJI_SOURCE, verifiedAt: VERIFIED_AT, evidence: EMOJI_EVIDENCE },
  },
]
